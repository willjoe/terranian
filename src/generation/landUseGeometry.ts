import earcut from 'earcut'
import type { LandUseArea, LandUseKind, TerrainPatch } from '@/world/schema'
import { sampleTerrainHeight } from '@/generation/sampleHeight'
import { toThreeVec3 } from '@/generation/toThreeSpace'
import type { GeometryData } from '@/generation/geometryTypes'

/**
 * Draped-layer stacking order (each well clear of the others so adjacent
 * polygons — e.g. a park right at a lake's shore — don't z-fight at their
 * shared boundary): terrain(0) < land-use < road outline/surface/centerline
 * (generation/roadGeometry.ts) < water. Every draped layer uses normal
 * depthTest/depthWrite (scene/LandUse.tsx, Water.tsx, Roads.tsx) rather
 * than a paint-order trick, so this Y-epsilon ordering is what actually
 * decides visibility — the same real depth space buildings/trees also
 * participate in, so nothing here clips against them inconsistently.
 * Water sits above the road layers so a non-bridge road that merely
 * grazes a water polygon's edge still loses to it — see
 * generation/roadGeometry.ts's own comment for the bridge case.
 */
const LAND_USE_Y_EPSILON = 0.05
/**
 * Water sits slightly *above* grade, like every other draped layer here —
 * not below it (see LAND_USE_Y_EPSILON's note on why "below" hides it
 * entirely behind the terrain mesh) — and above ROAD_CENTERLINE_Y_EPSILON
 * in generation/roadGeometry.ts, the highest of the road layers.
 */
const WATER_Y_EPSILON = 1.5

export function buildLandUseGeometry(areas: LandUseArea[], terrain: TerrainPatch, kind: LandUseKind): GeometryData {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (const area of areas) {
    if (area.kind !== kind) continue
    addArea(area, terrain, kind, positions, normals, uvs, indices)
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  }
}

function addArea(
  area: LandUseArea,
  terrain: TerrainPatch,
  kind: LandUseKind,
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
) {
  const polygon = area.polygon
  const ring =
    polygon.length > 1 &&
    polygon[0].x === polygon[polygon.length - 1].x &&
    polygon[0].y === polygon[polygon.length - 1].y
      ? polygon.slice(0, -1)
      : polygon
  if (ring.length < 3) return

  const flat: number[] = []
  for (const p of ring) flat.push(p.x, p.y)
  const tris = earcut(flat)
  const start = positions.length / 3

  // Every kind, including water, drapes per-vertex over the actual terrain
  // contour rather than sitting at one flat elevation for the whole
  // polygon. A single flat height (even "just the lowest point + a small
  // offset") only works for a genuinely small area — a coastline-derived
  // water polygon can span most of the generation radius, and real
  // terrain elevation varies enough across that scale that the opaque
  // terrain mesh would rise above a single flat plane almost everywhere,
  // hiding it. Water on real DEM data is already close to flat where it
  // matters (open water), so per-vertex draping still reads as flat in
  // practice while never risking being occluded by its own terrain.
  const epsilon = kind === 'water' ? WATER_Y_EPSILON : LAND_USE_Y_EPSILON
  for (const p of ring) {
    const height = sampleTerrainHeight(terrain, p.x, p.y) + epsilon
    positions.push(...toThreeVec3(p, height))
    normals.push(0, 1, 0)
    uvs.push(0, 0)
  }

  for (const t of tris) indices.push(start + t)
}
