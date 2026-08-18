import type { LocalPoint } from '@/geo/coords'

/**
 * The single canonical mapping from this app's local ground-plane
 * coordinates (x=east, y=north meters, relative to the world origin) into
 * Three.js scene space (x=east, y=up/elevation, z=-north). Every geometry
 * builder in generation/ goes through this helper so nothing ends up
 * mirrored relative to the rest of the scene.
 */
export function toThreeVec3(p: LocalPoint, heightMeters: number): [number, number, number] {
  return [p.x, heightMeters, -p.y]
}
