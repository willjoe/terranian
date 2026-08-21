import type { LocalPoint } from '@/geo/coords'
import type { Road, TerrainPatch } from '@/world/schema'
import { sampleTerrainHeight } from '@/generation/sampleHeight'
import { toThreeVec3 } from '@/generation/toThreeSpace'
import type { GeometryData } from '@/generation/geometryTypes'
import { bridgeHeightAt } from '@/world/bridges'

/**
 * Draped-layer height stacking (kept in sync with LAND_USE_Y_EPSILON /
 * WATER_Y_EPSILON in generation/landUseGeometry.ts): terrain < land-use <
 * road outline (sidewalk) < road surface < water. Every layer, roads
 * included, uses normal depthTest/depthWrite (scene/Roads.tsx) rather
 * than a paint-order trick, so these gaps are what actually decide what's
 * on top — real depth, the same as buildings/trees participate in. Each
 * gap is wide — not just a few centimeters — because two *different*
 * layers rarely sample terrain height at exactly the same (x,y) point (a
 * land-use polygon's edge vs. a road's offset edge, for instance), so on
 * sloped real terrain a small gap can still be crossed by the slope
 * itself between those two sample points, not just by float/GPU
 * precision. The centerline stripe is the one exception — see
 * CENTERLINE_LIFT_ABOVE_ROAD_M below for why it doesn't need a wide gap.
 *
 * Water sits *above* the road layers specifically so an ordinary
 * (non-bridge) road that happens to graze a water polygon's edge still
 * loses to it — a real road only belongs above water where it's actually
 * a bridge (OSM's `bridge` tag, or a geometrically-detected water/building
 * crossing — see isBridgeRoad below and world/bridges.ts). A bridge road's
 * own bridgeSpans elevation (see bridgeHeightAt calls below) reaches its
 * full required clearance — routinely tens of meters for a real water
 * crossing — exactly at the water's edge, so it clears WATER_Y_EPSILON by
 * a comfortable margin well before the two could compete on epsilon alone.
 */
const ROAD_OUTLINE_Y_EPSILON = 0.15
/** How far above the ground the road's top surface sits — also what DrivingRig.tsx grounds the car to while it's over a road, see sampleRoadSurfaceHeight below. */
const ROAD_SURFACE_Y_EPSILON = 0.3
/**
 * The dashed centerline is lifted this far above the road surface's own
 * height profile (not terrain) — see buildRoadCenterlineGeometry, which
 * interpolates along the same per-vertex top heights buildRoadBoxGeometry
 * draws rather than resampling raw terrain. Because both surfaces are
 * built from the identical profile, a couple centimeters is enough to
 * beat z-fighting with no risk of the two diverging on a slope — unlike
 * the terrain-relative gaps above, there's no "different sample point"
 * for this pair to disagree on.
 */
const CENTERLINE_LIFT_ABOVE_ROAD_M = 0.02

/**
 * The road surface (buildRoadsGeometry) is extruded down by this much
 * from its draped top height, rather than being a flat plane — see
 * buildRoadBoxGeometry. At grade this buries the box well below
 * ROAD_SURFACE_Y_EPSILON's small offset, so only the top face pokes out,
 * same as the old flat ribbon. On a bridge, bridgeHeightAt lifts the top
 * (and this fixed-thickness bottom right along with it) well clear of the
 * ground, so the deck reads as a real elevated structure — sides and
 * underside visible — instead of a paper-thin sheet floating in midair.
 */
const ROAD_BOX_HEIGHT_M = 2

/** How far the grey outline (sidewalk) extends past each edge of the road surface itself. */
const SIDEWALK_WIDTH_M = 1.5

const CENTERLINE_DASH_WIDTH_M = 0.3
const CENTERLINE_DASH_LENGTH_M = 3
const CENTERLINE_GAP_LENGTH_M = 3

/** Footways/paths are already pedestrian space — they get neither a painted centerline nor a separate sidewalk outline. */
function isDecoratedRoad(road: Road): boolean {
  return road.kind !== 'footway' && road.kind !== 'path'
}

/**
 * A road counts as a bridge if OSM tagged it so (any `bridge` value other
 * than absent/"no"), or if world/bridges.ts detected its centerline
 * actually crossing water or a building footprint and computed a
 * bridgeSpans elevation profile for it — see scene/Roads.tsx for why that
 * matters for draw order against water.
 */
