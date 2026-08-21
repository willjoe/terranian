import type { Building, TerrainPatch } from '@/world/schema'
import { sampleTerrainHeight } from '@/generation/sampleHeight'
import { sampleRoadSurfaceHeight, type RoadSurfaceCollider } from '@/generation/roadGeometry'

/**
 * Pure, three.js-free driving-mode vehicle simulation. scene/DrivingRig.tsx
 * calls stepCarPhysics once per frame and copies the result onto a
 * three.js group/camera — this module never touches three.js so it stays
 * unit-testable and consistent with the rest of generation/.
 */

export interface CarInput {
  /** up arrow */
  throttle: boolean
  /** down arrow — brakes while moving forward, reverses once stopped */
  brake: boolean
  left: boolean
  right: boolean
}

export interface CarState {
  /** local meters, x=east, y=north — same convention as LocalPoint */
  x: number
  y: number
  /** elevation, meters, same convention as TerrainPatch heights */
  elevation: number
  /** heading in radians, measured from +x (east) toward +y (north) */
  heading: number
  /** signed speed along heading, m/s — positive forward, negative reverse */
  speed: number
  /** vertical velocity, m/s (positive = rising) — only meaningful while airborne */
  verticalSpeed: number
  grounded: boolean
}

const MPH_TO_MPS = 0.44704
/** The 150 mph cap from the spec. */
export const MAX_SPEED_MPS = 150 * MPH_TO_MPS
/** Real cars reverse much slower than they drive forward — no cap was specified for reverse, so this is a reasonable assumption. */
const MAX_REVERSE_SPEED_MPS = 25 * MPH_TO_MPS

/** 14 m/s^2 reaches ~31 mph after 1s of throttle from a stop — comfortably clears the "at least 30 mph after one second" requirement. */
const FORWARD_ACCEL_MPS2 = 14
const BRAKE_DECEL_MPS2 = 14
const REVERSE_ACCEL_MPS2 = 5
/** Gentle coast-down toward a stop with no throttle/brake input, standing in for engine braking + rolling resistance. */
const COAST_DECEL_MPS2 = 2.5

const MAX_TURN_RATE_RAD_S = 1.6
/** Steering ramps in with speed (real cars can't pivot in place) — full speedFactor by this many m/s. */
const STEERING_RAMP_SPEED_MPS = 4

const GRAVITY_MPS2 = 9.81

/** Car's collision footprint, approximated as a circle — a reasonable middle ground between the body's half-width (~1m) and half-length (~2.1m) for simple circle-vs-box collision against building AABBs. */
const CAR_COLLISION_RADIUS_M = 1.3

/** How far ahead/behind the car's current position to sample terrain height for the slope underfoot. */
const SLOPE_SAMPLE_DISTANCE_M = 1.5
/** How far the car's projected next elevation must clear the ground before it's considered to have left it. */
const GROUND_LEAVE_EPSILON_M = 0.05
/** Vertical gap left above a building's roof when the car is perched there after a clip (see clippedRoofHeight below). */
const ROOF_PERCH_CLEARANCE_M = 0.5

export interface BuildingCollider {
  minX: number
  maxX: number
  minY: number
  maxY: number
  /** absolute elevation of the building's roof — local ground height at its footprint center plus its height. Used only as the clipping fallback below. */
  roofHeight: number
}

/** Axis-aligned bounding box per building, in the same local meters as everything else — the "collision box" each building presents to the car. */
export function computeBuildingColliders(buildings: Building[], terrain: TerrainPatch): BuildingCollider[] {
  return buildings.map((building) => {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let sumX = 0
    let sumY = 0
    for (const p of building.footprint) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
      sumX += p.x
      sumY += p.y
    }
    const centerHeight = sampleTerrainHeight(terrain, sumX / building.footprint.length, sumY / building.footprint.length)
    return { minX, maxX, minY, maxY, roofHeight: centerHeight + building.heightMeters }
  })
}

/** Pushes (x,y) out of any building box it's penetrating, treating the car as a circle of CAR_COLLISION_RADIUS_M. */
function resolveBuildingCollisions(
  x: number,
  y: number,
  colliders: BuildingCollider[],
): { x: number; y: number; collided: boolean } {
  let collided = false
  for (const c of colliders) {
    const closestX = Math.max(c.minX, Math.min(x, c.maxX))
    const closestY = Math.max(c.minY, Math.min(y, c.maxY))
    const dx = x - closestX
    const dy = y - closestY
    const distSq = dx * dx + dy * dy
    if (distSq >= CAR_COLLISION_RADIUS_M * CAR_COLLISION_RADIUS_M) continue

    collided = true
    const dist = Math.sqrt(distSq) || 0.0001
    const penetration = CAR_COLLISION_RADIUS_M - dist
    x += (dx / dist) * penetration
    y += (dy / dist) * penetration
  }
  return { x, y, collided }
}

