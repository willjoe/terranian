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
 * Rendered twice — once for non-bridge roads, once for roads OSM tags as
 * a bridge (`isBridgeRoad` in generation/roadGeometry.ts) — because the
 * two sets belong on opposite sides of water in the paint order (see
 * renderOrder.ts): a real road only belongs above water where it's
 * actually a bridge, so a non-bridge road painted *before* water can
 * still be covered by water's own depth-tested draw if they incidentally
 * overlap, while a bridge road painted *after* water always wins.
 *
 * All six meshes render with depthTest off. The Y-epsilon draping in
 * generation/roadGeometry.ts only guarantees roads sit above terrain at
 * the exact points *roads themselves* sample — but land-use polygons
 * (and the terrain mesh's own large triangles) sample terrain height at
 * different, more sparsely-spaced points, so on real sloped ground their
 * interpolated surface can still poke up above a road that cuts across
 * the same slope, no matter how big that epsilon is made. Skipping the
 * depth test makes roads win unconditionally against terrain/land-use
 * instead of only "usually": since those always paint first (see
 * renderOrder.ts) and non-bridge roads don't write depth either, the
 * buildings/trees painted afterward still correctly test against the
 * real terrain depth beneath them, so a building still properly occludes
 * a non-bridge road running behind it.
 *
 * Bridge roads are the one exception: they *do* write depth, using their
 * real (often tens of meters, per generation/roadGeometry.ts's
 * bridgeHeightAt) elevation above terrain. A road arching over a
 * building only visibly clears it if buildings drawn afterward lose
 * their normal depth test at those pixels — which requires the bridge to
 * have actually written its true, higher depth there first.
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
      renderOrder={bridgesOnly ? RENDER_ORDER.bridgeRoadOutline : RENDER_ORDER.roadOutline}
    >
      <meshStandardMaterial color="#9a9a9a" side={DoubleSide} depthTest={false} depthWrite={bridgesOnly} />
    </mesh>
  )
}

function RoadSurface({ roads, terrain, bridgesOnly }: { roads: Road[]; terrain: TerrainPatch; bridgesOnly: boolean }) {
  const data = useMemo(() => buildRoadsGeometry(roads, terrain, bridgesOnly), [roads, terrain, bridgesOnly])
  const geometry = useBufferGeometry(data)
  if (geometry.index === null || geometry.index.count === 0) return null

  return (
    <mesh geometry={geometry} receiveShadow renderOrder={bridgesOnly ? RENDER_ORDER.bridgeRoads : RENDER_ORDER.roads}>
      <meshStandardMaterial color="#333333" side={DoubleSide} depthTest={false} depthWrite={bridgesOnly} />
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
      <meshStandardMaterial color="#ffd54a" side={DoubleSide} depthTest={false} depthWrite={bridgesOnly} />
    </mesh>
  )
}
