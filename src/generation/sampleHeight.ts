import type { TerrainPatch } from '@/world/schema'

/**
 * Height sample at local (x,y) meters relative to the world origin,
 * matching the *exact* flat-triangle surface rendered by
 * generation/terrainGeometry.ts — each grid cell is split into two flat
 * triangles (a,b,c) and (b,d,c) along the same diagonal, and this
 * interpolates linearly within whichever triangle (x,y) falls in.
 *
 * This must NOT be plain bilinear interpolation across the quad: bilinear
 * is a curved (saddle) surface that only agrees with the flat-triangulated
 * mesh along that diagonal and on the four corners, diverging elsewhere.
 * Every other layer (roads, buildings, land-use, water, trees) samples
 * height through this function, so a mismatch here meant those layers
 * could dip below the actual rendered terrain surface wherever local
 * curvature exceeded their small constant Y offset — not just at edges,
 * but systematically across any cell with real bilinear "twist".
 *
 * Assumes the heightmap grid is centered on the origin, spanning
 * [-width/2, +width/2] x [-depth/2, +depth/2] — true by construction since
 * the elevation fetch bbox is symmetric around the origin (see
 * data/mapbox/heightmap.ts).
 */
export function sampleTerrainHeight(terrain: TerrainPatch, x: number, y: number): number {
  const { resolution, widthMeters, depthMeters, heights } = terrain
  const gridSize = resolution + 1

  const u = ((x + widthMeters / 2) / widthMeters) * resolution
  const v = ((y + depthMeters / 2) / depthMeters) * resolution

  const col0 = Math.min(resolution - 1, Math.max(0, Math.floor(u)))
  const row0 = Math.min(resolution - 1, Math.max(0, Math.floor(v)))
  const col1 = col0 + 1
  const row1 = row0 + 1
  const fx = Math.min(1, Math.max(0, u - col0))
  const fy = Math.min(1, Math.max(0, v - row0))

  const at = (col: number, row: number) => heights[row * gridSize + col]
  const ha = at(col0, row0)
  const hb = at(col1, row0)
  const hc = at(col0, row1)
  const hd = at(col1, row1)

  if (fx + fy <= 1) {
    // Triangle (a,b,c)
    return ha + fx * (hb - ha) + fy * (hc - ha)
  }
  // Triangle (b,d,c)
  const gx = 1 - fx
  const gy = 1 - fy
  return hd + gx * (hc - hd) + gy * (hb - hd)
}
