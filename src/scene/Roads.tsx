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
      <meshStandardMaterial color="#9a9a9a" side={DoubleSide} />
    </mesh>
  )
}

function RoadSurface({ roads, terrain }: { roads: Road[]; terrain: TerrainPatch }) {
  const data = useMemo(() => buildRoadsGeometry(roads, terrain), [roads, terrain])
  const geometry = useBufferGeometry(data)
  if (geometry.index === null || geometry.index.count === 0) return null

  return (
    <mesh geometry={geometry} receiveShadow renderOrder={RENDER_ORDER.roads}>
      <meshStandardMaterial color="#333333" side={DoubleSide} />
    </mesh>
  )
}

function RoadCenterline({ roads, terrain }: { roads: Road[]; terrain: TerrainPatch }) {
  const data = useMemo(() => buildRoadCenterlineGeometry(roads, terrain), [roads, terrain])
  const geometry = useBufferGeometry(data)
  if (geometry.index === null || geometry.index.count === 0) return null

  return (
    <mesh geometry={geometry} renderOrder={RENDER_ORDER.roadCenterline}>
      <meshStandardMaterial color="#ffd54a" side={DoubleSide} />
    </mesh>
  )
}
