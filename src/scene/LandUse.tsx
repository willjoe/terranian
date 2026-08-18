import { useMemo } from 'react'
import { DoubleSide } from 'three'
import { buildLandUseGeometry } from '@/generation/landUseGeometry'
import { useBufferGeometry } from '@/scene/useBufferGeometry'
import { RENDER_ORDER } from '@/scene/renderOrder'
import type { LandUseArea, LandUseKind, TerrainPatch } from '@/world/schema'

const COLORS: Record<Exclude<LandUseKind, 'water'>, string> = {
  forest: '#3f6b3f',
  farmland: '#c9b458',
  residential: '#d8c9a3',
  grass: '#8fbf6b',
  other: '#a3a3a3',
}

const LAND_KINDS = Object.keys(COLORS) as Exclude<LandUseKind, 'water'>[]

function LandUsePatch({ areas, terrain, kind }: { areas: LandUseArea[]; terrain: TerrainPatch; kind: LandUseKind }) {
  const data = useMemo(() => buildLandUseGeometry(areas, terrain, kind), [areas, terrain, kind])
  const geometry = useBufferGeometry(data)

  if (geometry.index === null || geometry.index.count === 0) return null

  return (
    <mesh geometry={geometry} receiveShadow renderOrder={RENDER_ORDER.landUse}>
      <meshStandardMaterial color={COLORS[kind as Exclude<LandUseKind, 'water'>]} side={DoubleSide} />
    </mesh>
  )
}

/** Renders every land-use kind except water, which Water.tsx handles separately. */
export function LandUse({ landUse, terrain }: { landUse: LandUseArea[]; terrain: TerrainPatch }) {
  return (
    <>
      {LAND_KINDS.map((kind) => (
        <LandUsePatch key={kind} areas={landUse} terrain={terrain} kind={kind} />
      ))}
    </>
  )
}
