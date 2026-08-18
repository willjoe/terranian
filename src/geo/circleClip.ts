import type { LocalPoint } from '@/geo/coords'

/**
 * Real OSM features (forests, lakes, parks, long roads) are frequently
 * larger than our generation radius, and Overpass returns their full,
 * unclipped geometry as long as any part touches the fetch bbox. Without
 * clipping, those features render as arbitrary fragments sprawling past
 * the visible terrain instead of shapes that terminate cleanly at the
 * radius. These helpers clip local-meter geometry to a circle of `radius`
 * centered at the local origin (0,0), i.e. the picked point.
 */

export const CIRCLE_CLIP_SEGMENTS = 64

/**
 * Exported so anything else that needs the generation-radius boundary
 * (e.g. the terrain skirt) samples the *exact* same polygon used to clip
 * everything else — a separately-sampled circle with a different segment
 * count would land on different vertices and leave a seam at the rim.
 */
export function approximateCircle(radius: number, segments: number): LocalPoint[] {
  const points: LocalPoint[] = []
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
  }
  return points
}

function isLeftOfEdge(p: LocalPoint, a: LocalPoint, b: LocalPoint): boolean {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0
}

function edgeIntersection(p1: LocalPoint, p2: LocalPoint, a: LocalPoint, b: LocalPoint): LocalPoint {
  const A1 = p2.y - p1.y
  const B1 = p1.x - p2.x
  const C1 = A1 * p1.x + B1 * p1.y
  const A2 = b.y - a.y
  const B2 = a.x - b.x
  const C2 = A2 * a.x + B2 * a.y
  const denom = A1 * B2 - A2 * B1
  if (Math.abs(denom) < 1e-9) return p2
  return {
    x: (B2 * C1 - B1 * C2) / denom,
    y: (A1 * C2 - A2 * C1) / denom,
  }
}

/**
 * Sutherland-Hodgman clip of a (possibly concave) closed polygon ring
 * against a convex clip polygon — here, a circle approximated with
 * `CIRCLE_CLIP_SEGMENTS` sides. Correctly handles the polygon extending
 * past the circle on one side, wholly containing the circle, or being
 * wholly inside it (returned unchanged).
 */
export function clipPolygonToRadius(polygon: LocalPoint[], radius: number): LocalPoint[] {
  const clipWindow = approximateCircle(radius, CIRCLE_CLIP_SEGMENTS)
  let output = polygon

  for (let i = 0; i < clipWindow.length && output.length > 0; i++) {
    const a = clipWindow[i]
    const b = clipWindow[(i + 1) % clipWindow.length]
    const input = output
    output = []

    for (let j = 0; j < input.length; j++) {
      const current = input[j]
      const prev = input[(j - 1 + input.length) % input.length]
      const currentInside = isLeftOfEdge(current, a, b)
      const prevInside = isLeftOfEdge(prev, a, b)

      if (currentInside) {
        if (!prevInside) output.push(edgeIntersection(prev, current, a, b))
        output.push(current)
      } else if (prevInside) {
        output.push(edgeIntersection(prev, current, a, b))
      }
    }
  }

  return output
}

function distanceSquared(p: LocalPoint): number {
  return p.x * p.x + p.y * p.y
}

function lerp(p1: LocalPoint, p2: LocalPoint, t: number): LocalPoint {
  return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t }
}

/** Parametric t in [0,1] values where segment p1->p2 crosses the circle, ascending. */
function segmentCircleIntersections(p1: LocalPoint, p2: LocalPoint, radius: number): number[] {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const a = dx * dx + dy * dy
  if (a === 0) return []

  const b = 2 * (p1.x * dx + p1.y * dy)
  const c = p1.x * p1.x + p1.y * p1.y - radius * radius
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return []

  const sqrtDisc = Math.sqrt(discriminant)
  return [(-b - sqrtDisc) / (2 * a), (-b + sqrtDisc) / (2 * a)]
    .filter((t) => t >= 0 && t <= 1)
    .sort((x, y) => x - y)
}

/**
 * Clips an open polyline to a circle of `radius`, returning each
 * contiguous sub-chain that lies inside it (zero, one, or several, if the
 * line exits and re-enters — e.g. a road that clips a corner of the
 * radius). Each returned chain has at least 2 points.
 */
export function clipPolylineToRadius(line: LocalPoint[], radius: number): LocalPoint[][] {
  const isInside = (p: LocalPoint) => distanceSquared(p) <= radius * radius
  const chains: LocalPoint[][] = []
  let current: LocalPoint[] = line.length > 0 && isInside(line[0]) ? [line[0]] : []

  for (let i = 0; i < line.length - 1; i++) {
    const p1 = line[i]
    const p2 = line[i + 1]
    const p1Inside = isInside(p1)
    const p2Inside = isInside(p2)

    if (p1Inside && p2Inside) {
      current.push(p2)
      continue
    }

    const ts = segmentCircleIntersections(p1, p2, radius)

    if (p1Inside && !p2Inside) {
      current.push(lerp(p1, p2, ts.length > 0 ? ts[ts.length - 1] : 1))
      if (current.length >= 2) chains.push(current)
      current = []
    } else if (!p1Inside && p2Inside) {
      current = [lerp(p1, p2, ts.length > 0 ? ts[0] : 0), p2]
    } else if (ts.length === 2) {
      // Both endpoints outside, but the segment clips through the circle.
      chains.push([lerp(p1, p2, ts[0]), lerp(p1, p2, ts[1])])
    }
  }

  if (current.length >= 2) chains.push(current)
  return chains
}
