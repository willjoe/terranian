import type { BBox } from '@/geo/coords'
import { fetchOverpassData, type OverpassElement, type OverpassResponse } from '@/data/overpass/client'

/**
 * The world is divided into a fixed grid, independent of where the user
 * picks — ~1km tall (smaller in real-world width at higher latitudes,
 * since this is a plain degree grid, not meters-adjusted; that's fine, it
 * only affects how many tiles a generation spans, not correctness). Fixed
 * tile boundaries are what make cross-generation cache reuse possible: two
 * nearby-but-different picked points can still land on the same tiles.
 */
const TILE_SIZE_DEG = 0.009

interface TileCoord {
  row: number
  col: number
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

/**
 * In-memory, per-session cache: tile key -> the elements Overpass returned
 * for that tile. Resets on page reload — this is about not re-fetching the
 * same ground twice while generating multiple nearby locations in one
 * sitting, not long-term persistence (OSM data changes over time, and a
 * stale disk cache would need its own invalidation story).
 */
const tileCache = new Map<string, OverpassElement[]>()

/**
 * Fetches Overpass data for `bbox`, reusing already-fetched tiles from
 * earlier generations instead of re-querying ground we've already covered.
 * A single OSM way spanning multiple tiles comes back (in full) from each
 * tile query that touches it, so results are deduplicated by element id
 * when tiles are merged.
 */
export async function fetchOverpassDataCached(bbox: BBox): Promise<OverpassResponse> {
  const tiles = tilesCoveringBBox(bbox)
  const missing = tiles.filter((t) => !tileCache.has(tileKey(t)))

  if (missing.length > 0) {
    const fetched = await Promise.all(missing.map((t) => fetchOverpassData(tileBBox(t))))
    missing.forEach((t, i) => tileCache.set(tileKey(t), fetched[i].elements))
  }

  const byId = new Map<string, OverpassElement>()
  for (const t of tiles) {
    for (const el of tileCache.get(tileKey(t)) ?? []) {
      byId.set(`${el.type}/${el.id}`, el)
    }
  }

  return { elements: [...byId.values()] }
}
