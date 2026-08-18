import { TARGET_TERRAIN_METERS_PER_PIXEL, TERRAIN_GRID_RESOLUTION } from '@/config/constants'
import { latLonToLocal, localToLatLon, type BBox, type LatLon } from '@/geo/coords'
import type { TerrainPatch } from '@/world/schema'
import {
  lonLatToTileFraction,
  tileKey,
  tilesCoveringBBox,
  zoomForTargetResolution,
} from '@/data/mapbox/tileMath'
import { fetchTerrainTile, type DecodedTile } from '@/data/mapbox/terrainRgb'

async function fetchTiles(bbox: BBox, zoom: number): Promise<Map<string, DecodedTile>> {
  const coords = tilesCoveringBBox(bbox, zoom)
  const tiles = await Promise.all(coords.map(fetchTerrainTile))
  const map = new Map<string, DecodedTile>()
  tiles.forEach((tile) => map.set(tileKey(tile.coord), tile))
  return map
}

/**
 * Bilinear-samples elevation at a lon/lat. Sampling is clamped within a
 * single tile's own pixel bounds rather than reaching into neighboring
 * tiles, which can leave a sub-pixel discontinuity right at a tile
 * boundary — imperceptible at this app's terrain grid resolution.
 */
function sampleElevation(lon: number, lat: number, zoom: number, tiles: Map<string, DecodedTile>): number {
  const frac = lonLatToTileFraction(lon, lat, zoom)
  const tileX = Math.floor(frac.x)
  const tileY = Math.floor(frac.y)
  const tile = tiles.get(tileKey({ z: zoom, x: tileX, y: tileY }))
  if (!tile) return 0

  const px = (frac.x - tileX) * tile.size
  const py = (frac.y - tileY) * tile.size
  const x0 = Math.min(tile.size - 1, Math.max(0, Math.floor(px)))
  const y0 = Math.min(tile.size - 1, Math.max(0, Math.floor(py)))
  const x1 = Math.min(tile.size - 1, x0 + 1)
  const y1 = Math.min(tile.size - 1, y0 + 1)
  const fx = px - x0
  const fy = py - y0

  const at = (x: number, y: number) => tile.elevations[y * tile.size + x]
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx
  return top * (1 - fy) + bottom * fy
}

/**
 * Fetches Mapbox Terrain-RGB tiles covering `bbox` and assembles a
 * TerrainPatch heightmap grid, normalized so `origin` sits at height 0.
 */
export async function fetchElevationHeightmap(bbox: BBox, origin: LatLon): Promise<TerrainPatch> {
  const zoom = zoomForTargetResolution(origin.lat, TARGET_TERRAIN_METERS_PER_PIXEL)
  const tiles = await fetchTiles(bbox, zoom)

  const sw = latLonToLocal(origin, { lat: bbox.south, lon: bbox.west })
  const ne = latLonToLocal(origin, { lat: bbox.north, lon: bbox.east })
  const widthMeters = ne.x - sw.x
  const depthMeters = ne.y - sw.y

  const resolution = TERRAIN_GRID_RESOLUTION
  const gridSize = resolution + 1
  const heights = new Array<number>(gridSize * gridSize)

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const localX = sw.x + (col / resolution) * widthMeters
      const localY = sw.y + (row / resolution) * depthMeters
      const ll = localToLatLon(origin, { x: localX, y: localY })
      heights[row * gridSize + col] = sampleElevation(ll.lon, ll.lat, zoom, tiles)
    }
  }

  const originElevation = sampleElevation(origin.lon, origin.lat, zoom, tiles)
  let minElevation = Infinity
  let maxElevation = -Infinity
  for (let i = 0; i < heights.length; i++) {
    heights[i] -= originElevation
    minElevation = Math.min(minElevation, heights[i])
    maxElevation = Math.max(maxElevation, heights[i])
  }

  return { origin, widthMeters, depthMeters, resolution, heights, minElevation, maxElevation }
}
