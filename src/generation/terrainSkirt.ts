import { approximateCircle, CIRCLE_CLIP_SEGMENTS } from '@/geo/circleClip'
import type { TerrainPatch } from '@/world/schema'
import { sampleTerrainHeight } from '@/generation/sampleHeight'
import { toThreeVec3 } from '@/generation/toThreeSpace'
import type { GeometryData } from '@/generation/geometryTypes'

/** How far below the lowest terrain point the skirt's base sits. */
const SKIRT_DEPTH_M = 40

/**
 * Vertical wall around the circular terrain disc, dropping from the
 * actual edge height down to a flat base. Without it the disc reads as an
 * infinitely-thin floating sheet from the side once the camera orbits
 * down toward the horizon — this is what makes it look like a cylinder
 * (a solid "core sample" of the terrain) rather than a flat cutout.
 *
 * Walks the exact same boundary polygon (`approximateCircle` with
 * `CIRCLE_CLIP_SEGMENTS`) that geo/circleClip.ts clips every other layer
 * against — sampling the rim independently at a different segment count
 * would land on different vertices than the terrain top's actual clipped
 * edge and leave a seam/gap for whatever's underneath to peek through.
 */
export function buildTerrainSkirtGeometry(terrain: TerrainPatch): GeometryData {
  const radius = Math.min(terrain.widthMeters, terrain.depthMeters) / 2
  const bottomHeight = terrain.minElevation - SKIRT_DEPTH_M
  const boundary = approximateCircle(radius, CIRCLE_CLIP_SEGMENTS)

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let i = 0; i <= boundary.length; i++) {
    const { x, y } = boundary[i % boundary.length]
    const topHeight = sampleTerrainHeight(terrain, x, y)

    positions.push(...toThreeVec3({ x, y }, topHeight), ...toThreeVec3({ x, y }, bottomHeight))

    // The wall is vertical, so its outward normal is just the radial
    // direction and doesn't vary with height.
    const len = Math.hypot(x, y) || 1
    const nx = x / len
    const nz = -y / len
    normals.push(nx, 0, nz, nx, 0, nz)
    uvs.push(i / boundary.length, 0, i / boundary.length, 1)

    if (i > 0) {
      const top1 = (i - 1) * 2
      const bottom1 = top1 + 1
      const top2 = i * 2
      const bottom2 = top2 + 1
      indices.push(top1, bottom1, top2, bottom1, bottom2, top2)
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  }
}
