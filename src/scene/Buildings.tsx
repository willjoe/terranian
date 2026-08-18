import { useMemo } from 'react'
import { DoubleSide } from 'three'
import { buildBuildingsGeometry } from '@/generation/buildingGeometry'
import { useBufferGeometry } from '@/scene/useBufferGeometry'
import { RENDER_ORDER } from '@/scene/renderOrder'
import type { Building, TerrainPatch } from '@/world/schema'

export function Buildings({ buildings, terrain }: { buildings: Building[]; terrain: TerrainPatch }) {
  const data = useMemo(() => buildBuildingsGeometry(buildings, terrain), [buildings, terrain])
  const geometry = useBufferGeometry(data)

  if (buildings.length === 0) return null

  return (
    <mesh geometry={geometry} castShadow receiveShadow renderOrder={RENDER_ORDER.buildings}>
      <meshStandardMaterial color="#c9bfae" side={DoubleSide} />
    </mesh>
  )
}
