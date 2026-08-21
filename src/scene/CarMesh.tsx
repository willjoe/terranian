import { forwardRef } from 'react'
import type { Group } from 'three'

/** Wheel positions relative to the car body center, in meters — [x, y, z] in local car space (nose points +X, see scene/DrivingRig.tsx). */
const WHEEL_POSITIONS: [number, number, number][] = [
  [1.3, 0.38, 1.0],
  [1.3, 0.38, -1.0],
  [-1.3, 0.38, 1.0],
  [-1.3, 0.38, -1.0],
]

/**
 * A simple no-asset car built from primitives (consistent with the rest
 * of the app never depending on external texture/model assets) — a
 * lower body box, a smaller cabin box set back and up, and four wheel
 * cylinders. The nose points toward local +X; scene/DrivingRig.tsx
 * relies on that to align the mesh with CarState.heading.
 */
export const CarMesh = forwardRef<Group>(function CarMesh(_props, ref) {
  return (
    <group ref={ref}>
      <mesh castShadow position={[0, 0.55, 0]}>
        <boxGeometry args={[4.2, 1.1, 1.9]} />
        <meshStandardMaterial color="#c62828" />
      </mesh>
      <mesh castShadow position={[-0.3, 1.15, 0]}>
        <boxGeometry args={[2.2, 0.7, 1.6]} />
        <meshStandardMaterial color="#8d1c1c" />
      </mesh>
      {WHEEL_POSITIONS.map((position, i) => (
        <mesh key={i} castShadow position={position} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.38, 0.38, 0.3, 16]} />
          <meshStandardMaterial color="#111111" />
        </mesh>
      ))}
    </group>
  )
})
