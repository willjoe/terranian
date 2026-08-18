import type { LocalPoint } from '@/geo/coords'
import { clipPolygonToRadius } from '@/geo/circleClip'
import type { TerrainPatch } from '@/world/schema'
import { sampleTerrainHeight } from '@/generation/sampleHeight'
import { toThreeVec3 } from '@/generation/toThreeSpace'
import type { GeometryData } from '@/generation/geometryTypes'

/**
 * The rendered terrain is a circular disc matching the generation radius
 * (like the top of a cylinder) rather than the full square heightmap grid,
 * consistent with how roads/buildings/land-use are already clipped to
 * that same circle (see geo/circleClip.ts). Interior cells keep the
 * standard shared-vertex grid (smooth shading, cheap); only cells that
 * straddle the boundary get individually clipped and triangulated.
 */
export function buildTerrainGeometry(terrain: TerrainPatch): GeometryData {
  const { resolution, widthMeters, depthMeters, heights } = terrain
  const gridSize = resolution + 1
  const radius = Math.min(widthMeters, depthMeters) / 2

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const gridX = (col: number) => -widthMeters / 2 + (col / resolution) * widthMeters
  const gridY = (row: number) => -depthMeters / 2 + (row / resolution) * depthMeters
  const cornerPoint = (row: number, col: number): LocalPoint => ({ x: gridX(col), y: gridY(row) })
  const isWithinRadius = (p: LocalPoint) => p.x * p.x + p.y * p.y <= radius * radius

  // Grid vertices are created lazily, only the first time an interior
  // (fully-inside) triangle actually references them — corners outside the
  // disc are never pushed. Otherwise they'd sit unused in the position
  // buffer at up to radius*sqrt(2) from the origin, inflating Three.js's
  // automatic bounding-sphere (computed from all positions, regardless of
  // which ones the index buffer references) well past the visible disc.
  const gridVertexIndex = new Map<number, number>()
  function getGridVertex(row: number, col: number): number {
    const key = row * gridSize + col
    const existing = gridVertexIndex.get(key)
    if (existing !== undefined) return existing
    const [x, y, z] = toThreeVec3(cornerPoint(row, col), heights[key])
    positions.push(x, y, z)
    uvs.push(col / resolution, row / resolution)
    const index = positions.length / 3 - 1
    gridVertexIndex.set(key, index)
    return index
  }

  function emitClippedTriangle(a: LocalPoint, b: LocalPoint, c: LocalPoint) {
    const clipped = clipPolygonToRadius([a, b, c], radius)
    if (clipped.length < 3) return

    // A triangle clipped against a convex circle stays convex, so a fan
    // triangulation from the first point is always valid.
    const clippedIndices = clipped.map((p) => {
      const height = sampleTerrainHeight(terrain, p.x, p.y)
      const [x, y, z] = toThreeVec3(p, height)
      positions.push(x, y, z)
      uvs.push((p.x + widthMeters / 2) / widthMeters, (p.y + depthMeters / 2) / depthMeters)
      return positions.length / 3 - 1
    })
    for (let i = 1; i < clippedIndices.length - 1; i++) {
      indices.push(clippedIndices[0], clippedIndices[i], clippedIndices[i + 1])
    }
  }

  // Two triangles per cell: (a,b,c) and (b,d,c), which both wind to an
  // upward-facing (+Y) normal given this vertex layout — see toThreeSpace.
  for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      const aIn = isWithinRadius(cornerPoint(row, col))
      const bIn = isWithinRadius(cornerPoint(row, col + 1))
      const cIn = isWithinRadius(cornerPoint(row + 1, col))
      const dIn = isWithinRadius(cornerPoint(row + 1, col + 1))

      if (aIn && bIn && cIn) {
        indices.push(getGridVertex(row, col), getGridVertex(row, col + 1), getGridVertex(row + 1, col))
      } else {
        emitClippedTriangle(cornerPoint(row, col), cornerPoint(row, col + 1), cornerPoint(row + 1, col))
      }

      if (bIn && dIn && cIn) {
        indices.push(getGridVertex(row, col + 1), getGridVertex(row + 1, col + 1), getGridVertex(row + 1, col))
      } else {
        emitClippedTriangle(cornerPoint(row, col + 1), cornerPoint(row + 1, col + 1), cornerPoint(row + 1, col))
      }
    }
  }

  const positionsArray = new Float32Array(positions)
  const indicesArray = new Uint32Array(indices)
  const normals = computeNormals(positionsArray, indicesArray)

  return { positions: positionsArray, normals, uvs: new Float32Array(uvs), indices: indicesArray }
}

function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length)

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3
    const ib = indices[i + 1] * 3
    const ic = indices[i + 2] * 3

    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2]
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2]
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2]

    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az

    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx

    normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz
    normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz
    normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz
  }

  for (let i = 0; i < normals.length; i += 3) {
    const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2]
    const len = Math.hypot(nx, ny, nz) || 1
    normals[i] = nx / len
    normals[i + 1] = ny / len
    normals[i + 2] = nz / len
  }

  return normals
}
