import type { LocalPoint } from '@/geo/coords'
import { boundsOfPoints, boundsOverlap, pointInPolygon, type LocalBounds } from '@/geo/pointInPolygon'
import type { Building, BridgeSpan, LandUseArea, Road } from '@/world/schema'

/** Max grade a bridge deck may climb/descend at — 5%, i.e. 1m of rise per 20m of run. Also how far in advance a ramp has to start to clear a given obstacle height. */
const MAX_BRIDGE_GRADE = 0.05

/** Vertical clearance added above a building's own roof height when a bridge needs to pass over it. */
const BUILDING_CLEARANCE_MARGIN_M = 3

/**
 * Ship-clearance-over-water formula: two real-world anchor points (a 1km
 * bridge needs to clear a ~20m ship, a 4km bridge a ~75m ship — longer
 * water crossings tend to be over deeper/busier shipping channels) define
 * a straight-line gradient; clearance for any other span length is read
 * off that line. Clamped at the low end so a short creek crossing still
 * gets some minimum clearance rather than an unrealistically low bridge.
 */
const WATER_SPAN_SHORT_M = 1000
const WATER_CLEARANCE_SHORT_M = 20
const WATER_SPAN_LONG_M = 4000
const WATER_CLEARANCE_LONG_M = 75
const WATER_CLEARANCE_GRADIENT_M_PER_M =
  (WATER_CLEARANCE_LONG_M - WATER_CLEARANCE_SHORT_M) / (WATER_SPAN_LONG_M - WATER_SPAN_SHORT_M)
const MIN_WATER_CLEARANCE_M = 6

/** How finely a road's centerline is resampled to detect where it crosses water/building footprints. */
const OBSTACLE_SAMPLE_STEP_M = 4

/**
 * Fixed vertical clearance for a road-over-road crossing detected via
 * OSM's `layer` tag (see roadLayer/isNearRoad and the road-crossing pass
 * in computeBridgeSpans below) — unlike the water/building clearances
 * above, this isn't derived from anything about the crossing itself
 * (span length, ship size, building height); it's just "clear enough for
 * a real overpass," per spec.
 */
const LAYER_CROSSING_CLEARANCE_M = 10

function shipClearanceForSpan(spanMeters: number): number {
  const clearance = WATER_CLEARANCE_SHORT_M + WATER_CLEARANCE_GRADIENT_M_PER_M * (spanMeters - WATER_SPAN_SHORT_M)
  return Math.max(MIN_WATER_CLEARANCE_M, clearance)
}

interface ResampledPoint {
  point: LocalPoint
  distance: number
}

/** Resamples a polyline at roughly `step` meter intervals, tagging each sample with its arc-length distance from the start. */
function resample(line: LocalPoint[], step: number): ResampledPoint[] {
  const out: ResampledPoint[] = [{ point: line[0], distance: 0 }]
  let distance = 0
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]
    const b = line[i + 1]
    const segLen = Math.hypot(b.x - a.x, b.y - a.y)
    if (segLen === 0) continue
    const steps = Math.max(1, Math.ceil(segLen / step))
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      distance += segLen / steps
      out.push({ point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, distance })
    }
  }
  return out
}

interface ObstacleInterval {
  start: number
  end: number
  height: number
}

/** Contiguous arc-length ranges of `samples` where `isInside` holds, each with the clearance height `requiredHeightForSpan` computes from that range's own length. Shared by the polygon-based (water/building) and road-based (layer-crossing) obstacle scans below. */
function intervalsWhere(
  samples: ResampledPoint[],
  isInside: (p: LocalPoint) => boolean,
  requiredHeightForSpan: (spanMeters: number) => number,
): ObstacleInterval[] {
  const intervals: ObstacleInterval[] = []
  let startIdx = -1
  for (let i = 0; i <= samples.length; i++) {
    const inside = i < samples.length && isInside(samples[i].point)
    if (inside && startIdx === -1) startIdx = i
    else if (!inside && startIdx !== -1) {
      const start = samples[startIdx].distance
      const end = samples[i - 1].distance
      intervals.push({ start, end, height: requiredHeightForSpan(end - start) })
      startIdx = -1
    }
  }
  return intervals
}