function isBridgeRoad(road: Road): boolean {
  const bridge = road.tags.bridge
  return (bridge !== undefined && bridge !== 'no') || (road.bridgeSpans !== undefined && road.bridgeSpans.length > 0)
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

/**
 * Extruded box ribbon shared by the road surface and the sidewalk
 * outline: walks each road's centerline computing a left/right offset at
 * `halfWidthFor(road)`, then for every cross-section emits a top face (at
 * the usual terrain-drape + `yEpsilon` + bridge height), a bottom face
 * ROAD_BOX_HEIGHT_M below it, and two side walls connecting them — a
 * hollow rectangular tube running the length of the road (open at the
 * very ends, same as the old flat ribbon never capped its ends either).
 * At grade this buries the box well below its thin top-surface offset, so
 * only the top face pokes out; wherever bridgeHeightAt lifts a bridge
 * road's top clear of the ground, the same fixed thickness lifts the
 * bottom right along with it, so the deck reads as a real elevated
 * structure — sides and underside visible — instead of a paper-thin sheet
 * floating in midair. Left/right wall normals reuse the same per-vertex
 * offset direction (nx,ny) already computed for the left/right edge
 * points, just pointed outward instead of used to offset a position;
 * toThreeVec3 maps local Y to three.js's negated Z, so an outward
 * direction (nx,ny) in local space becomes (nx,0,-ny) in scene space (and
 * its mirror for the other wall).
 */
function buildRoadBoxGeometry(
  roads: Road[],
  terrain: TerrainPatch,
  halfWidthFor: (road: Road) => number,
  yEpsilon: number,
  filter: (road: Road) => boolean,
): GeometryData {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const pushQuad = (
    a: LocalPoint,
    b: LocalPoint,
    c: LocalPoint,
    d: LocalPoint,
    ha: number,
    hb: number,
    hc: number,
    hd: number,
    nx: number,
    ny: number,
    nz: number,
  ) => {
    const start = positions.length / 3
    for (const [p, h] of [
      [a, ha],
      [b, hb],
      [c, hc],
      [d, hd],
    ] as const) {
      positions.push(...toThreeVec3(p, h))
      normals.push(nx, ny, nz)
      uvs.push(0, 0)
    }
    indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3)
  }

  for (const road of roads) {
    if (!filter(road)) continue
    const line = road.centerline
    if (line.length < 2) continue

    const halfWidth = halfWidthFor(road)
    const left: LocalPoint[] = []
    const right: LocalPoint[] = []
    const edgeNormalX: number[] = []
    const edgeNormalY: number[] = []
    const topHeights: number[] = []
    let distanceSoFar = 0

    for (let i = 0; i < line.length; i++) {
      const prev = line[Math.max(0, i - 1)]
      const next = line[Math.min(line.length - 1, i + 1)]
      const dx = next.x - prev.x
      const dy = next.y - prev.y
      const len = Math.hypot(dx, dy) || 1
      const nx = -dy / len
      const ny = dx / len

      const p = line[i]
      if (i > 0) distanceSoFar += Math.hypot(p.x - line[i - 1].x, p.y - line[i - 1].y)
      left.push({ x: p.x + nx * halfWidth, y: p.y + ny * halfWidth })
      right.push({ x: p.x - nx * halfWidth, y: p.y - ny * halfWidth })
      edgeNormalX.push(nx)
      edgeNormalY.push(ny)
      topHeights.push(sampleTerrainHeight(terrain, p.x, p.y) + yEpsilon + bridgeHeightAt(road.bridgeSpans, distanceSoFar))
    }

    for (let i = 0; i < line.length - 1; i++) {
      const topA = topHeights[i]
      const topB = topHeights[i + 1]
      const botA = topA - ROAD_BOX_HEIGHT_M
      const botB = topB - ROAD_BOX_HEIGHT_M

      pushQuad(left[i], right[i], left[i + 1], right[i + 1], topA, topA, topB, topB, 0, 1, 0)
      pushQuad(left[i], right[i], left[i + 1], right[i + 1], botA, botA, botB, botB, 0, -1, 0)
      pushQuad(left[i], left[i], left[i + 1], left[i + 1], topA, botA, topB, botB, edgeNormalX[i], 0, -edgeNormalY[i])
      pushQuad(right[i], right[i], right[i + 1], right[i + 1], topA, botA, topB, botB, -edgeNormalX[i], 0, edgeNormalY[i])
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
 * The dark road surface, extruded ROAD_BOX_HEIGHT_M deep as a box rather
 * than a flat plane (see buildRoadBoxGeometry) — normally submerged into
 * the ground with only its top face showing, exposed as a real elevated
 * deck wherever a bridge lifts it clear of the terrain. Deliberately
 * narrower than the outline layer beneath it (see buildRoadOutlineGeometry)
 * so that layer only shows through as a margin on either side rather than
 * being fully covered. `bridgesOnly` splits the result into the
 * bridge/non-bridge road sets scene/Roads.tsx renders on either side of
 * water in the paint order — pass the same value to
 * buildRoadOutlineGeometry/buildRoadCenterlineGeometry for a matching pair
 * of layers.
 */
export function buildRoadsGeometry(roads: Road[], terrain: TerrainPatch, bridgesOnly: boolean): GeometryData {
  return buildRoadBoxGeometry(
    roads,
    terrain,
    (road) => road.widthMeters / 2,
    ROAD_SURFACE_Y_EPSILON,
    (road) => isBridgeRoad(road) === bridgesOnly,
  )
}

/** One drivable-surface segment for sampleRoadSurfaceHeight — plain centerline endpoints plus the interpolated top height at each, no left/right offsets or mesh data needed for a point-in-road test. */
export interface RoadSurfaceCollider {
  ax: number
  ay: number
  bx: number
  by: number
  halfWidth: number
  ha: number
  hb: number
}

/**
 * Precomputed once per (roads, terrain) pair by generation/carPhysics.ts
 * (see DrivingRig.tsx) — the same top-height math as buildRoadsGeometry's
 * top face, flattened to plain segments for stepCarPhysics's per-frame
 * ground-height sampling below, rather than a renderable mesh. Only the
 * drivable road width (not the sidewalk outline's extra margin) counts,
 * matching buildRoadsGeometry's own halfWidth exactly so the car's
 * elevation always agrees with where the visible road box actually is.
 */
export function computeRoadSurfaceColliders(roads: Road[], terrain: TerrainPatch): RoadSurfaceCollider[] {
  const colliders: RoadSurfaceCollider[] = []
  for (const road of roads) {
    const line = road.centerline
    if (line.length < 2) continue

    const halfWidth = road.widthMeters / 2
    let distanceSoFar = 0
    let prevHeight = sampleTerrainHeight(terrain, line[0].x, line[0].y) + ROAD_SURFACE_Y_EPSILON + bridgeHeightAt(road.bridgeSpans, 0)

    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i]
      const b = line[i + 1]
      distanceSoFar += Math.hypot(b.x - a.x, b.y - a.y)
      const height = sampleTerrainHeight(terrain, b.x, b.y) + ROAD_SURFACE_Y_EPSILON + bridgeHeightAt(road.bridgeSpans, distanceSoFar)
      colliders.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, halfWidth, ha: prevHeight, hb: height })
      prevHeight = height
    }
  }
  return colliders
}

