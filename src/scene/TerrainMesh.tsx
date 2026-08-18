import { useMemo } from 'react'
import { buildTerrainGeometry } from '@/generation/terrainGeometry'
import { useBufferGeometry } from '@/scene/useBufferGeometry'
import { RENDER_ORDER } from '@/scene/renderOrder'
import type { TerrainPatch } from '@/world/schema'

export function TerrainMesh({ terrain }: { terrain: TerrainPatch }) {
  const data = useMemo(() => buildTerrainGeometry(terrain), [terrain])
  const geometry = useBufferGeometry(data)

  return (
    <mesh geometry={geometry} receiveShadow renderOrder={RENDER_ORDER.terrain}>
      <meshStandardMaterial color="#6b8f4e" />
    </mesh>
  )
}
