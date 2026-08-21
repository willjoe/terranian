import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useKeyboardControls } from '@react-three/drei'
import * as THREE from 'three'
import {
  computeBuildingColliders,
  createInitialCarState,
  stepCarPhysics,
  type CarState,
} from '@/generation/carPhysics'
import { computeRoadSurfaceColliders } from '@/generation/roadGeometry'
import { toThreeVec3 } from '@/generation/toThreeSpace'
import { CarMesh } from '@/scene/CarMesh'
import type { WorldModel } from '@/world/schema'

const CAMERA_FOLLOW_DISTANCE_M = 9
const CAMERA_HEIGHT_M = 4
const CAMERA_LOOKAHEAD_HEIGHT_M = 1.2
/** Higher = the chase camera catches up to the car faster; lower = a looser, laggier follow. */
const CAMERA_FOLLOW_SPEED = 4
/** Real dt can spike (tab switches, a slow frame) — clamping keeps a single frame from tunneling the car through a building or off a cliff. */
const MAX_PHYSICS_STEP_S = 0.05

const DRIVING_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

/** Owns the driving-mode car simulation and chase camera. Only rendered while the store's mode is 'driving' (see scene/WorldScene.tsx), so OrbitControls and this never fight over the camera at the same time. */
export function DrivingRig({ world }: { world: WorldModel }) {
  const { camera } = useThree()
  const [, getKeys] = useKeyboardControls()
  const carGroupRef = useRef<THREE.Group>(null)
  const stateRef = useRef<CarState>(createInitialCarState(world.terrain))
  const cameraInitializedRef = useRef(false)

  const buildingColliders = useMemo(
    () => computeBuildingColliders(world.buildings, world.terrain),
    [world.buildings, world.terrain],
  )
  const roadColliders = useMemo(
    () => computeRoadSurfaceColliders(world.roads, world.terrain),
    [world.roads, world.terrain],
  )
  const worldRadius = Math.max(world.boundsMeters.width, world.boundsMeters.depth) / 2

  // The arrow keys drive the car, so they shouldn't also scroll the page —
  // drei's KeyboardControls listens passively and never calls
  // preventDefault. Scoped to only while this rig is mounted (driving mode).
  useEffect(() => {
    const suppressArrowScroll = (event: KeyboardEvent) => {
      if (DRIVING_KEYS.includes(event.key)) event.preventDefault()
    }
    window.addEventListener('keydown', suppressArrowScroll)
    return () => window.removeEventListener('keydown', suppressArrowScroll)
  }, [])

  useFrame((_frameState, rawDelta) => {
    const dt = Math.min(rawDelta, MAX_PHYSICS_STEP_S)
    const keys = getKeys()
    const next = stepCarPhysics(
      stateRef.current,
      { throttle: !!keys.forward, brake: !!keys.back, left: !!keys.left, right: !!keys.right },
      dt,
      world.terrain,
      buildingColliders,
      roadColliders,
      worldRadius,
    )
    stateRef.current = next

    const group = carGroupRef.current
    if (group) {
      const [x, y, z] = toThreeVec3({ x: next.x, y: next.y }, next.elevation)
      group.position.set(x, y, z)
      group.rotation.y = next.heading
    }

    const dirX = Math.cos(next.heading)
    const dirY = Math.sin(next.heading)
    const [camX, camY, camZ] = toThreeVec3(
      { x: next.x - dirX * CAMERA_FOLLOW_DISTANCE_M, y: next.y - dirY * CAMERA_FOLLOW_DISTANCE_M },
      next.elevation + CAMERA_HEIGHT_M,
    )
    const [lookX, lookY, lookZ] = toThreeVec3({ x: next.x, y: next.y }, next.elevation + CAMERA_LOOKAHEAD_HEIGHT_M)

    if (!cameraInitializedRef.current) {
      camera.position.set(camX, camY, camZ)
      cameraInitializedRef.current = true
    } else {
      camera.position.lerp(new THREE.Vector3(camX, camY, camZ), Math.min(1, CAMERA_FOLLOW_SPEED * dt))
    }
    camera.lookAt(lookX, lookY, lookZ)
  })

  return <CarMesh ref={carGroupRef} />
}
