import type { LatLon } from '@/geo/coords'

/** A single OSM way, parsed out of Overpass `out geom;` output. */
export interface OsmWay {
  id: number
  tags: Record<string, string>
  geometry: LatLon[]
}

export interface ParsedOsmData {
  buildings: OsmWay[]
  roads: OsmWay[]
  landUse: OsmWay[]
  /** natural=coastline ways — open lines, not closed area polygons (see world/coastline.ts). */
  coastline: OsmWay[]
}
