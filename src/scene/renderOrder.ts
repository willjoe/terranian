/**
 * Explicit paint order for the draped layers, reinforcing the Y-offset
 * stacking order (see generation/landUseGeometry.ts and roadGeometry.ts):
 * terrain < land-use < water < road outline < road surface < road
 * centerline < buildings < trees. Height offsets alone can still read
 * ambiguously at grazing angles or shared polygon edges (e.g. a park
 * boundary right at a lake's shore) — renderOrder makes the intended draw
 * order explicit rather than relying on depth alone.
 */
export const RENDER_ORDER = {
  terrain: 0,
  landUse: 1,
  water: 2,
  roadOutline: 3,
  roads: 4,
  roadCenterline: 5,
  buildings: 6,
  trees: 7,
} as const
