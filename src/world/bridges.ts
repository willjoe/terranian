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

/** Contiguous arc-length ranges of `samples` that fall inside `polygon`, each with the clearance height `requiredHeightForSpan` computes from that range's own length. */
function obstacleIntervals(
  samples: ResampledPoint[],
  polygon: LocalPoint[],
  polygonBounds: LocalBounds,
  requiredHeightForSpan: (spanMeters: number) => number,
): ObstacleInterval[] {
  const intervals: ObstacleInterval[] = []
  let startIdx = -1
  for (let i = 0; i <= samples.length; i++) {
    const p = i < samples.length ? samples[i].point : null
    const isInside =
      p !== null &&
      p.x >= polygonBounds.minX &&
      p.x <= polygonBounds.maxX &&
      p.y >= polygonBounds.minY &&
      p.y <= polygonBounds.maxY &&
      pointInPolygon(p, polygon)

    if (isInside && startIdx === -1) startIdx = i
    else if (!isInside && startIdx !== -1) {
      const start = samples[startIdx].distance
      const end = samples[i - 1].distance
      intervals.push({ start, end, height: requiredHeightForSpan(end - start) })
      startIdx = -1
    }
  }
  return intervals
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

/**
 * Computes each road's bridge elevation profile from where its centerline
 * geometrically crosses water or building footprints — independent of
 * whether OSM tagged it `bridge=yes` (real bridges are frequently
 * untagged, or the tag lands on only part of a longer way). Each merged
 * obstacle becomes one BridgeSpan: a single ramp up (at most
 * MAX_BRIDGE_GRADE) starting early enough to clear the obstacle, a flat
 * plateau at the required clearance height for its whole length, then a
 * single ramp back down — one continuous arch, never more than one hump.
 */
export function computeBridgeSpans(roads: Road[], buildings: Building[], landUse: LandUseArea[]): Map<string, BridgeSpan[]> {
  const waterPolygons = landUse.filter((a) => a.kind === 'water').map((a) => a.polygon)
  const waterBounds = waterPolygons.map(boundsOfPoints)
  const buildingBounds = buildings.map((b) => boundsOfPoints(b.footprint))

  const result = new Map<string, BridgeSpan[]>()
  for (const road of roads) {
    if (road.centerline.length < 2) continue

    const roadBounds = boundsOfPoints(road.centerline)
    const samples = resample(road.centerline, OBSTACLE_SAMPLE_STEP_M)
    const total = roadLength(road.centerline)

    const obstacles: ObstacleInterval[] = []
    waterPolygons.forEach((polygon, i) => {
      if (!boundsOverlap(roadBounds, waterBounds[i])) return
      obstacles.push(...obstacleIntervals(samples, polygon, waterBounds[i], shipClearanceForSpan))
    })
    buildings.forEach((building, i) => {
      if (!boundsOverlap(roadBounds, buildingBounds[i])) return
      const requiredHeight = building.heightMeters + BUILDING_CLEARANCE_MARGIN_M
      obstacles.push(...obstacleIntervals(samples, building.footprint, buildingBounds[i], () => requiredHeight))
    })

    if (obstacles.length === 0) continue

    const spans: BridgeSpan[] = mergeObstacles(obstacles).map((o) => {
      const rampDistance = o.height / MAX_BRIDGE_GRADE
      return {
        rampStart: Math.max(0, o.start - rampDistance),
        rampEnd: Math.min(total, o.end + rampDistance),
        plateauStart: o.start,
        plateauEnd: o.end,
        heightMeters: o.height,
      }
    })
    result.set(road.id, spans)
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
