import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'
import { encodePng } from './lib/png-encoder.mjs'
import { fetchOsmCrop } from './lib/osm-tiles.mjs'
import { createCanvas, fillPolygon, drawLine } from './lib/rasterize.mjs'

const [, , latArg, lonArg, nameArg] = process.argv
if (!latArg || !lonArg) {
  console.error('Usage: node tools/visual-compare.mjs <lat> <lon> [name]')
  process.exit(1)
}
const lat = Number(latArg)
const lon = Number(lonArg)
const name = nameArg ?? `${latArg}_${lonArg}`.replace(/[^\w.-]/g, '_')

const outDir = new URL('./output/', import.meta.url).pathname
mkdirSync(outDir, { recursive: true })

const server = await createServer({
  configFile: new URL('../vite.config.ts', import.meta.url).pathname,
  root: new URL('..', import.meta.url).pathname,
  server: { middlewareMode: true },
})

const { GENERATION_RADIUS_M } = await server.ssrLoadModule('/src/config/constants.ts')
const { bboxAroundPoint } = await server.ssrLoadModule('/src/geo/coords.ts')
const { buildOverpassQuery } = await server.ssrLoadModule('/src/data/overpass/query.ts')
const { parseOverpass } = await server.ssrLoadModule('/src/data/overpass/parseOverpass.ts')
const { buildWorldModel } = await server.ssrLoadModule('/src/world/build.ts')

// The app's fetchOverpassData works fine in a real browser, but Node's bare
// fetch (no browser User-Agent/Accept headers) gets rejected by some public
// Overpass mirrors as bot-like traffic — so this tool fetches directly with
// an identifying header instead of reusing that client.
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

async function fetchOverpassDirect(bbox) {
  const query = buildOverpassQuery(bbox)
  const failures = []
  for (const endpoint of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'terranian-dev-visual-compare-tool (local testing)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      failures.push(`${new URL(endpoint).hostname}: ${err.message}`)
    }
  }
  throw new Error(`All Overpass mirrors failed: ${failures.join('; ')}`)
}

console.log(`Generating world model for (${lat}, ${lon})...`)
const location = { lat, lon }
const bbox = bboxAroundPoint(location, GENERATION_RADIUS_M)

// Flat terrain stub: this tool compares X/Y placement of water/land-use/
// roads/buildings against real OSM tiles, which elevation doesn't affect.
// Real elevation fetch needs browser Canvas/ImageBitmap APIs unavailable
// in plain Node, so it's skipped here rather than reimplemented.
const RESOLUTION = 4
const terrain = {
  origin: location,
  widthMeters: GENERATION_RADIUS_M * 2,
  depthMeters: GENERATION_RADIUS_M * 2,
  resolution: RESOLUTION,
  heights: new Array((RESOLUTION + 1) ** 2).fill(0),
  minElevation: 0,
  maxElevation: 0,
}

const osmRaw = await fetchOverpassDirect(bbox)
const parsed = parseOverpass(osmRaw)
const world = buildWorldModel(location, parsed, terrain)
console.log(`  buildings=${world.buildings.length} roads=${world.roads.length} landUse=${world.landUse.length} trees=${world.trees.length}`)

await server.close()

console.log('Fetching OSM reference tile crop...')
const OSM_ZOOM = 16
const osm = await fetchOsmCrop(bbox, OSM_ZOOM)
writeFileSync(`${outDir}${name}_osm.png`, encodePng(osm.width, osm.height, osm.rgb))
console.log(`  saved ${outDir}${name}_osm.png (${osm.width}x${osm.height})`)

const pxPerMeterX = osm.width / (GENERATION_RADIUS_M * 2)
const pxPerMeterY = osm.height / (GENERATION_RADIUS_M * 2)

function toPixel(p) {
  return {
    x: osm.width / 2 + p.x * pxPerMeterX,
    y: osm.height / 2 - p.y * pxPerMeterY,
  }
}

const BG = [242, 239, 233] // osm-carto-ish land background
const canvas = createCanvas(osm.width, osm.height, BG)

const LAND_USE_COLORS = {
  forest: [173, 209, 158],
  farmland: [238, 240, 213],
  residential: [224, 223, 223],
  grass: [205, 235, 176],
  other: [230, 230, 230],
}
for (const area of world.landUse) {
  if (area.kind === 'water') continue
  fillPolygon(canvas, osm.width, osm.height, area.polygon.map(toPixel), LAND_USE_COLORS[area.kind] ?? [230, 230, 230])
}

const WATER_COLOR = [170, 211, 223]
for (const area of world.landUse) {
  if (area.kind !== 'water') continue
  fillPolygon(canvas, osm.width, osm.height, area.polygon.map(toPixel), WATER_COLOR)
}

for (const building of world.buildings) {
  fillPolygon(canvas, osm.width, osm.height, building.footprint.map(toPixel), [217, 208, 201])
}

const ROAD_COLOR = [255, 255, 255]
for (const road of world.roads) {
  const pts = road.centerline.map(toPixel)
  const thickness = Math.max(1, road.widthMeters * pxPerMeterX)
  for (let i = 0; i < pts.length - 1; i++) drawLine(canvas, osm.width, osm.height, pts[i], pts[i + 1], ROAD_COLOR, thickness)
}

writeFileSync(`${outDir}${name}_ours.png`, encodePng(osm.width, osm.height, canvas))
console.log(`  saved ${outDir}${name}_ours.png (${osm.width}x${osm.height})`)
console.log('Done. View both PNGs to compare.')
