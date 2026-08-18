import { decodePng } from './png-decoder.mjs'

const TILE_SIZE = 256

export function lonLatToTileFraction(lon, lat, zoom) {
  const n = 2 ** zoom
  const x = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return { x, y }
}

async function fetchTile(z, x, y) {
  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
  const res = await fetch(url, { headers: { 'User-Agent': 'terranian-dev-visual-compare-tool (local testing)' } })
  if (!res.ok) throw new Error(`tile fetch failed: ${z}/${x}/${y} -> HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return decodePng(buf)
}

/**
 * Fetches and stitches OSM raster tiles covering `bbox` at `zoom`, then
 * crops to the exact bbox in pixel space. Returns { width, height, rgb }
 * (RGB buffer, alpha dropped) plus the pixel-per-meter scale actually used
 * (so callers can map local-meter coordinates into this same pixel space).
 */
export async function fetchOsmCrop(bbox, zoom) {
  const nw = lonLatToTileFraction(bbox.west, bbox.north, zoom)
  const se = lonLatToTileFraction(bbox.east, bbox.south, zoom)

  const minTileX = Math.floor(nw.x)
  const maxTileX = Math.floor(se.x)
  const minTileY = Math.floor(nw.y)
  const maxTileY = Math.floor(se.y)

  const tilesWide = maxTileX - minTileX + 1
  const tilesHigh = maxTileY - minTileY + 1
  const stitched = Buffer.alloc(tilesWide * TILE_SIZE * tilesHigh * TILE_SIZE * 3)
  const stitchedStride = tilesWide * TILE_SIZE * 3

  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      const tile = await fetchTile(zoom, tx, ty)
      const destX0 = (tx - minTileX) * TILE_SIZE
      const destY0 = (ty - minTileY) * TILE_SIZE
      for (let py = 0; py < TILE_SIZE; py++) {
        for (let px = 0; px < TILE_SIZE; px++) {
          const srcIdx = (py * TILE_SIZE + px) * tile.channels
          const destIdx = ((destY0 + py) * stitchedStride) + (destX0 + px) * 3
          stitched[destIdx] = tile.data[srcIdx]
          stitched[destIdx + 1] = tile.data[srcIdx + 1]
          stitched[destIdx + 2] = tile.data[srcIdx + 2]
        }
      }
    }
  }

  // Crop window: pixel offset of bbox.west/north within the stitched image.
  const cropX0 = Math.round((nw.x - minTileX) * TILE_SIZE)
  const cropY0 = Math.round((nw.y - minTileY) * TILE_SIZE)
  const cropX1 = Math.round((se.x - minTileX) * TILE_SIZE)
  const cropY1 = Math.round((se.y - minTileY) * TILE_SIZE)
  const width = cropX1 - cropX0
  const height = cropY1 - cropY0

  const rgb = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    const srcRowStart = ((cropY0 + y) * stitchedStride) + cropX0 * 3
    const destRowStart = y * width * 3
    stitched.copy(rgb, destRowStart, srcRowStart, srcRowStart + width * 3)
  }

  return { width, height, rgb }
}