/**
 * The road's top-surface height at (x,y), or null if that point isn't
 * over any road — the ground-height stepCarPhysics uses instead of raw
 * terrain while driving on a road, so the car rests on the road's visible
 * top face rather than clipping into it (see ROAD_SURFACE_Y_EPSILON).
 * "Over a road" is approximated as perpendicular distance to a segment
 * (clamped to its endpoints) within that road's halfWidth — a capsule
 * around each segment rather than the mesh's exact per-joint rectangles,
 * close enough for grounding a car-sized circle and much cheaper to test.
 * Where roads overlap (an overpass above another road), the higher one
 * wins, same tie-break as clippedRoofHeight in carPhysics.ts.
 */
export function sampleRoadSurfaceHeight(colliders: RoadSurfaceCollider[], x: number, y: number): number | null {
  let best: number | null = null
  for (const c of colliders) {
    const dx = c.bx - c.ax
    const dy = c.by - c.ay
    const lenSq = dx * dx + dy * dy
    let t = lenSq > 0 ? ((x - c.ax) * dx + (y - c.ay) * dy) / lenSq : 0
    t = Math.max(0, Math.min(1, t))
    const closestX = c.ax + t * dx
    const closestY = c.ay + t * dy
    if (Math.hypot(x - closestX, y - closestY) > c.halfWidth) continue

    const height = c.ha + (c.hb - c.ha) * t
    if (best === null || height > best) best = height
  }
  return best
}

