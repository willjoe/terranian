/**
 * Explicit paint order for the draped layers, reinforcing the Y-offset
 * stacking order (see generation/landUseGeometry.ts and roadGeometry.ts):
 * terrain < land-use < (non-bridge road outline/surface/centerline) <
 * water < (bridge road outline/surface/centerline) < buildings < trees.
 *
 * Roads render with depthTest off (scene/Roads.tsx) rather than relying
 * on height offsets alone, so paint order — not world-space Y — is what
 * actually decides road-vs-terrain/land-use/water visibility here. Water
 * sits *between* the two road groups deliberately: a non-bridge road
 * painted before it can still be covered by water's own (depth-tested)
 * draw if they incidentally overlap, since real roads don't submerge —
 * but a bridge, tagged as such in OSM, is genuinely elevated above
 * whatever it crosses, so its road group paints after water and always
 * wins, matching roads' usual behaviour against everything else.
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
