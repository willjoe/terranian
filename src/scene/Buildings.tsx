import { useMemo } from 'react'
import { buildBuildingsGeometry } from '@/generation/buildingGeometry'
import { useBufferGeometry } from '@/scene/useBufferGeometry'
import { createBuildingFacadeMaterial } from '@/scene/buildingFacadeMaterial'
import { RENDER_ORDER } from '@/scene/renderOrder'
import type { Building, TerrainPatch } from '@/world/schema'

export function Buildings({ buildings, terrain }: { buildings: Building[]; terrain: TerrainPatch }) {
  const data = useMemo(() => buildBuildingsGeometry(buildings, terrain), [buildings, terrain])
  const extraAttributes = useMemo(
    () => ({
      facadeUv: { array: data.facadeUv, itemSize: 2 },
      facadeParams: { array: data.facadeParams, itemSize: 2 },
    }),
    [data],
  )
  const geometry = useBufferGeometry(data, extraAttributes)
  const material = useMemo(() => createBuildingFacadeMaterial(), [])

  if (buildings.length === 0) return null

  return (
    <mesh geometry={geometry} material={material} castShadow receiveShadow renderOrder={RENDER_ORDER.buildings} />
  )
}
