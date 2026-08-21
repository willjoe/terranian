# terranian

Generate a theoretical 3D representation of any real-world place, on the fly, in the browser — built from live OpenStreetMap data (buildings, roads, land use) and real elevation data (Mapbox Terrain-RGB). It isn't a pixel-perfect reconstruction; it's a plausible procedural rendering driven by real tags and real terrain shape.

Pick a point on the map (or search a place name), hit **Generate World**, and a 3D scene is built for the ~1km area around it: sloped terrain, extruded buildings, roads, forests (as scattered trees), farmland, and water. A view-mode radio in the sidebar switches between **Overview** (free-orbit camera) and **Driving Mode** — drive a car through the generated world with the arrow keys (↑ throttle, ↓ brake/reverse, ← → steer), with real momentum, gravity, terrain-slope-driven jumps, and collision against every building, capped at 150 mph (`src/generation/carPhysics.ts`, `src/scene/DrivingRig.tsx`).

## Setup

```bash
npm install
cp .env.example .env
```

Add a free Mapbox token to `.env` (used for elevation data only):

1. Sign up at [mapbox.com](https://www.mapbox.com/) (free tier).
2. Account → Tokens → copy your default public token.
3. Paste it into `.env`:
   ```
   VITE_MAPBOX_TOKEN=pk.your_token_here
   ```

```bash
npm run dev
```

## How it works

- **OpenStreetMap** — a live [Overpass API](https://overpass-api.de/) query fetches buildings, roads, and land-use polygons for a bounding box around the picked point. No pre-downloaded extracts — any location works, at query time. `src/data/overpass/tileCache.ts` divides the world into a fixed ~1km grid (independent of where anyone picks); generating a second nearby location only fetches whichever tiles weren't already covered, merging in the rest from cache (deduplicated by OSM element id, since a way spanning multiple tiles comes back in full from each one).
- **Coastal water** — oceans/bays/large lakes are usually mapped in OSM as `natural=coastline` *lines* (the boundary), not closed water polygons. `src/world/coastline.ts` reconstructs a fillable water area from them by grid-sampling a nearest-coastline-segment classifier (which side of the closest piece of coastline a point falls on, using OSM's land-on-left/water-on-right convention) and extracting contours with marching squares — robust to arbitrarily complex real coastlines (marinas, docks, multiple islands) since it has no assumptions about the coastline's global topology. An earlier vector-based approach (walk the generation-radius circle, splicing in the coastline shape at each crossing) was tried first and discarded after visual comparison against real OSM tiles (see below) showed it produced badly wrong shapes for anything more complex than a single simple bay.
- **Roads** — three separate merged meshes per generation (`src/generation/roadGeometry.ts`): a wide grey outline standing in for a sidewalk, draped *below* the dark road surface so that at intersections the overlapping outlines from several roads just blend into one continuous area instead of showing seams — the (narrower, higher) surfaces on top hide the parts of the outline that are actually driven on, leaving only the outer margin visible; and a dashed yellow centerline painted on top of the surface. Footways/paths get a surface but no outline or centerline, since they're already pedestrian space.
- **Bridges** — `src/world/bridges.ts` detects wherever a road's centerline geometrically crosses a water polygon or a building footprint (independent of OSM's often-missing `bridge` tag) and computes an elevation profile for it: a single ramp up at a max 5% grade, a flat plateau at the clearance height the crossing needs, then a single ramp back down — one continuous arch, never more than one hump. Clearance is 3m above a building's own roof height for a building crossing, or (for a water crossing) a height read off a straight-line gradient between two anchor points — a 1km-wide crossing needs ~20m of clearance, a 4km-wide one ~75m — since a wider crossing tends to mean a deeper, busier shipping channel. Obstacles close enough together that a ramp can't fully descend to ground and back up between them are merged into one span instead of producing two small humps back to back.
- **Elevation** — [Mapbox Terrain-RGB](https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-rgb-v1/) raster tiles are fetched and decoded client-side into a heightmap, cached the same tile-based way as OSM data.
- **Caching** — both the Overpass tiles and Mapbox elevation tiles persist across page reloads in the browser's IndexedDB (`src/data/cache/indexedDbCache.ts`), not just in memory for the session. IndexedDB rather than plain `localStorage`: its ~5-10MB per-origin quota would overflow after a handful of generations at this data volume, and it can't natively store the typed arrays (`Float32Array`) elevation data comes back as. OSM tiles expire after 7 days (the underlying data is user-edited and changes); elevation tiles — terrain doesn't move — after 180.
- **World model** — OSM tags and terrain are combined into a plain, JSON-serializable `WorldModel` (see `src/world/schema.ts`) with no rendering-engine dependency.
- **Rendering** — `src/generation/` turns the world model into raw geometry buffers, and `src/scene/` (the only layer that imports three.js) renders them with React Three Fiber.

### Architecture

```
geo/        lat/lon <-> local meters, bbox math (pure)
data/       Overpass + Mapbox fetch clients (pure)
world/      the portable WorldModel schema + builders (pure, JSON-serializable)
generation/ WorldModel -> raw geometry buffers (pure, no three.js)
scene/      React Three Fiber components (the only three.js-aware layer)
app/        location picker / search / generate button UI
pipeline/   orchestrates the end-to-end fetch -> build -> render pipeline
```

`geo/`, `data/`, and `world/` never import three.js. That's deliberate: `world/schema.ts` is meant to also be the interchange format for a future non-web target — e.g. an Unreal Engine import pipeline that reads the same `WorldModel` JSON to build a Landscape, place buildings/roads/foliage, and paint land-use materials. Nothing like that is built yet, but the schema doesn't preclude it.

## Visual comparison tool

`tools/visual-compare.mjs` renders the app's actual generated data (buildings/roads/land-use/water — same pipeline the browser uses) as a flat top-down PNG, alongside a real OpenStreetMap tile crop for the same location, so the two can be checked against each other directly instead of eyeballing the 3D scene:

```bash
node tools/visual-compare.mjs <lat> <lon> [name]
# e.g. node tools/visual-compare.mjs 49.2717 -123.1348 granville
```

Saves `tools/output/<name>_osm.png` (real reference) and `tools/output/<name>_ours.png` (our data, same scale/projection) — open both to compare. This is how the coastline reconstruction above was actually debugged: the vector-splicing approach looked plausible in isolation but was visibly, badly wrong once compared against real tile imagery, which is what motivated switching to the grid/marching-squares approach.

## Known MVP limitations

- Only OSM `way` elements are handled — `relation` (multipolygon) features are skipped. Fine at the ~500m generation radius used here.
- OSM data is cached in memory per tile (see below) for the session, but elevation and generated geometry are not — every "Generate" click re-fetches elevation and rebuilds geometry from scratch.
- No backend — Overpass and Mapbox are called directly from the browser. Nominatim search works for casual/dev use, but its usage policy prefers a custom `User-Agent`, which browser `fetch` can't set; a production deployment would need a thin proxy.
- Single bounded radius, fixed terrain grid resolution — no chunking/streaming for larger areas.
- Public Overpass instances are shared free infrastructure and routinely get overloaded (504s, hung connections). The client tries a short list of mirrors in order (see `OVERPASS_ENDPOINTS` in `src/config/constants.ts`) and only surfaces an error once all of them fail — if it happens repeatedly, add another known-good mirror to that list.
- Coastline reconstruction (`world/coastline.ts`) grid-samples at `WATER_GRID_RESOLUTION` (96 cells/side) and contours with marching squares, so very thin features (a boat slip narrower than one grid cell, ~10m at the default radius) can be missed or merged. `world/build.ts` also sanity-checks each reconstructed water polygon against the actual fetched buildings and drops it if it would enclose an implausible fraction of them (real buildings should never be "inside" water) as a defense-in-depth safety net, independent of the grid method's own robustness.
- Buildings sit on a single flat base (the *median* of terrain height sampled across their footprint), extruded up by a fixed height. Fine for typical buildings, since terrain barely varies across a small footprint — but a very large building on real sloped/varying terrain (e.g. an airport terminal spanning hundreds of meters) can still have a portion of its roof below the surrounding terrain at its highest corners, since one flat base can't perfectly fit a footprint with real elevation variation.
