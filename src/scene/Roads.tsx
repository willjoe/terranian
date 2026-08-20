import { useMemo } from 'react'
import { DoubleSide } from 'three'
import { buildRoadCenterlineGeometry, buildRoadOutlineGeometry, buildRoadsGeometry } from '@/generation/roadGeometry'
import { useBufferGeometry } from '@/scene/useBufferGeometry'
import { RENDER_ORDER } from '@/scene/renderOrder'
import type { Road, TerrainPatch } from '@/world/schema'

/**
 * Three layers per set of roads, each its own merged mesh: a wide grey
 * outline standing in for a sidewalk (draped lowest, so at intersections
 * overlapping outlines just blend together rather than showing seams —
 * see generation/roadGeometry.ts), the dark road surface on top of that
 * (narrower, so the outline only peeks out as a margin), and a dashed
 * yellow centerline painted on top of the surface.
 *
 * All three render with depthTest/depthWrite off. The Y-epsilon draping
 * in generation/roadGeometry.ts only guarantees roads sit above terrain
 * at the exact points *roads themselves* sample — but land-use polygons
 * (and the terrain mesh's own large triangles) sample terrain height at
 * different, more sparsely-spaced points, so on real sloped ground their
 * interpolated surface can still poke up above a road that cuts across
 * the same slope, no matter how big that epsilon is made. Skipping the
 * depth test makes roads win unconditionally instead of only "usually":
 * since terrain/land-use/water always paint first (see renderOrder.ts)
 * and roads don't write depth, buildings/trees painted afterward still
 * correctly test against the real terrain depth beneath them, so a
 * building still properly occludes a road running behind it.
 */
export function Roads({ roads, terrain }: { roads: Road[]; terrain: TerrainPatch }) {
  if (roads.length === 0) return null

  return (
    <>
      <RoadOutline roads={roads} terrain={terrain} />
      <RoadSurface roads={roads} terrain={terrain} />
      <RoadCenterline roads={roads} terrain={terrain} />
    </>
  )
}

function RoadOutline({ roads, terrain }: { roads: Road[]; terrain: TerrainPatch }) {
  const data = useMemo(() => buildRoadOutlineGeometry(roads, terrain), [roads, terrain])
  const geometry = useBufferGeometry(data)
  if (geometry.index === null || geometry.index.count === 0) return null

  return (
    <mesh geometry={geometry} receiveShadow renderOrder={RENDER_ORDER.roadOutline}>
      <meshStandardMaterial color="#9a9a9a" side={DoubleSide} depthTest={false} depthWrite={false} />
    </mesh>
  )
}

function RoadSurface({ roads, terrain }: { roads: Road[]; terrain: TerrainPatch }) {
  const data = useMemo(() => buildRoadsGeometry(roads, terrain), [roads, terrain])
  const geometry = useBufferGeometry(data)
  if (geometry.index === null || geometry.index.count === 0) return null

  return (
    <mesh geometry={geometry} receiveShadow renderOrder={RENDER_ORDER.roads}>
      <meshStandardMaterial color="#333333" side={DoubleSide} depthTest={false} depthWrite={false} />
    </mesh>
  )
}

function RoadCenterline({ roads, terrain }: { roads: Road[]; terrain: TerrainPatch }) {
  const data = useMemo(() => buildRoadCenterlineGeometry(roads, terrain), [roads, terrain])
  const geometry = useBufferGeometry(data)
  if (geometry.index === null || geometry.index.count === 0) return null

  return (
    <mesh geometry={geometry} renderOrder={RENDER_ORDER.roadCenterline}>
      <meshStandardMaterial color="#ffd54a" side={DoubleSide} depthTest={false} depthWrite={false} />
    </mesh>
  )
}
