/**
 * Explicit paint order for the draped layers, reinforcing the Y-offset
 * stacking order (see generation/landUseGeometry.ts and roadGeometry.ts):
 * terrain < land-use < water < roads < buildings < trees. Height offsets
 * alone can still read ambiguously at grazing angles or shared polygon
 * edges (e.g. a park boundary right at a lake's shore) — renderOrder makes
 * the intended draw order explicit rather than relying on depth alone.
 */
export const RENDER_ORDER = {
  terrain: 0,
  landUse: 1,
  water: 2,
  roads: 3,
  buildings: 4,
  trees: 5,
} as const