/**
 * resolveBuildingCollisions pushes the car out along the vector from a
 * building box's nearest edge to the car's center — but if the car ever
 * tunnels far enough in a single frame (a high-speed step, or several
 * overlapping colliders fighting each other) that its center lands
 * exactly *inside* a box, that vector is zero and there's nothing to push
 * away from: the car clips through the wall instead of colliding with it.
 * This checks for that leftover case after the normal push-out and, if
 * still found, reports the tallest such building's roof height so the
 * caller can place the car above it instead of leaving it visibly
 * embedded in/through the geometry.
 */
function clippedRoofHeight(x: number, y: number, colliders: BuildingCollider[]): number | null {
  let roofHeight: number | null = null
  for (const c of colliders) {
    if (x < c.minX || x > c.maxX || y < c.minY || y > c.maxY) continue
    roofHeight = roofHeight === null ? c.roofHeight : Math.max(roofHeight, c.roofHeight)
  }
  return roofHeight
}

/** Ground height at (x,y): the road's top surface while over a road (so the car rests on top of it instead of clipping into it — see ROAD_SURFACE_Y_EPSILON in roadGeometry.ts), otherwise raw terrain. */
function groundHeightAt(terrain: TerrainPatch, roadColliders: RoadSurfaceCollider[], x: number, y: number): number {
  const roadHeight = sampleRoadSurfaceHeight(roadColliders, x, y)
  return roadHeight === null ? sampleTerrainHeight(terrain, x, y) : roadHeight
}

export function createInitialCarState(terrain: TerrainPatch): CarState {
  return { x: 0, y: 0, elevation: sampleTerrainHeight(terrain, 0, 0), heading: 0, speed: 0, verticalSpeed: 0, grounded: true }
}

/**
 * Advances the car simulation by `dt` seconds. Horizontal motion is a
 * simple arcade throttle/brake/steer model (FORWARD_ACCEL_MPS2 is tuned
 * so holding throttle for one second alone already clears ~30 mph);
 * vertical motion is real projectile physics once airborne. There's no
 * separate scripted "jump" action — while grounded, the slope under the
 * car is converted into vertical speed exactly like a ramp deflecting a
 * wheel, so whether that's enough to carry the car past a crest into the
 * air (rather than the ground "catching up" to it immediately) falls
 * naturally out of how much speed and how much slope there was, per the
 * spec. Building collisions normally push the car out sideways (see
 * resolveBuildingCollisions); clippedRoofHeight below is a fallback for
 * when that push has nothing to push against (the car tunneled dead
 * center into a box in one step) — instead of clipping through, the car
 * is placed on top of the building it's stuck in.
 */
