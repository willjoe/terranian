import type { LocalPoint } from '@/geo/coords'
import type { Road, RoadKind, TerrainPatch } from '@/world/schema'
import { sampleTerrainHeight } from '@/generation/sampleHeight'
import { toThreeVec3 } from '@/generation/toThreeSpace'
import type { GeometryData } from '@/generation/geometryTypes'

/**
 * Draped-layer height stacking (kept in sync with LAND_USE_Y_EPSILON /
 * WATER_Y_EPSILON in generation/landUseGeometry.ts): terrain < land-use <
 * water < road outline (sidewalk) < road surface < road centerline. Each
 * gap is wide — not just a few centimeters — because two *different*
 * layers rarely sample terrain height at exactly the same (x,y) point
 * (a land-use polygon's edge vs. a road's offset edge, for instance), so
 * on sloped real terrain a small gap can still be crossed by the slope
 * itself between those two sample points, not just by float/GPU
 * precision. A generous margin is what actually keeps roads reliably on
 * top everywhere, not just usually.
 */
const ROAD_OUTLINE_Y_EPSILON = 0.35
const ROAD_SURFACE_Y_EPSILON = 0.7
const ROAD_CENTERLINE_Y_EPSILON = 0.75

/** How far the grey outline (sidewalk) extends past each edge of the road surface itself. */
const SIDEWALK_WIDTH_M = 1.5

const CENTERLINE_DASH_WIDTH_M = 0.3
const CENTERLINE_DASH_LENGTH_M = 3
const CENTERLINE_GAP_LENGTH_M = 3

/** Footways/paths are already pedestrian space — they get neither a painted centerline nor a separate sidewalk outline. */
function isDecoratedRoad(kind: RoadKind): boolean {
  return kind !== 'footway' && kind !== 'path'
}

function closedRing(positions: number[], normals: number[], uvs: number[], indices: number[]) {
  return {
    pushQuad(
      a: LocalPoint,
      b: LocalPoint,
      c: LocalPoint,
      d: LocalPoint,
      ha: number,
      hb: number,
      hc: number,
      hd: number,
    ) {
      const start = positions.length / 3
      for (const [p, h] of [
        [a, ha],
        [b, hb],
        [c, hc],
        [d, hd],
      ] as const) {
        positions.push(...toThreeVec3(p, h))
        normals.push(0, 1, 0)
        uvs.push(0, 0)
      }
      indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3)
    },
  }
}

