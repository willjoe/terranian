import earcut from 'earcut'
import type { LocalPoint } from '@/geo/coords'
import type { Building, TerrainPatch } from '@/world/schema'
import { sampleTerrainHeight } from '@/generation/sampleHeight'
import { toThreeVec3 } from '@/generation/toThreeSpace'
import type { GeometryData } from '@/generation/geometryTypes'

/** Buildings at or above this height get a glass curtain-wall facade instead of a punched-window masonry one — roughly an 8-9 storey tower. */
const GLASS_HEIGHT_THRESHOLD_M = 28

/**
 * Facade style codes carried per-vertex in `facadeParams.y`, read by the
 * shader in scene/buildingFacadeMaterial.ts. The roof codes are offset
 * from their matching wall code by ROOF_STYLE_OFFSET so a roof always
 * renders in the same colour family as the walls of the building it caps
 * (e.g. a brick building's roof reads brick, not a color from some other
 * building's palette) — the roof shader branch just picks a flat, unlit
 * version of that same wall palette with no window openings.
 */
const FACADE_STYLE_GLASS_WALL = 0
const FACADE_STYLE_MASONRY_WALL = 1
const ROOF_STYLE_OFFSET = 2

/**
 * A wall/roof style extends this bundle with two extra per-vertex
 * attributes the facade shader (scene/buildingFacadeMaterial.ts) reads to
 * paint windows/mullions/spandrels procedurally:
 *   - facadeUv: (u, v) in real meters along/up each wall face (not
 *     stretched 0..1), so window spacing stays physically consistent
 *     regardless of a wall's actual length.
 *   - facadeParams: (seed, style) — seed is a per-building [0,1) hash
 *     driving tint/bay-width/lit-window variation without needing true
 *     randomness (keeps regeneration deterministic); style is one of
 *     FACADE_STYLE_GLASS_WALL/MASONRY_WALL above, or that value plus
 *     ROOF_STYLE_OFFSET for the matching roof look.
 * Roof-cap vertices get facadeUv (0,0) since the roof shader branch
 * ignores it.
 */
export interface BuildingGeometryData extends GeometryData {
  facadeUv: Float32Array
  facadeParams: Float32Array
}

/**
 * Real OSM way winding isn't guaranteed CW or CCW, so wall/roof normals
 * here are only approximate. The scene layer renders buildings with a
 * DoubleSide material so this never causes missing/invisible faces.
 */
export function buildBuildingsGeometry(buildings: Building[], terrain: TerrainPatch): BuildingGeometryData {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const facadeUv: number[] = []
  const facadeParams: number[] = []

  for (const building of buildings) {
    addBuilding(building, terrain, positions, normals, uvs, indices, facadeUv, facadeParams)
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    facadeUv: new Float32Array(facadeUv),
    facadeParams: new Float32Array(facadeParams),
  }
}

/** Deterministic [0,1) hash of a building id — varies facade tint/pattern per building while keeping regeneration idempotent (same OSM id always looks the same). */
function hashUnit(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

function wallFacadeStyleFor(building: Building): number {
  if (building.kind === 'industrial') return FACADE_STYLE_MASONRY_WALL
  return building.heightMeters >= GLASS_HEIGHT_THRESHOLD_M ? FACADE_STYLE_GLASS_WALL : FACADE_STYLE_MASONRY_WALL
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
  facadeUv: number[],
  facadeParams: number[],
) {
  const ring = closedRingToOpen(building.footprint)
  if (ring.length < 3) return

  const seed = hashUnit(building.id)
  const style = wallFacadeStyleFor(building)

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
    const edgeLen = Math.hypot(dx, dy) || 1
    const nx = dy / edgeLen
    const nz = dx / edgeLen
    const wallUvs: [number, number][] = [
      [0, 0],
      [edgeLen, 0],
      [edgeLen, building.heightMeters],
      [0, building.heightMeters],
    ]
    for (let k = 0; k < 4; k++) {
      normals.push(nx, 0, nz)
      uvs.push(0, 0)
      facadeUv.push(wallUvs[k][0], wallUvs[k][1])
      facadeParams.push(seed, style)
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
    facadeUv.push(0, 0)
    facadeParams.push(seed, style + ROOF_STYLE_OFFSET)
  }
  for (const t of roofTris) indices.push(roofStart + t)
}
