import type { BBox } from '@/geo/coords'

export interface TileCoord {
  z: number
  x: number
  y: number
}

/** Picks an integer Mapbox zoom level whose ground resolution is close to the target. */
export function zoomForTargetResolution(latDeg: number, targetMetersPerPixel: number): number {
  const metersPerPixelAtZoom0 = 156_543.03392 * Math.cos((latDeg * Math.PI) / 180)
  const zoom = Math.log2(metersPerPixelAtZoom0 / targetMetersPerPixel)
  return Math.min(18, Math.max(10, Math.round(zoom)))
}

/** Continuous (non-floored) Web Mercator tile coordinates for a lon/lat at a given zoom. */
export function lonLatToTileFraction(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom
  const x = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return { x, y }
}

export function tilesCoveringBBox(bbox: BBox, zoom: number): TileCoord[] {
  const nw = lonLatToTileFraction(bbox.west, bbox.north, zoom)
  const se = lonLatToTileFraction(bbox.east, bbox.south, zoom)
  const minX = Math.floor(nw.x)
  const maxX = Math.floor(se.x)
  const minY = Math.floor(nw.y)
  const maxY = Math.floor(se.y)

  const tiles: TileCoord[] = []
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tiles.push({ z: zoom, x, y })
    }
  }
  return tiles
}

export function tileKey(c: TileCoord): string {
  return `${c.z}/${c.x}/${c.y}`
}
