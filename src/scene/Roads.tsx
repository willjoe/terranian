import { useMemo } from 'react'
import { DoubleSide } from 'three'
import { buildRoadCenterlineGeometry, buildRoadOutlineGeometry, buildRoadsGeometry } from '@/generation/roadGeometry'
import { useBufferGeometry } from '@/scene/useBufferGeometry'
import { RENDER_ORDER } from '@/scene/renderOrder'
import type { Road, TerrainPatch } from '@/world/schema'

/**
 * Three layers per set of roads, each its own merged mesh: a wide grey
 * outline box standing in for a sidewalk (draped lowest, so at
 * intersections overlapping outlines just blend together rather than
 * showing seams — see generation/roadGeometry.ts), the dark road surface
 * box on top of that (narrower, so the outline only peeks out as a
 * margin), and a dashed yellow centerline painted on top of the surface.
 * The outline and surface are both extruded ROAD_BOX_HEIGHT_M deep rather
 * than flat planes, so a bridge's deck and sidewalk read as real elevated
 * structure instead of paper-thin sheets floating in midair.
 *
 * Rendered twice — once for non-bridge roads, once for roads OSM tags (or
 * geometry, see world/bridges.ts) as a bridge (`isBridgeRoad` in
 * generation/roadGeometry.ts) — renderOrder.ts still paints them on
 * opposite sides of water as a reasonable default, though it's no longer
 * load-bearing: every mesh here uses normal depthTest/depthWrite, the
 * same as terrain/land-use/water/buildings, so what's actually in front
 * is decided by real 3D depth rather than paint order. An earlier version
 * disabled depthTest on roads to force them "always on top," which did
 * stop terrain/land-use from bleeding over flat roads, but it also made
 * roads a visually separate layer from everything else — geometry that
 * should genuinely intersect (a building base against a road edge, a
 * bridge deck against the water it clears) could clip or fail to clip
 * inconsistently, since roads weren't really occupying the same depth
 * space as their surroundings. generation/roadGeometry.ts's Y-epsilon
 * gaps were widened enough that ordinary flat roads still reliably beat
 * terrain/land-use/water under normal depth testing, and a real bridge's
 * elevation (often tens of meters, once it reaches an obstacle) settles
 * everything else on its own.
 */
export function Roads({ roads, terrain }: { roads: Road[]; terrain: TerrainPatch }) {
  if (roads.length === 0) return null

  return (
    <>
      <RoadOutline roads={roads} terrain={terrain} bridgesOnly={false} />
      <RoadSurface roads={roads} terrain={terrain} bridgesOnly={false} />
      <RoadCenterline roads={roads} terrain={terrain} bridgesOnly={false} />
      <RoadOutline roads={roads} terrain={terrain} bridgesOnly={true} />
      <RoadSurface roads={roads} terrain={terrain} bridgesOnly={true} />
      <RoadCenterline roads={roads} terrain={terrain} bridgesOnly={true} />
    </>
  )
}

function RoadOutline({ roads, terrain, bridgesOnly }: { roads: Road[]; terrain: TerrainPatch; bridgesOnly: boolean }) {
  const data = useMemo(() => buildRoadOutlineGeometry(roads, terrain, bridgesOnly), [roads, terrain, bridgesOnly])
  const geometry = useBufferGeometry(data)
  if (geometry.index === null || geometry.index.count === 0) return null

  return (
    <mesh
      geometry={geometry}
      receiveShadow
      castShadow
      renderOrder={bridgesOnly ? RENDER_ORDER.bridgeRoadOutline : RENDER_ORDER.roadOutline}
    >
      <meshStandardMaterial color="#9a9a9a" side={DoubleSide} />
    </mesh>
  )
}

function RoadSurface({ roads, terrain, bridgesOnly }: { roads: Road[]; terrain: TerrainPatch; bridgesOnly: boolean }) {
  const data = useMemo(() => buildRoadsGeometry(roads, terrain, bridgesOnly), [roads, terrain, bridgesOnly])
  const geometry = useBufferGeometry(data)
  if (geometry.index === null || geometry.index.count === 0) return null

  return (
    <mesh
      geometry={geometry}
      receiveShadow
      castShadow
      renderOrder={bridgesOnly ? RENDER_ORDER.bridgeRoads : RENDER_ORDER.roads}
    >
      <meshStandardMaterial color="#333333" side={DoubleSide} />
    </mesh>
  )
}

function RoadCenterline({
  roads,
  terrain,
  bridgesOnly,
}: {
  roads: Road[]
  terrain: TerrainPatch
  bridgesOnly: boolean
}) {
  const data = useMemo(() => buildRoadCenterlineGeometry(roads, terrain, bridgesOnly), [roads, terrain, bridgesOnly])
  const geometry = useBufferGeometry(data)
  if (geometry.index === null || geometry.index.count === 0) return null

  return (
    <mesh
      geometry={geometry}
      renderOrder={bridgesOnly ? RENDER_ORDER.bridgeRoadCenterline : RENDER_ORDER.roadCenterline}
    >
      <meshStandardMaterial color="#ffd54a" side={DoubleSide} />
    </mesh>
  )
}