/** Contiguous arc-length ranges of `samples` that fall inside `polygon`, each with the clearance height `requiredHeightForSpan` computes from that range's own length. */
function obstacleIntervals(
  samples: ResampledPoint[],
  polygon: LocalPoint[],
  polygonBounds: LocalBounds,
  requiredHeightForSpan: (spanMeters: number) => number,
): ObstacleInterval[] {
  return intervalsWhere(
    samples,
    (p) =>
      p.x >= polygonBounds.minX &&
      p.x <= polygonBounds.maxX &&
      p.y >= polygonBounds.minY &&
      p.y <= polygonBounds.maxY &&
      pointInPolygon(p, polygon),
    requiredHeightForSpan,
  )
}

/** OSM `layer` tag, parsed as an integer (0 — ground level — if absent or unparseable). Roads with no layer tag at all both default to 0, so two untagged roads crossing never trigger a bridge — only an explicit layer difference does. */
function roadLayer(road: Road): number {
  const raw = road.tags.layer
  if (raw === undefined) return 0
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

/** Whether `p` falls within `road`'s own drivable half-width of its centerline — the same capsule-around-each-segment approximation generation/roadGeometry.ts's sampleRoadSurfaceHeight uses for "is this point on the road," reused here to find where one road's line actually overlaps another's pavement footprint rather than just their bounding boxes. */
function isNearRoad(p: LocalPoint, road: Road): boolean {
  const halfWidth = road.widthMeters / 2
  const line = road.centerline
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]
    const b = line[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    let t = lenSq > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq : 0
    t = Math.max(0, Math.min(1, t))
    const closestX = a.x + t * dx
    const closestY = a.y + t * dy
    if (Math.hypot(p.x - closestX, p.y - closestY) <= halfWidth) return true
  }
  return false
}

/**
 * Merges obstacles close enough together that a MAX_BRIDGE_GRADE ramp
 * couldn't fully descend to ground and back up between them — "count it
 * as one bridge until you can reach ground level" — into a single span
 * spanning both, at whichever's clearance height is greater.
 */
function mergeObstacles(obstacles: ObstacleInterval[]): ObstacleInterval[] {
  const sorted = [...obstacles].sort((a, b) => a.start - b.start)
  const merged: ObstacleInterval[] = []
  for (const obstacle of sorted) {
    const last = merged[merged.length - 1]
    const gapNeeded = last ? last.height / MAX_BRIDGE_GRADE + obstacle.height / MAX_BRIDGE_GRADE : 0
    if (last && obstacle.start - last.end < gapNeeded) {
      last.end = Math.max(last.end, obstacle.end)
      last.height = Math.max(last.height, obstacle.height)
    } else {
      merged.push({ ...obstacle })
    }
  }
  return merged
}

function roadLength(line: LocalPoint[]): number {
  let length = 0
  for (let i = 0; i < line.length - 1; i++) length += Math.hypot(line[i + 1].x - line[i].x, line[i + 1].y - line[i].y)
  return length
}

/** Millimeter-precision key for matching two centerline endpoints — coordinates converted from the same OSM node via the same latLonToLocal call land on exactly the same float, so this only needs to survive that, not real-world GPS noise. */
function pointKey(p: LocalPoint): string {
  return `${p.x.toFixed(3)}:${p.y.toFixed(3)}`
}

/**
 * Groups roads into chains of end-to-end centerline-continuous segments:
 * same `kind`, and the last point of one road lands exactly on the first
 * point of the next, with no ambiguity on either side (more than one
 * same-kind candidate at that shared point means a real fork/junction,
 * not a plain way-split, so it's deliberately left unlinked rather than
 * guessed at).
 *
 * OSM routinely splits one physical road — a bridge included — into
 * several ways at intersections along its length. Without this,
 * computeBridgeSpans would see each piece in isolation via its own
 * `roads` entry and compute a ramp that needed more room than that one
 * piece alone had, clamping rampStart/rampEnd to that piece's own
 * [0, length] and producing an artificially steep grade right at the
 * split — as if the algorithm thought it was starting a fresh, shorter
 * bridge instead of continuing the one that began in the previous piece.
 * Chaining first means the ramp is computed across the *whole* physical
 * bridge's true length, then split back out per road (see
 * computeBridgeSpans), so a piece in the middle of a long ramp just gets
 * a partial-height BridgeSpan rather than its own doomed-to-clamp one.
 */