/**
 * A wider grey box draped *below* the road surface, standing in for a
 * sidewalk/curb margin — same box treatment as buildRoadsGeometry (see
 * buildRoadBoxGeometry), just wider and shallower so at intersections,
 * where several roads' wide outline boxes overlap each other, they simply
 * blend into one continuous grey area rather than showing seams, and the
 * (separately drawn, higher) road surfaces on top cleanly hide the parts
 * of the outline that are actually driven on, leaving only the outer
 * margin visible.
 */
export function buildRoadOutlineGeometry(roads: Road[], terrain: TerrainPatch, bridgesOnly: boolean): GeometryData {
  return buildRoadBoxGeometry(
    roads,
    terrain,
    (road) => road.widthMeters / 2 + SIDEWALK_WIDTH_M,
    ROAD_OUTLINE_Y_EPSILON,
    (road) => isDecoratedRoad(road) && isBridgeRoad(road) === bridgesOnly,
  )
}

/** Walks a polyline by arc length, invoking `onDash` with each sub-segment (and its arc-length distance from the line's start) that falls within an "on" dash period. */
function walkDashSegments(
  line: LocalPoint[],
  dashLength: number,
  gapLength: number,
  onDash: (a: LocalPoint, aDistance: number, b: LocalPoint, bDistance: number) => void,
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
        onDash(a, distanceSoFar, b, distanceSoFar + stepLen)
      }

      segPos += stepLen
      distanceSoFar += stepLen
    }
  }
}

/**
 * The yellow dashed centerline painted on top of the road surface. Height
 * is interpolated along the same per-vertex top-height profile
 * buildRoadBoxGeometry draws for the road's top face (not a fresh terrain
 * sample) — the box's top face is flat between consecutive centerline
 * vertices (GPU-interpolated from the two endpoint heights, not resampled
 * terrain), so matching that same interpolation is what makes the stripe
 * actually sit on the drawn surface rather than the true — possibly
 * bumpier — ground underneath it.
 */
export function buildRoadCenterlineGeometry(roads: Road[], terrain: TerrainPatch, bridgesOnly: boolean): GeometryData {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const ring = closedRing(positions, normals, uvs, indices)
  const halfWidth = CENTERLINE_DASH_WIDTH_M / 2

  for (const road of roads) {
    if (!isDecoratedRoad(road) || isBridgeRoad(road) !== bridgesOnly) continue
    const line = road.centerline
    if (line.length < 2) continue

    // Same per-vertex top-height profile as buildRoadBoxGeometry's top
    // face: one sample per centerline vertex, at its true cumulative arc
    // length.
    const vertexDistances: number[] = [0]
    const vertexTopHeights: number[] = [
      sampleTerrainHeight(terrain, line[0].x, line[0].y) + ROAD_SURFACE_Y_EPSILON + bridgeHeightAt(road.bridgeSpans, 0),
    ]
    for (let i = 1; i < line.length; i++) {
      const d = vertexDistances[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y)
      vertexDistances.push(d)
      vertexTopHeights.push(
        sampleTerrainHeight(terrain, line[i].x, line[i].y) + ROAD_SURFACE_Y_EPSILON + bridgeHeightAt(road.bridgeSpans, d),
      )
    }

    // walkDashSegments below visits strictly increasing arc-length
    // distances in one forward pass, so this pointer only ever advances.
    let segIdx = 0
    const heightAtDistance = (distance: number) => {
      while (segIdx < vertexDistances.length - 2 && distance > vertexDistances[segIdx + 1]) segIdx++
      const segStart = vertexDistances[segIdx]
      const segEnd = vertexDistances[segIdx + 1]
      const t = segEnd > segStart ? (distance - segStart) / (segEnd - segStart) : 0
      return vertexTopHeights[segIdx] + (vertexTopHeights[segIdx + 1] - vertexTopHeights[segIdx]) * t
    }

    walkDashSegments(line, CENTERLINE_DASH_LENGTH_M, CENTERLINE_GAP_LENGTH_M, (a, aDistance, b, bDistance) => {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      const nx = -dy / len
      const ny = dx / len

      const ha = heightAtDistance(aDistance) + CENTERLINE_LIFT_ABOVE_ROAD_M
      const hb = heightAtDistance(bDistance) + CENTERLINE_LIFT_ABOVE_ROAD_M

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
