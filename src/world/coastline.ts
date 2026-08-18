import { latLonToLocal, type LatLon, type LocalPoint } from '@/geo/coords'
import type { OsmWay } from '@/data/types'

function distanceToSegmentSquared(p: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
  const closestX = a.x + t * dx
  const closestY = a.y + t * dy
  return (p.x - closestX) ** 2 + (p.y - closestY) ** 2
}

/**
 * Classifies a point by which side it falls on of the *nearest* coastline
 * segment, using OSM's convention directly (walking a->b, land is on the
 * left, water on the right). This is a local, nearest-boundary classifier
 * rather than a global one (e.g. winding number): a single mis-directed or
 * very distant coastline segment — a real, documented OSM data quality
 * issue — can corrupt every query point along a global ray-cast even if
 * that segment is nowhere near them, whereas here only the closest piece
 * of coastline to each point ever matters.
 */
function isWater(point: LocalPoint, segments: [LocalPoint, LocalPoint][]): boolean {
  let nearestDistSq = Infinity
  let nearest: [LocalPoint, LocalPoint] | null = null
  for (const seg of segments) {
    const d = distanceToSegmentSquared(point, seg[0], seg[1])
    if (d < nearestDistSq) {
      nearestDistSq = d
      nearest = seg
    }
  }
  if (!nearest) return false

  const [a, b] = nearest
  const dx = b.x - a.x
  const dy = b.y - a.y
  const cross = dx * (point.y - a.y) - dy * (point.x - a.x)
  return cross < 0
}

/**
 * Grid resolution (cells per side) for the marching-squares water/land
 * field. Real coastlines (marinas, docks, narrow channels) can be far too
 * intricate for a "walk the boundary, splice in the coastline" vector
 * approach to reconstruct reliably — that approach was tried and found to
 * produce badly wrong shapes (verified against real OpenStreetMap tile
 * imagery) for anything more complex than a single simple bay. Sampling
 * the (already-correct) isWater classifier on a grid and contouring it is
 * far more robust: it has no global topology assumptions to violate,
 * handling any number of islands/channels/inlets correctly by construction.
 */
const WATER_GRID_RESOLUTION = 96

function edgeMidpoint(a: LocalPoint, b: LocalPoint): LocalPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Standard marching-squares case table. Corners are named a (top-left),
 * b (top-right), c (bottom-right), d (bottom-left); edges are the
 * midpoints between adjacent corners. Cases 5 and 10 are the ambiguous
 * "saddle" cases — resolved with one fixed, consistent pairing, which can
 * occasionally pinch/merge two diagonal water pockets in a cell but never
 * produces wrong topology at the resolution used here.
 */
function marchingSquaresSegments(
  a: boolean,
  b: boolean,
  c: boolean,
  d: boolean,
  top: LocalPoint,
  right: LocalPoint,
  bottom: LocalPoint,
  left: LocalPoint,
): [LocalPoint, LocalPoint][] {
  const caseIndex = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0)
  switch (caseIndex) {
    case 1:
    case 14:
      return [[left, bottom]]
    case 2:
    case 13:
      return [[bottom, right]]
    case 3:
    case 12:
      return [[left, right]]
    case 4:
    case 11:
      return [[top, right]]
    case 6:
    case 9:
      return [[top, bottom]]
    case 7:
    case 8:
      return [[left, top]]
    case 5:
      return [
        [left, top],
        [bottom, right],
      ]
    case 10:
      return [
        [top, right],
        [left, bottom],
      ]
    default:
      return []
  }
}

/** Connects marching-squares edge segments (undirected, matched by coordinate) into closed loops. */
function traceContours(segments: [LocalPoint, LocalPoint][]): LocalPoint[][] {
  const keyOf = (p: LocalPoint) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`
  const adjacency = new Map<string, { point: LocalPoint; segmentIndex: number }[]>()
  const used = new Set<number>()

  segments.forEach(([a, b], i) => {
    for (const [p, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const key = keyOf(p)
      const list = adjacency.get(key)
      const entry = { point: other, segmentIndex: i }
      if (list) list.push(entry)
      else adjacency.set(key, [entry])
    }
  })

  const contours: LocalPoint[][] = []

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue
    used.add(i)
    const contour: LocalPoint[] = [segments[i][0], segments[i][1]]

    for (let guard = 0; guard < segments.length + 1; guard++) {
      const tailKey = keyOf(contour[contour.length - 1])
      const candidates = adjacency.get(tailKey) ?? []
      const next = candidates.find((c) => !used.has(c.segmentIndex))
      if (!next) break
      used.add(next.segmentIndex)
      contour.push(next.point)
      if (keyOf(contour[contour.length - 1]) === keyOf(contour[0])) break
    }

    if (contour.length > 3) contours.push(contour.slice(0, -1))
  }

  return contours
}

/**
 * Reconstructs closed water polygon(s) for the given generation radius
 * from raw `natural=coastline` ways, which only mark the land/water
 * boundary as open lines — not a fillable area on their own.
 */
export function buildWaterPolygonsFromCoastline(origin: LatLon, coastlineWays: OsmWay[], radius: number): LocalPoint[][] {
  if (coastlineWays.length === 0) return []

  const allSegments: [LocalPoint, LocalPoint][] = []
  for (const way of coastlineWays) {
    const local = way.geometry.map((p) => latLonToLocal(origin, p))
    for (let i = 0; i < local.length - 1; i++) allSegments.push([local[i], local[i + 1]])
  }

  const resolution = WATER_GRID_RESOLUTION
  const gridSize = resolution + 1
  const step = (radius * 2) / resolution

  const gridPoint = (row: number, col: number): LocalPoint => ({
    x: -radius + col * step,
    y: -radius + row * step,
  })

  // A grid point counts as water only if it's both within the generation
  // radius and on the water side of the coastline — this is what clips
  // the reconstructed shape to the circle, for free, with no separate
  // boundary-splicing step.
  const isWaterGrid: boolean[] = new Array(gridSize * gridSize)
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const p = gridPoint(row, col)
      isWaterGrid[row * gridSize + col] = p.x * p.x + p.y * p.y <= radius * radius && isWater(p, allSegments)
    }
  }

  const segments: [LocalPoint, LocalPoint][] = []
  for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      const a = isWaterGrid[row * gridSize + col]
      const b = isWaterGrid[row * gridSize + col + 1]
      const c = isWaterGrid[(row + 1) * gridSize + col + 1]
      const d = isWaterGrid[(row + 1) * gridSize + col]
      if (a === b && b === c && c === d) continue // uniform cell, no boundary through it

      const topLeft = gridPoint(row, col)
      const topRight = gridPoint(row, col + 1)
      const bottomRight = gridPoint(row + 1, col + 1)
      const bottomLeft = gridPoint(row + 1, col)

      segments.push(
        ...marchingSquaresSegments(
          a,
          b,
          c,
          d,
          edgeMidpoint(topLeft, topRight),
          edgeMidpoint(topRight, bottomRight),
          edgeMidpoint(bottomLeft, bottomRight),
          edgeMidpoint(topLeft, bottomLeft),
        ),
      )
    }
  }

  return traceContours(segments)
}