function buildRoadChains(roads: Road[]): Road[][] {
  const eligible = roads.filter((r) => r.centerline.length >= 2)
  const startsAt = new Map<string, Road[]>()
  const endsAt = new Map<string, Road[]>()
  for (const road of eligible) {
    const startKey = pointKey(road.centerline[0])
    const endKey = pointKey(road.centerline[road.centerline.length - 1])
    if (!startsAt.has(startKey)) startsAt.set(startKey, [])
    startsAt.get(startKey)!.push(road)
    if (!endsAt.has(endKey)) endsAt.set(endKey, [])
    endsAt.get(endKey)!.push(road)
  }

  const next = new Map<Road, Road>()
  const hasPredecessor = new Set<Road>()
  for (const road of eligible) {
    const joinKey = pointKey(road.centerline[road.centerline.length - 1])
    const successors = (startsAt.get(joinKey) ?? []).filter((r) => r !== road && r.kind === road.kind)
    if (successors.length !== 1) continue
    const predecessors = (endsAt.get(joinKey) ?? []).filter((r) => r.kind === road.kind)
    if (predecessors.length !== 1) continue // road itself, uniquely — anything else means a real junction there

    next.set(road, successors[0])
    hasPredecessor.add(successors[0])
  }

  const chains: Road[][] = []
  const visited = new Set<Road>()
  for (const road of eligible) {
    if (hasPredecessor.has(road) || visited.has(road)) continue
    const chain: Road[] = []
    let current: Road | undefined = road
    while (current && !visited.has(current)) {
      visited.add(current)
      chain.push(current)
      current = next.get(current)
    }
    chains.push(chain)
  }
  // Only reachable via a cycle (a closed loop road linked to itself through `next`), which the walk above never visits as a head.
  for (const road of eligible) if (!visited.has(road)) chains.push([road])
  for (const road of roads) if (road.centerline.length < 2) chains.push([road])

  return chains
}

/**
 * Computes each road's bridge elevation profile from where its centerline
 * geometrically crosses water or building footprints — independent of
 * whether OSM tagged it `bridge=yes` (real bridges are frequently
 * untagged, or the tag lands on only part of a longer way) — plus
 * wherever it crosses another road that OSM's `layer` tag says sits
 * below it (see roadLayer/isNearRoad; LAYER_CROSSING_CLEARANCE_M is a
 * fixed 10m for these rather than a derived height, since a road has no
 * "height" of its own the way a building or ship channel does).
 *
 * Obstacle detection and ramp geometry both run per *chain* (see
 * buildRoadChains) rather than per individual road entry, using each
 * chain's full combined arc length — so a bridge whose OSM way got split
 * partway across still gets one continuous, correctly-graded ramp instead
 * of two independently-clamped (and too-steep) ones. Each merged obstacle
 * becomes one BridgeSpan: a single ramp up (at most MAX_BRIDGE_GRADE, the
 * same real-world-grade cap for every obstacle source) starting early
 * enough to clear the obstacle, a flat plateau at the required clearance
 * height for its whole length, then a single ramp back down — one
 * continuous arch, never more than one hump — after which chain-relative
 * spans are translated back into each member road's own local coordinate
 * space (clipped to that road's own length) for the returned map.
 */
