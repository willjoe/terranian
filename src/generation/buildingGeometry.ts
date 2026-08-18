import earcut from 'earcut'
import type { LocalPoint } from '@/geo/coords'
import type { Building, TerrainPatch } from '@/world/schema'
import { sampleTerrainHeight } from '@/generation/sampleHeight'
import { toThreeVec3 } from '@/generation/toThreeSpace'
import type { GeometryData } from '@/generation/geometryTypes'

/**
 * Real OSM way winding isn't guaranteed CW or CCW, so wall/roof normals
 * here are only approximate. The scene layer renders buildings with a
 * DoubleSide material so this never causes missing/invisible faces.
 */
export function buildBuildingsGeometry(buildings: Building[], terrain: TerrainPatch): GeometryData {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (const building of buildings) {
    addBuilding(building, terrain, positions, normals, uvs, indices)
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  }
}

function closedRingToOpen(polygon: LocalPoint[]): LocalPoint[] {
  if (
    polygon.length > 1 &&
    polygon[0].x === polygon[polygon.length - 1].x &&
    polygon[0].y === polygon[polygon.length - 1].y
  ) {
    return polygon.slice(0, -1)
  }
  return polygon
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function addBuilding(
  building: Building,
  terrain: TerrainPatch,
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
) {
  const ring = closedRingToOpen(building.footprint)
  if (ring.length < 3) return

  // The median (not min/max) of sampled ground heights: small buildings
  // have negligible terrain variation across their footprint so this
  // barely matters, but a large one (an airport terminal can span 400m+)
  // can sit on terrain varying by many meters. Using the minimum pins the
  // whole flat base to whatever the single lowest sampled point is — often
  // a small, unrepresentative low corner — sinking the entire building
  // below the real terrain (and hence behind the opaque terrain mesh)
  // everywhere else. The median stays representative of where the
  // building actually sits regardless of a few outlier corners.
  const groundHeight = median(ring.map((p) => sampleTerrainHeight(terrain, p.x, p.y)))
  const roofHeight = groundHeight + building.heightMeters

  for (let i = 0; i < ring.length; i++) {
    const p0 = ring[i]
    const p1 = ring[(i + 1) % ring.length]

    const wallStart = positions.length / 3
    for (const [p, h] of [
      [p0, groundHeight],
      [p1, groundHeight],
      [p1, roofHeight],
      [p0, roofHeight],
    ] as const) {
      positions.push(...toThreeVec3(p, h))
    }

    const dx = p1.x - p0.x
    const dy = p1.y - p0.y
    const len = Math.hypot(dx, dy) || 1
    const nx = dy / len
    const nz = dx / len
    for (let k = 0; k < 4; k++) {
      normals.push(nx, 0, nz)
      uvs.push(k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0)
    }

    indices.push(wallStart, wallStart + 1, wallStart + 2, wallStart, wallStart + 2, wallStart + 3)
  }

  const flat: number[] = []
  for (const p of ring) flat.push(p.x, p.y)
  const roofTris = earcut(flat)

  const roofStart = positions.length / 3
  for (const p of ring) {
    positions.push(...toThreeVec3(p, roofHeight))
    normals.push(0, 1, 0)
    uvs.push(0, 0)
  }
  for (const t of roofTris) indices.push(roofStart + t)
}
