import { latLonToLocal, type LatLon, type LocalPoint } from '@/geo/coords'
import { clipPolygonToRadius, clipPolylineToRadius } from '@/geo/circleClip'
import type { OsmWay, ParsedOsmData } from '@/data/types'
import type { Building, LandUseArea, Road, TerrainPatch, WorldModel } from '@/world/schema'
import {
  buildingKindForTags,
  buildingLevels,
  estimateBuildingHeight,
  landUseTypeForTags,
  roadKindForHighwayTag,
  roadWidthForHighwayType,
} from '@/world/tags'
import { scatterTrees } from '@/world/treeScatter'
import { buildWaterPolygonsFromCoastline } from '@/world/coastline'

function wayToLocalPolygon(origin: LatLon, way: OsmWay): LocalPoint[] {
  return way.geometry.map((ll) => latLonToLocal(origin, ll))
}

function isWithinRadius(p: LocalPoint, radius: number): boolean {
  return p.x * p.x + p.y * p.y <= radius * radius
}

/**
 * OSM buildings are small and rectilinear, so unlike land use/roads they
 * aren't clipped to the radius circle (a circular bite out of a building
 * footprint would look wrong) — a building that isn't fully inside the
 * generation radius is dropped instead.
 */
function buildBuildings(origin: LatLon, ways: OsmWay[], radius: number): Building[] {
  const buildings: Building[] = []
  for (const way of ways) {
    const footprint = wayToLocalPolygon(origin, way)
    if (!footprint.every((p) => isWithinRadius(p, radius))) continue
    buildings.push({
      id: `building/${way.id}`,
      footprint,
      heightMeters: estimateBuildingHeight(way.tags),
      levels: buildingLevels(way.tags),
      kind: buildingKindForTags(way.tags),
      tags: way.tags,
    })
  }
  return buildings
}

/**
 * Roads are clipped to the radius circle so a long street doesn't sprawl
 * out into unrendered space beyond the generated terrain. A single OSM way
 * can produce more than one Road if it exits and re-enters the circle.
 */
function buildRoads(origin: LatLon, ways: OsmWay[], radius: number): Road[] {
  const roads: Road[] = []
  for (const way of ways) {
    const centerline = wayToLocalPolygon(origin, way)
    const chains = clipPolylineToRadius(centerline, radius)
    chains.forEach((chain, i) => {
      roads.push({
        id: chains.length > 1 ? `road/${way.id}/${i}` : `road/${way.id}`,
        centerline: chain,
        widthMeters: roadWidthForHighwayType(way.tags.highway),
        kind: roadKindForHighwayTag(way.tags.highway),
        tags: way.tags,
      })
    })
  }
  return roads
}

/**
 * Land-use polygons (forests, lakes, parks, farmland...) are frequently
 * larger than the generation radius — Overpass returns their full,
 * unclipped real-world extent — so they're clipped to the radius circle
 * to fill in cleanly at the edge instead of rendering an arbitrary
 * fragment of a much larger shape. See geo/circleClip.ts.
 */
function buildLandUse(origin: LatLon, ways: OsmWay[], radius: number): LandUseArea[] {
  const areas: LandUseArea[] = []
  for (const way of ways) {
    const polygon = clipPolygonToRadius(wayToLocalPolygon(origin, way), radius)
    if (polygon.length < 3) continue
    areas.push({
      id: `landuse/${way.id}`,
      polygon,
      kind: landUseTypeForTags(way.tags),
      tags: way.tags,
    })
  }
  return areas
}

function centroidOf(polygon: LocalPoint[]): LocalPoint {
  let x = 0
  let y = 0
  for (const p of polygon) {
    x += p.x
    y += p.y
  }
  return { x: x / polygon.length, y: y / polygon.length }
}

function pointInPolygon(point: LocalPoint, polygon: LocalPoint[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const { x: xi, y: yi } = polygon[i]
    const { x: xj, y: yj } = polygon[j]
    const crosses = yi > point.y !== yj > point.y
    if (crosses && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Fraction of buildings whose centroid falls inside `rings`, in [0, 1]. */
function fractionOfBuildingsInside(buildings: Building[], rings: LocalPoint[][]): number {
  if (buildings.length === 0) return 0
  const inside = buildings.filter((b) => rings.some((ring) => pointInPolygon(centroidOf(b.footprint), ring))).length
  return inside / buildings.length
}

/** Any single reconstructed water ring covering more than this fraction of the buildings is treated as corrupted. */
const MAX_PLAUSIBLE_BUILDING_OVERLAP = 0.25

/**
 * Oceans/bays/large lakes are usually mapped in OSM as `natural=coastline`
 * lines (the land/water boundary), not closed area polygons — see
 * world/coastline.ts for how a fillable water area is reconstructed from
 * them. Synthesized areas get their own id namespace since they don't
 * correspond to a single OSM way.
 *
 * Real coastline data can be complex enough (e.g. marinas/docks with deep,
 * winding indentations) that a reconstructed ring's boundary technically
 * closes without self-intersecting but still doesn't correctly separate
 * water from land — it ends up enclosing real buildings, which should
 * never happen for a genuine water area. Each ring is sanity-checked
 * against the actual fetched buildings and dropped if it swallows an
 * implausible fraction of them, rather than risk silently hiding most of
 * the generated area behind wrong "water".
 */
function buildCoastlineWater(origin: LatLon, coastlineWays: OsmWay[], radius: number, buildings: Building[]): LandUseArea[] {
  const rings = buildWaterPolygonsFromCoastline(origin, coastlineWays, radius)
  const plausible = rings.filter((ring) => fractionOfBuildingsInside(buildings, [ring]) <= MAX_PLAUSIBLE_BUILDING_OVERLAP)

  return plausible.map((polygon, i) => ({
    id: `coastline-water/${i}`,
    polygon,
    kind: 'water' as const,
    tags: { natural: 'coastline' },
  }))
}

export function buildWorldModel(origin: LatLon, parsed: ParsedOsmData, terrain: TerrainPatch): WorldModel {
  // Local coordinates are constructed so the terrain patch is exactly
  // centered on the origin (see data/mapbox/heightmap.ts), so this is the
  // same radius shown to the user as the picker's preview circle.
  const radius = terrain.widthMeters / 2

  const buildings = buildBuildings(origin, parsed.buildings, radius)
  const roads = buildRoads(origin, parsed.roads, radius)
  const landUse = [
    ...buildLandUse(origin, parsed.landUse, radius),
    ...buildCoastlineWater(origin, parsed.coastline, radius, buildings),
  ]
  const trees = scatterTrees(landUse.filter((area) => area.kind === 'forest'))

  return {
    origin,
    boundsMeters: { width: terrain.widthMeters, depth: terrain.depthMeters },
    terrain,
    buildings,
    roads,
    landUse,
    trees,
    generatedAt: new Date().toISOString(),
    sourceAttribution: { osm: true, mapbox: true },
  }
}
