import type { Road, TerrainPatch } from '@/world/schema'
import { sampleTerrainHeight } from '@/generation/sampleHeight'
import { toThreeVec3 } from '@/generation/toThreeSpace'
import type { GeometryData } from '@/generation/geometryTypes'

/**
 * Roads render above land-use and water (see LAND_USE_Y_EPSILON /
 * WATER_Y_EPSILON in generation/landUseGeometry.ts for the full stacking
 * order and why the gaps are this wide).
 */
const ROAD_Y_EPSILON = 0.4

export function buildRoadsGeometry(roads: Road[], terrain: TerrainPatch): GeometryData {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (const road of roads) {
    addRoad(road, terrain, positions, normals, uvs, indices)
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  }
}

function addRoad(
  road: Road,
  terrain: TerrainPatch,
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
) {
  const line = road.centerline
  if (line.length < 2) return

  const halfWidth = road.widthMeters / 2
  const start = positions.length / 3

  for (let i = 0; i < line.length; i++) {
    const prev = line[Math.max(0, i - 1)]
    const next = line[Math.min(line.length - 1, i + 1)]
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len

    const p = line[i]
    const groundHeight = sampleTerrainHeight(terrain, p.x, p.y) + ROAD_Y_EPSILON
    const v = i / (line.length - 1 || 1)

    positions.push(...toThreeVec3({ x: p.x + nx * halfWidth, y: p.y + ny * halfWidth }, groundHeight))
    normals.push(0, 1, 0)
    uvs.push(0, v)

    positions.push(...toThreeVec3({ x: p.x - nx * halfWidth, y: p.y - ny * halfWidth }, groundHeight))
    normals.push(0, 1, 0)
    uvs.push(1, v)
  }

  for (let i = 0; i < line.length - 1; i++) {
    const a = start + i * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3
    indices.push(a, c, b, b, c, d)
  }
}
