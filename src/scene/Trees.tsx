import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { BASE_TREE_HEIGHT_M, BASE_TREE_RADIUS_M } from '@/config/constants'
import { buildTreeInstanceMatrices } from '@/generation/treeInstances'
import { RENDER_ORDER } from '@/scene/renderOrder'
import type { TerrainPatch, TreePoint } from '@/world/schema'

// Base low-poly canopy, translated so its base sits at local y=0 (ground),
// matching the per-instance transform's translation semantics.
const canopyGeometry = new THREE.ConeGeometry(BASE_TREE_RADIUS_M, BASE_TREE_HEIGHT_M, 6)
canopyGeometry.translate(0, BASE_TREE_HEIGHT_M / 2, 0)

export function Trees({ trees, terrain }: { trees: TreePoint[]; terrain: TerrainPatch }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const matrices = useMemo(() => buildTreeInstanceMatrices(trees, terrain), [trees, terrain])

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.instanceMatrix.array.set(matrices)
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [matrices])

  if (trees.length === 0) return null

  return (
    <instancedMesh
      ref={meshRef}
      args={[canopyGeometry, undefined, trees.length]}
      castShadow
      renderOrder={RENDER_ORDER.trees}
    >
      <meshStandardMaterial color="#2e5d34" />
    </instancedMesh>
  )
}
