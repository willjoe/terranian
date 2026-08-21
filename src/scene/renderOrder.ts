/**
 * Default paint order for the draped layers, matching the Y-offset
 * stacking order (see generation/landUseGeometry.ts and roadGeometry.ts):
 * terrain < land-use < (non-bridge road outline/surface/centerline) <
 * water < (bridge road outline/surface/centerline) < buildings < trees.
 *
 * Every one of these meshes uses normal depthTest/depthWrite (see
 * scene/Roads.tsx, LandUse.tsx, Water.tsx) — so what's actually visible
 * is decided by real 3D depth, the same space buildings/trees occupy,
 * not by this paint order. renderOrder still matters as the tie-break
 * for genuinely coplanar geometry (e.g. two road layers at the exact
 * same height), and keeping bridge roads listed after water documents
 * the intent even though a real bridge's elevation already settles it
 * via depth alone.
 */
export const RENDER_ORDER = {
  terrain: 0,
  landUse: 1,
  roadOutline: 2,
  roads: 3,
  roadCenterline: 4,
  water: 5,
  bridgeRoadOutline: 6,
  bridgeRoads: 7,
  bridgeRoadCenterline: 8,
  buildings: 9,
  trees: 10,
} as const
