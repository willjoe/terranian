import { useMemo } from 'react'
import { DoubleSide } from 'three'
import { buildTerrainSkirtGeometry } from '@/generation/terrainSkirt'
import { useBufferGeometry } from '@/scene/useBufferGeometry'
import { RENDER_ORDER } from '@/scene/renderOrder'
import type { TerrainPatch } from '@/world/schema'

export function TerrainSkirt({ terrain }: { terrain: TerrainPatch }) {
  const data = useMemo(() => buildTerrainSkirtGeometry(terrain), [terrain])
  const geometry = useBufferGeometry(data)

  return (
    <mesh geometry={geometry} receiveShadow renderOrder={RENDER_ORDER.terrain}>
      <meshStandardMaterial color="#8a7259" side={DoubleSide} />
    </mesh>
  )
}
