import { readFileSync, writeFileSync } from 'node:fs'
import { decodePng } from './lib/png-decoder.mjs'

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf-8')
const token = envText.match(/VITE_MAPBOX_TOKEN=(.+)/)[1].trim()

const [, , latArg, lonArg, outPath] = process.argv
const lat = Number(latArg)
const lon = Number(lonArg)
const RADIUS_M = 500
const RESOLUTION = 64
const TARGET_M_PER_PX = 8

function zoomForTargetResolution(latDeg, targetMetersPerPixel) {
  const metersPerPixelAtZoom0 = 156543.03392 * Math.cos((latDeg * Math.PI) / 180)
  const zoom = Math.log2(metersPerPixelAtZoom0 / targetMetersPerPixel)
  return Math.min(18, Math.max(10, Math.round(zoom)))
}
function lonLatToTileFraction(lon, lat, zoom) {
  const n = 2 ** zoom
  const x = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return { x, y }
}
function metersPerDegLon(latDeg) { return 111320 * Math.cos((latDeg * Math.PI) / 180) }
function bboxAroundPoint(center, radiusMeters) {
  const dLat = radiusMeters / 111320
  const dLon = radiusMeters / metersPerDegLon(center.lat)
  return { south: center.lat - dLat, west: center.lon - dLon, north: center.lat + dLat, east: center.lon + dLon }
}
function latLonToLocal(origin, p) {
  return { x: (p.lon - origin.lon) * metersPerDegLon(origin.lat), y: (p.lat - origin.lat) * 111320 }
}
function localToLatLon(origin, p) {
  return { lat: origin.lat + p.y / 111320, lon: origin.lon + p.x / metersPerDegLon(origin.lat) }
}

const zoom = zoomForTargetResolution(lat, TARGET_M_PER_PX)
const bbox = bboxAroundPoint({ lat, lon }, RADIUS_M)
const nw = lonLatToTileFraction(bbox.west, bbox.north, zoom)
const se = lonLatToTileFraction(bbox.east, bbox.south, zoom)
const minX = Math.floor(nw.x), maxX = Math.floor(se.x)
const minY = Math.floor(nw.y), maxY = Math.floor(se.y)

const tiles = new Map()
for (let x = minX; x <= maxX; x++) {
  for (let y = minY; y <= maxY; y++) {
    const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${zoom}/${x}/${y}.pngraw?access_token=${token}`
    const res = await fetch(url)
    const buf = Buffer.from(await res.arrayBuffer())
    const png = decodePng(buf)
    const elevations = new Float32Array(png.width * png.height)
    for (let i = 0; i < png.width * png.height; i++) {
      const r = png.data[i * png.channels], g = png.data[i * png.channels + 1], b = png.data[i * png.channels + 2]
      elevations[i] = -10000 + (r * 65536 + g * 256 + b) * 0.1
    }
    tiles.set(`${x},${y}`, { size: png.width, elevations })
  }
}

function sampleElevation(lon, lat) {
  const f = lonLatToTileFraction(lon, lat, zoom)
  const tx = Math.floor(f.x), ty = Math.floor(f.y)
  const tile = tiles.get(`${tx},${ty}`)
  if (!tile) return 0
  const px = (f.x - tx) * tile.size
  const py = (f.y - ty) * tile.size
  const x0 = Math.min(tile.size - 1, Math.max(0, Math.floor(px)))
  const y0 = Math.min(tile.size - 1, Math.max(0, Math.floor(py)))
  const x1 = Math.min(tile.size - 1, x0 + 1)
  const y1 = Math.min(tile.size - 1, y0 + 1)
  const fx = px - x0, fy = py - y0
  const at = (x, y) => tile.elevations[y * tile.size + x]
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx
  return top * (1 - fy) + bottom * fy
}

const origin = { lat, lon }
const sw = latLonToLocal(origin, { lat: bbox.south, lon: bbox.west })
const ne = latLonToLocal(origin, { lat: bbox.north, lon: bbox.east })
const widthMeters = ne.x - sw.x
const depthMeters = ne.y - sw.y
const gridSize = RESOLUTION + 1
const heights = new Array(gridSize * gridSize)

for (let row = 0; row < gridSize; row++) {
  for (let col = 0; col < gridSize; col++) {
    const localX = sw.x + (col / RESOLUTION) * widthMeters
    const localY = sw.y + (row / RESOLUTION) * depthMeters
    const ll = localToLatLon(origin, { x: localX, y: localY })
    heights[row * gridSize + col] = sampleElevation(ll.lon, ll.lat)
  }
}

const originElevation = sampleElevation(origin.lon, origin.lat)
let minElevation = Infinity, maxElevation = -Infinity
for (let i = 0; i < heights.length; i++) {
  heights[i] -= originElevation
  minElevation = Math.min(minElevation, heights[i])
  maxElevation = Math.max(maxElevation, heights[i])
}

const terrain = { origin, widthMeters, depthMeters, resolution: RESOLUTION, heights, minElevation, maxElevation }
writeFileSync(outPath, JSON.stringify(terrain))
console.log(`saved ${outPath}: minElevation=${minElevation.toFixed(2)} maxElevation=${maxElevation.toFixed(2)}`)
