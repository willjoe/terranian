import type { BBox } from '@/geo/coords'
import { fetchOverpassData, type OverpassElement, type OverpassResponse } from '@/data/overpass/client'
import { cacheGet, cacheSet, OVERPASS_TILE_STORE } from '@/data/cache/indexedDbCache'

/**
 * The world is divided into a fixed grid, independent of where the user
 * picks — ~1km tall (smaller in real-world width at higher latitudes,
 * since this is a plain degree grid, not meters-adjusted; that's fine, it
 * only affects how many tiles a generation spans, not correctness). Fixed
 * tile boundaries are what make cross-generation cache reuse possible: two
 * nearby-but-different picked points can still land on the same tiles.
 */
const TILE_SIZE_DEG = 0.009

/** OSM data is user-edited and changes over time, so persisted tiles expire rather than being kept forever. */
const TILE_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface TileCoord {
  row: number
  col: number
}

interface CachedTile {
  elements: OverpassElement[]
  cachedAt: number
}

function tileCoordFor(lat: number, lon: number): TileCoord {
  return { row: Math.floor(lat / TILE_SIZE_DEG), col: Math.floor(lon / TILE_SIZE_DEG) }
}

function tileKey(t: TileCoord): string {
  return `${t.row},${t.col}`
}

function tileBBox(t: TileCoord): BBox {
  return {
    south: t.row * TILE_SIZE_DEG,
    north: (t.row + 1) * TILE_SIZE_DEG,
    west: t.col * TILE_SIZE_DEG,
    east: (t.col + 1) * TILE_SIZE_DEG,
  }
}

function tilesCoveringBBox(bbox: BBox): TileCoord[] {
  const sw = tileCoordFor(bbox.south, bbox.west)
  const ne = tileCoordFor(bbox.north, bbox.east)
  const tiles: TileCoord[] = []
  for (let row = sw.row; row <= ne.row; row++) {
    for (let col = sw.col; col <= ne.col; col++) {
      tiles.push({ row, col })
    }
  }
  return tiles
}

/** In-memory, first-level cache — avoids even an IndexedDB round-trip for a tile already loaded this session. */
const memoryCache = new Map<string, OverpassElement[]>()

async function loadTile(t: TileCoord): Promise<OverpassElement[]> {
  const key = tileKey(t)

  const inMemory = memoryCache.get(key)
  if (inMemory) return inMemory

  const persisted = await cacheGet<CachedTile>(OVERPASS_TILE_STORE, key)
  if (persisted && Date.now() - persisted.cachedAt < TILE_TTL_MS) {
    memoryCache.set(key, persisted.elements)
    return persisted.elements
  }

  const response = await fetchOverpassData(tileBBox(t))
  memoryCache.set(key, response.elements)
  void cacheSet<CachedTile>(OVERPASS_TILE_STORE, key, { elements: response.elements, cachedAt: Date.now() })
  return response.elements
}

/**
 * Fetches Overpass data for `bbox`, reusing already-fetched tiles from
 * earlier generations — both this session's in-memory cache and, across
 * page reloads/sessions, the persisted IndexedDB cache (see
 * data/cache/indexedDbCache.ts) — instead of re-querying ground we've
 * already covered. A single OSM way spanning multiple tiles comes back
 * (in full) from each tile query that touches it, so results are
 * deduplicated by element id when tiles are merged.
 *
 * Tiles are loaded one at a time, not via Promise.all — GENERATION_RADIUS_M
 * produces a bbox only slightly smaller than TILE_SIZE_DEG itself, so
 * almost any picked point straddles a tile boundary and a single
 * generation typically spans 2-4 tiles. Firing them all at once means
 * several requests hitting the very same shared public Overpass mirror
 * simultaneously (each tile's own fallback logic tries the mirrors in the
 * same fixed order on a cache miss) — exactly the kind of burst that trips
 * a mirror's rate limiting. Sequential keeps this app's footprint on that
 * free infrastructure to one request at a time; already-cached tiles
 * (the common case after the first generation in an area) still resolve
 * effectively instantly, so this only adds latency on a genuine miss.
 */
export async function fetchOverpassDataCached(bbox: BBox): Promise<OverpassResponse> {
  const tiles = tilesCoveringBBox(bbox)
  const allElements: OverpassElement[][] = []
  for (const tile of tiles) {
    allElements.push(await loadTile(tile))
  }

  const byId = new Map<string, OverpassElement>()
  for (const elements of allElements) {
    for (const el of elements) byId.set(`${el.type}/${el.id}`, el)
  }

  return { elements: [...byId.values()] }
}
