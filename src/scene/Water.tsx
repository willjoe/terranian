import { useMemo } from 'react'
import { DoubleSide } from 'three'
import { buildLandUseGeometry } from '@/generation/landUseGeometry'
import { useBufferGeometry } from '@/scene/useBufferGeometry'
import { RENDER_ORDER } from '@/scene/renderOrder'
import type { LandUseArea, TerrainPatch } from '@/world/schema'

export function Water({ landUse, terrain }: { landUse: LandUseArea[]; terrain: TerrainPatch }) {
  const data = useMemo(() => buildLandUseGeometry(landUse, terrain, 'water'), [landUse, terrain])
  const geometry = useBufferGeometry(data)

  if (geometry.index === null || geometry.index.count === 0) return null

  return (
    <mesh geometry={geometry} renderOrder={RENDER_ORDER.water}>
      <meshStandardMaterial color="#3a7bd5" transparent opacity={0.85} depthWrite={false} side={DoubleSide} />
    </mesh>
  )
}
