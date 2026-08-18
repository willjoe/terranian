import type { OverpassElement, OverpassResponse } from '@/data/overpass/client'
import type { OsmWay, ParsedOsmData } from '@/data/types'

function toOsmWay(el: OverpassElement): OsmWay | null {
  if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) return null
  return {
    id: el.id,
    tags: el.tags ?? {},
    geometry: el.geometry.map((g) => ({ lat: g.lat, lon: g.lon })),
  }
}

/**
 * OSM area features are only valid on ways whose geometry is actually a
 * closed ring (first node === last node). Linear features like
 * `natural=coastline` or `waterway=river/stream` share the same tag keys
 * we filter land-use on but are open paths — treating them as fillable
 * polygons artificially "closes" them with a straight edge back to the
 * start, producing an essentially arbitrary (often self-intersecting)
 * shape with no relation to real land/water boundaries.
 */
function isClosedRing(way: OsmWay): boolean {
  const first = way.geometry[0]
  const last = way.geometry[way.geometry.length - 1]
  return way.geometry.length >= 4 && first.lat === last.lat && first.lon === last.lon
}

export function parseOverpass(response: OverpassResponse): ParsedOsmData {
  const buildings: OsmWay[] = []
  const roads: OsmWay[] = []
  const landUse: OsmWay[] = []
  const coastline: OsmWay[] = []

  for (const el of response.elements) {
    const way = toOsmWay(el)
    if (!way) continue

    const tags = way.tags
    if (tags.building) {
      buildings.push(way)
    } else if (tags.highway) {
      roads.push(way)
    } else if (tags.natural === 'coastline') {
      coastline.push(way)
    } else if ((tags.landuse || tags.natural || tags.leisure || tags.water || tags.waterway) && isClosedRing(way)) {
      landUse.push(way)
    }
  }

  return { buildings, roads, landUse, coastline }
}