export function stepCarPhysics(
  state: CarState,
  input: CarInput,
  dt: number,
  terrain: TerrainPatch,
  buildingColliders: BuildingCollider[],
  roadColliders: RoadSurfaceCollider[],
  worldRadius: number,
): CarState {
  let { x, y, elevation, heading, speed, verticalSpeed, grounded } = state

  if (input.throttle) {
    speed += FORWARD_ACCEL_MPS2 * dt
  } else if (input.brake) {
    if (speed > 0.05) {
      speed = Math.max(0, speed - BRAKE_DECEL_MPS2 * dt)
    } else {
      speed -= REVERSE_ACCEL_MPS2 * dt
    }
  } else if (speed > 0) {
    speed = Math.max(0, speed - COAST_DECEL_MPS2 * dt)
  } else if (speed < 0) {
    speed = Math.min(0, speed + COAST_DECEL_MPS2 * dt)
  }
  speed = Math.max(-MAX_REVERSE_SPEED_MPS, Math.min(MAX_SPEED_MPS, speed))

  // Steering ramps in with speed and inverts in reverse, like a real car.
  const steeringFactor = Math.min(1, Math.abs(speed) / STEERING_RAMP_SPEED_MPS)
  const steeringSign = speed < 0 ? -1 : 1
  if (input.left) heading += MAX_TURN_RATE_RAD_S * steeringFactor * steeringSign * dt
  if (input.right) heading -= MAX_TURN_RATE_RAD_S * steeringFactor * steeringSign * dt

  const dirX = Math.cos(heading)
  const dirY = Math.sin(heading)
  let nextX = x + dirX * speed * dt
  let nextY = y + dirY * speed * dt

  // The generation radius acts as a soft circular wall around the generated world.
  const distFromCenter = Math.hypot(nextX, nextY)
  const maxDist = Math.max(0, worldRadius - CAR_COLLISION_RADIUS_M)
  if (distFromCenter > maxDist && distFromCenter > 0) {
    const scale = maxDist / distFromCenter
    nextX *= scale
    nextY *= scale
    speed *= 0.5
  }

  // A road is a guaranteed-clear driving surface — any building collider
  // that geometrically overlaps it is a false positive from the building's
  // coarse AABB (see BuildingCollider) rather than a real obstacle (common
  // right where a road runs close beside, or a building's rectangular
  // bounding box overhangs past its actual footprint near, a road edge).
  // Skip building-collision resolution entirely while heading onto a road
  // so a bounding-box artifact never stops or bumps a car that's actually
  // driving cleanly down pavement.
  const roadHeightAtNext = sampleRoadSurfaceHeight(roadColliders, nextX, nextY)
  const onRoad = roadHeightAtNext !== null
  const resolved = onRoad ? { x: nextX, y: nextY, collided: false } : resolveBuildingCollisions(nextX, nextY, buildingColliders)
  nextX = resolved.x
  nextY = resolved.y

  const perchHeight = onRoad ? null : clippedRoofHeight(nextX, nextY, buildingColliders)
  // A clipped car (center tunneled inside a building box) always reads as
  // "collided" too — resolveBuildingCollisions has a zero-length push vector
  // for a point dead-center in a box, so it can never actually push the car
  // out. Without this guard the 0.3x penalty below reapplies every single
  // frame forever (throttle adds speed, this immediately cuts 70% of it),
  // settling into a near-zero equilibrium crawl instead of the car ever
  // escaping — since clipping is handled by perching above the roof instead
  // (below), it isn't a real wall hit and shouldn't eat speed like one.
  if (resolved.collided && perchHeight === null) speed *= 0.3

  const groundHeightAtNext = onRoad ? roadHeightAtNext : groundHeightAt(terrain, roadColliders, nextX, nextY)

  if (grounded) {
    const aheadHeight = groundHeightAt(terrain, roadColliders, x + dirX * SLOPE_SAMPLE_DISTANCE_M, y + dirY * SLOPE_SAMPLE_DISTANCE_M)
    const behindHeight = groundHeightAt(terrain, roadColliders, x - dirX * SLOPE_SAMPLE_DISTANCE_M, y - dirY * SLOPE_SAMPLE_DISTANCE_M)
    const slope = (aheadHeight - behindHeight) / (2 * SLOPE_SAMPLE_DISTANCE_M)
    verticalSpeed = slope * speed

    const projectedElevation = elevation + verticalSpeed * dt
    // Roads are an engineered, continuously-interpolated surface (see
    // sampleRoadSurfaceHeight) — small slope readings near a centerline
    // vertex shouldn't ever be read as a "bump" that launches the car
    // airborne the way genuinely uneven off-road terrain can. Bridges
    // still climb smoothly because they stay grounded and simply snap to
    // groundHeightAtNext, which already carries their ramp.
    if (!onRoad && projectedElevation > groundHeightAtNext + GROUND_LEAVE_EPSILON_M) {
      grounded = false
      elevation = projectedElevation
    } else {
      elevation = groundHeightAtNext
    }
  } else {
    verticalSpeed -= GRAVITY_MPS2 * dt
    const projectedElevation = elevation + verticalSpeed * dt
    if (projectedElevation <= groundHeightAtNext) {
      elevation = groundHeightAtNext
      verticalSpeed = 0
      grounded = true
    } else {
      elevation = projectedElevation
    }
  }

  // Clipping fallback: if the car is still (horizontally) inside a
  // building's footprint after collision resolution, don't leave it
  // rendered through the walls/roof — perch it just above instead. Only
  // lifts, never pulls down, so a car legitimately airborne (e.g. mid-jump)
  // above a building it's passing over is left alone.
  if (perchHeight !== null) {
    const perch = perchHeight + ROOF_PERCH_CLEARANCE_M
    if (elevation < perch) {
      elevation = perch
      verticalSpeed = 0
      grounded = true
    }
  }

  return { x: nextX, y: nextY, elevation, heading, speed, verticalSpeed, grounded }
}