export function computeBridgeSpans(roads: Road[], buildings: Building[], landUse: LandUseArea[]): Map<string, BridgeSpan[]> {
  const waterPolygons = landUse.filter((a) => a.kind === 'water').map((a) => a.polygon)
  const waterBounds = waterPolygons.map(boundsOfPoints)
  const buildingBounds = buildings.map((b) => boundsOfPoints(b.footprint))
  const roadBoundsList = roads.map((r) => boundsOfPoints(r.centerline))

  const result = new Map<string, BridgeSpan[]>()

  for (const chain of buildRoadChains(roads)) {
    const lengths = chain.map((road) => roadLength(road.centerline))
    const offsets: number[] = []
    let chainTotal = 0
    for (const length of lengths) {
      offsets.push(chainTotal)
      chainTotal += length
    }

    const chainObstacles: ObstacleInterval[] = []

    chain.forEach((road, idx) => {
      if (road.centerline.length < 2) return

      const roadBounds = boundsOfPoints(road.centerline)
      const samples = resample(road.centerline, OBSTACLE_SAMPLE_STEP_M)
      const offset = offsets[idx]

      const localObstacles: ObstacleInterval[] = []
      waterPolygons.forEach((polygon, i) => {
        if (!boundsOverlap(roadBounds, waterBounds[i])) return
        localObstacles.push(...obstacleIntervals(samples, polygon, waterBounds[i], shipClearanceForSpan))
      })
      buildings.forEach((building, i) => {
        if (!boundsOverlap(roadBounds, buildingBounds[i])) return
        const requiredHeight = building.heightMeters + BUILDING_CLEARANCE_MARGIN_M
        localObstacles.push(...obstacleIntervals(samples, building.footprint, buildingBounds[i], () => requiredHeight))
      })
      const layer = roadLayer(road)
      roads.forEach((other, i) => {
        if (other === road || roadLayer(other) >= layer) return
        if (!boundsOverlap(roadBounds, roadBoundsList[i])) return
        localObstacles.push(...intervalsWhere(samples, (p) => isNearRoad(p, other), () => LAYER_CROSSING_CLEARANCE_M))
      })

      for (const o of localObstacles) chainObstacles.push({ start: o.start + offset, end: o.end + offset, height: o.height })
    })

    if (chainObstacles.length === 0) continue

    const chainSpans: BridgeSpan[] = mergeObstacles(chainObstacles).map((o) => {
      const rampDistance = o.height / MAX_BRIDGE_GRADE
      return {
        rampStart: Math.max(0, o.start - rampDistance),
        rampEnd: Math.min(chainTotal, o.end + rampDistance),
        plateauStart: o.start,
        plateauEnd: o.end,
        heightMeters: o.height,
      }
    })

    chain.forEach((road, idx) => {
      const offset = offsets[idx]
      const length = lengths[idx]
      const localSpans: BridgeSpan[] = []
      for (const span of chainSpans) {
        // Overlap test against this road's own [0, length] window within
        // the chain — a span whose ramp starts in the previous road and
        // plateaus in this one still matches here, just with a rampStart
        // that lands before this road's own 0 (bridgeHeightAt's linear
        // interpolation handles that correctly: distance=0 then reads as
        // "already partway up," continuing smoothly from where the
        // previous road left off, instead of restarting the ramp).
        if (span.rampEnd <= offset || span.rampStart >= offset + length) continue
        localSpans.push({
          rampStart: span.rampStart - offset,
          rampEnd: span.rampEnd - offset,
          plateauStart: span.plateauStart - offset,
          plateauEnd: span.plateauEnd - offset,
          heightMeters: span.heightMeters,
        })
      }
      if (localSpans.length > 0) result.set(road.id, localSpans)
    })
  }

  return result
}

/** Extra height above the normal terrain-drape height at `distance` meters along a road's centerline, from that road's BridgeSpans (0 if none apply). */
export function bridgeHeightAt(spans: BridgeSpan[] | undefined, distance: number): number {
  if (!spans) return 0
  for (const span of spans) {
    if (distance < span.rampStart || distance > span.rampEnd) continue
    if (distance < span.plateauStart) {
      const denom = span.plateauStart - span.rampStart
      return span.heightMeters * (denom > 0 ? (distance - span.rampStart) / denom : 1)
    }
    if (distance <= span.plateauEnd) return span.heightMeters
    const denom = span.rampEnd - span.plateauEnd
    return span.heightMeters * (denom > 0 ? 1 - (distance - span.plateauEnd) / denom : 0)
  }
  return 0
}
