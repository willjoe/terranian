import { requireMapboxToken } from '@/config/env'
import { MapboxElevationError } from '@/pipeline/errors'
import type { TileCoord } from '@/data/mapbox/tileMath'
import { cacheGet, cacheSet, ELEVATION_TILE_STORE } from '@/data/cache/indexedDbCache'

export interface DecodedTile {
  coord: TileCoord
  size: number
  /** row-major, size*size, decoded elevation in meters */
  elevations: Float32Array
}

interface CachedElevationTile extends DecodedTile {
  cachedAt: number
}

/** Terrain doesn't move — persisted elevation tiles can live far longer than OSM's. */
const TILE_TTL_MS = 180 * 24 * 60 * 60 * 1000

/** Decodes Mapbox's Terrain-RGB encoding: elevation = -10000 + (R*65536 + G*256 + B) * 0.1 */
function decodeElevation(r: number, g: number, b: number): number {
  return -10000 + (r * 65536 + g * 256 + b) * 0.1
}

async function downloadTerrainTile(coord: TileCoord): Promise<DecodedTile> {
  const token = requireMapboxToken()
  const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${coord.z}/${coord.x}/${coord.y}.pngraw?access_token=${token}`

  let response: Response
  try {
    response = await fetch(url)
  } catch (err) {
    throw new MapboxElevationError('Failed to fetch elevation tile', err)
  }
  if (!response.ok) {
    throw new MapboxElevationError(`Elevation tile request failed with status ${response.status}`)
  }

  const blob = await response.blob()
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new MapboxElevationError('Canvas 2D context unavailable for elevation decoding')
  ctx.drawImage(bitmap, 0, 0)
  const { data, width: size } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)

  const elevations = new Float32Array(size * size)
  for (let i = 0; i < size * size; i++) {
    elevations[i] = decodeElevation(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
  }

  return { coord, size, elevations }
}

/** In-memory, first-level cache — avoids even an IndexedDB round-trip for a tile already loaded this session. */
const memoryCache = new Map<string, DecodedTile>()

function keyOf(coord: TileCoord): string {
  return `${coord.z}/${coord.x}/${coord.y}`
}

/**
 * Fetches a decoded Mapbox Terrain-RGB tile, reusing this session's
 * in-memory cache and, across page reloads/sessions, the persisted
 * IndexedDB cache (data/cache/indexedDbCache.ts) before hitting the
 * network — real elevation tiles are immutable in practice, so this is
 * one of the most effective things to cache long-term.
 */
export async function fetchTerrainTile(coord: TileCoord): Promise<DecodedTile> {
  const key = keyOf(coord)

  const inMemory = memoryCache.get(key)
  if (inMemory) return inMemory

  const persisted = await cacheGet<CachedElevationTile>(ELEVATION_TILE_STORE, key)
  if (persisted && Date.now() - persisted.cachedAt < TILE_TTL_MS) {
    memoryCache.set(key, persisted)
    return persisted
  }

  const tile = await downloadTerrainTile(coord)
  memoryCache.set(key, tile)
  void cacheSet<CachedElevationTile>(ELEVATION_TILE_STORE, key, { ...tile, cachedAt: Date.now() })
  return tile
}
