import type { Building, TerrainPatch } from '@/world/schema'
import { sampleTerrainHeight } from '@/generation/sampleHeight'

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

const FORWARD_ACCEL_MPS2 = 9
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

export interface BuildingCollider {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** Axis-aligned bounding box per building, in the same local meters as everything else — the "collision box" each building presents to the car. */
export function computeBuildingColliders(buildings: Building[]): BuildingCollider[] {
  return buildings.map((building) => {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const p of building.footprint) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
    return { minX, maxX, minY, maxY }
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

export function createInitialCarState(terrain: TerrainPatch): CarState {
  return { x: 0, y: 0, elevation: sampleTerrainHeight(terrain, 0, 0), heading: 0, speed: 0, verticalSpeed: 0, grounded: true }
}

/**
 * Advances the car simulation by `dt` seconds. Horizontal motion is a
 * simple arcade throttle/brake/steer model; vertical motion is real
 * projectile physics once airborne. There's no separate scripted "jump"
 * action — while grounded, the slope under the car is converted into
 * vertical speed exactly like a ramp deflecting a wheel, so whether that's
 * enough to carry the car past a crest into the air (rather than the
 * ground "catching up" to it immediately) falls naturally out of how much
 * speed and how much slope there was, per the spec.
 */
export function stepCarPhysics(
  state: CarState,
  input: CarInput,
  dt: number,
  terrain: TerrainPatch,
  buildingColliders: BuildingCollider[],
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

  const resolved = resolveBuildingCollisions(nextX, nextY, buildingColliders)
  nextX = resolved.x
  nextY = resolved.y
  if (resolved.collided) speed *= 0.3

  const groundHeightAtNext = sampleTerrainHeight(terrain, nextX, nextY)

  if (grounded) {
    const aheadHeight = sampleTerrainHeight(terrain, x + dirX * SLOPE_SAMPLE_DISTANCE_M, y + dirY * SLOPE_SAMPLE_DISTANCE_M)
    const behindHeight = sampleTerrainHeight(terrain, x - dirX * SLOPE_SAMPLE_DISTANCE_M, y - dirY * SLOPE_SAMPLE_DISTANCE_M)
    const slope = (aheadHeight - behindHeight) / (2 * SLOPE_SAMPLE_DISTANCE_M)
    verticalSpeed = slope * speed

    const projectedElevation = elevation + verticalSpeed * dt
    if (projectedElevation > groundHeightAtNext + GROUND_LEAVE_EPSILON_M) {
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

  return { x: nextX, y: nextY, elevation, heading, speed, verticalSpeed, grounded }
}
