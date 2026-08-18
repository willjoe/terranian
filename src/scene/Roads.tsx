import { useMemo } from 'react'
import { DoubleSide } from 'three'
import { buildRoadsGeometry } from '@/generation/roadGeometry'
import { useBufferGeometry } from '@/scene/useBufferGeometry'
import { RENDER_ORDER } from '@/scene/renderOrder'
import type { Road, TerrainPatch } from '@/world/schema'

export function Roads({ roads, terrain }: { roads: Road[]; terrain: TerrainPatch }) {
  const data = useMemo(() => buildRoadsGeometry(roads, terrain), [roads, terrain])
  const geometry = useBufferGeometry(data)

  if (roads.length === 0) return null

  return (
    <mesh geometry={geometry} receiveShadow renderOrder={RENDER_ORDER.roads}>
      <meshStandardMaterial color="#333333" side={DoubleSide} />
    </mesh>
  )
}
