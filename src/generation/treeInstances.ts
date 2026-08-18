import { BASE_TREE_HEIGHT_M } from '@/config/constants'
import type { TerrainPatch, TreePoint } from '@/world/schema'
import { sampleTerrainHeight } from '@/generation/sampleHeight'
import { toThreeVec3 } from '@/generation/toThreeSpace'

/**
 * One 4x4 column-major transform matrix per tree (matching
 * THREE.Matrix4.elements layout), for direct use with an InstancedMesh's
 * instanceMatrix buffer.
 */
export function buildTreeInstanceMatrices(trees: TreePoint[], terrain: TerrainPatch): Float32Array {
  const matrices = new Float32Array(trees.length * 16)

  trees.forEach((tree, i) => {
    const groundHeight = sampleTerrainHeight(terrain, tree.position.x, tree.position.y)
    const [x, y, z] = toThreeVec3(tree.position, groundHeight)
    const rotationY = Math.random() * Math.PI * 2
    const scale = tree.heightMeters / BASE_TREE_HEIGHT_M
    const cos = Math.cos(rotationY)
    const sin = Math.sin(rotationY)

    matrices.set(
      [
        cos * scale, 0, -sin * scale, 0,
        0, scale, 0, 0,
        sin * scale, 0, cos * scale, 0,
        x, y, z, 1,
      ],
      i * 16,
    )
  })

  return matrices
}
