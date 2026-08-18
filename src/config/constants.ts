/** Radius (meters) around the picked point that gets fetched and generated. */
export const GENERATION_RADIUS_M = 500

/** Terrain heightmap grid resolution (cells per side). */
export const TERRAIN_GRID_RESOLUTION = 64

/** Target ground resolution (meters/pixel) used to pick a Mapbox Terrain-RGB zoom level. */
export const TARGET_TERRAIN_METERS_PER_PIXEL = 8

/**
 * Public Overpass instances are shared, free infrastructure and routinely
 * get overloaded (504s, hung connections). Tried in order; the client
 * moves on to the next mirror on failure/timeout rather than hard-failing.
 */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

/** Per-mirror request timeout (ms). Kept short so a hung mirror doesn't stall the whole chain. */
export const OVERPASS_TIMEOUT_MS = 20_000

export const NOMINATIM_SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search'

/** Tree scatter grid step (meters) inside forest/wood polygons, before jitter. */
export const TREE_SCATTER_STEP_M = 5

/** Hard cap on generated trees, as a perf guard for heavily-wooded areas. */
export const MAX_TREES = 4000

export const DEFAULT_BUILDING_HEIGHT_M = 6
export const METERS_PER_LEVEL = 3

/** Base low-poly tree mesh dimensions; per-instance scale derives from TreePoint.heightMeters / this. */
export const BASE_TREE_HEIGHT_M = 10
export const BASE_TREE_RADIUS_M = 2.25