/** A single merged ribbon (one mesh for every road) at `halfWidth` around each centerline, draped at `yEpsilon` above terrain. */
function buildRibbonGeometry(
  roads: Road[],
  terrain: TerrainPatch,
  halfWidthFor: (road: Road) => number,
  yEpsilon: number,
  filter: (kind: RoadKind) => boolean = () => true,
): GeometryData {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const ring = closedRing(positions, normals, uvs, indices)

  for (const road of roads) {
    if (!filter(road.kind)) continue
    const line = road.centerline
    if (line.length < 2) continue

    const halfWidth = halfWidthFor(road)
    const left: LocalPoint[] = []
    const right: LocalPoint[] = []
    const heights: number[] = []

    for (let i = 0; i < line.length; i++) {
      const prev = line[Math.max(0, i - 1)]
      const next = line[Math.min(line.length - 1, i + 1)]
      const dx = next.x - prev.x
      const dy = next.y - prev.y
      const len = Math.hypot(dx, dy) || 1
      const nx = -dy / len
      const ny = dx / len

      const p = line[i]
      left.push({ x: p.x + nx * halfWidth, y: p.y + ny * halfWidth })
      right.push({ x: p.x - nx * halfWidth, y: p.y - ny * halfWidth })
      heights.push(sampleTerrainHeight(terrain, p.x, p.y) + yEpsilon)
    }

    for (let i = 0; i < line.length - 1; i++) {
      ring.pushQuad(left[i], right[i], left[i + 1], right[i + 1], heights[i], heights[i], heights[i + 1], heights[i + 1])
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  }
}

/**
 * The dark road surface. Deliberately narrower than the outline layer
 * beneath it (see buildRoadOutlineGeometry) so that layer only shows
 * through as a margin on either side rather than being fully covered.
 */
export function buildRoadsGeometry(roads: Road[], terrain: TerrainPatch): GeometryData {
  return buildRibbonGeometry(roads, terrain, (road) => road.widthMeters / 2, ROAD_SURFACE_Y_EPSILON)
}

/**
 * A wider grey ribbon draped *below* the road surface, standing in for a
 * sidewalk/curb margin. It's one merged mesh for every road, at a single
 * shared height — so at intersections, where several roads' wide outline
 * ribbons overlap each other, they simply blend into one continuous grey
 * area rather than showing seams, and the (separately drawn, higher)
 * road surfaces on top cleanly hide the parts of the outline that are
 * actually driven on, leaving only the outer margin visible.
 */
export function buildRoadOutlineGeometry(roads: Road[], terrain: TerrainPatch): GeometryData {
  return buildRibbonGeometry(
    roads,
    terrain,
    (road) => road.widthMeters / 2 + SIDEWALK_WIDTH_M,
    ROAD_OUTLINE_Y_EPSILON,
    isDecoratedRoad,
  )
}

/** Walks a polyline by arc length, invoking `onDash` with each sub-segment that falls within an "on" dash period. */
function walkDashSegments(
  line: LocalPoint[],
  dashLength: number,
  gapLength: number,
  onDash: (a: LocalPoint, b: LocalPoint) => void,
) {
  const period = dashLength + gapLength
  let distanceSoFar = 0

  for (let i = 0; i < line.length - 1; i++) {
    const p0 = line[i]
    const p1 = line[i + 1]
    const segDx = p1.x - p0.x
    const segDy = p1.y - p0.y
    const segLen = Math.hypot(segDx, segDy)
    if (segLen === 0) continue
    const dirX = segDx / segLen
    const dirY = segDy / segLen

    let segPos = 0
    while (segPos < segLen) {
      const cyclePos = distanceSoFar % period
      const isOn = cyclePos < dashLength
      const remainingInPhase = isOn ? dashLength - cyclePos : period - cyclePos
      const stepLen = Math.min(remainingInPhase, segLen - segPos)

      if (isOn) {
        const a = { x: p0.x + dirX * segPos, y: p0.y + dirY * segPos }
        const b = { x: p0.x + dirX * (segPos + stepLen), y: p0.y + dirY * (segPos + stepLen) }
        onDash(a, b)
      }

      segPos += stepLen
      distanceSoFar += stepLen
    }
  }
}

/** The yellow dashed centerline painted on top of the road surface. */
export function buildRoadCenterlineGeometry(roads: Road[], terrain: TerrainPatch): GeometryData {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const ring = closedRing(positions, normals, uvs, indices)
  const halfWidth = CENTERLINE_DASH_WIDTH_M / 2

  for (const road of roads) {
    if (!isDecoratedRoad(road.kind)) continue
    if (road.centerline.length < 2) continue

    walkDashSegments(road.centerline, CENTERLINE_DASH_LENGTH_M, CENTERLINE_GAP_LENGTH_M, (a, b) => {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      const nx = -dy / len
      const ny = dx / len

      const ha = sampleTerrainHeight(terrain, a.x, a.y) + ROAD_CENTERLINE_Y_EPSILON
      const hb = sampleTerrainHeight(terrain, b.x, b.y) + ROAD_CENTERLINE_Y_EPSILON

      ring.pushQuad(
        { x: a.x + nx * halfWidth, y: a.y + ny * halfWidth },
        { x: a.x - nx * halfWidth, y: a.y - ny * halfWidth },
        { x: b.x + nx * halfWidth, y: b.y + ny * halfWidth },
        { x: b.x - nx * halfWidth, y: b.y - ny * halfWidth },
        ha,
        ha,
        hb,
        hb,
      )
    })
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  }
}
