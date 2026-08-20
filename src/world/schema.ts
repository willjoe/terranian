import type { LatLon, LocalPoint } from '@/geo/coords'

/**
 * Everything in this file is plain, JSON-serializable data with no
 * dependency on three.js or any renderer. This is the intermediate format
 * a future non-web (e.g. Unreal Engine) importer would consume unchanged.
 */

export interface TerrainPatch {
  origin: LatLon
  widthMeters: number
  depthMeters: number
  /** grid cells per side; the heights array is (resolution+1) x (resolution+1) */
  resolution: number
  /** row-major, length (resolution+1)^2, meters relative to origin elevation */
  heights: number[]
  minElevation: number
  maxElevation: number
}

export type BuildingKind = 'residential' | 'commercial' | 'industrial' | 'religious' | 'other'

export interface Building {
  id: string
  /** closed polygon in local meters (x=east, y=north) */
  footprint: LocalPoint[]
  heightMeters: number
  levels?: number
  kind: BuildingKind
  tags: Record<string, string>
}

export type RoadKind =
  | 'motorway'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'service'
  | 'path'
  | 'footway'
  | 'other'

/**
 * A single elevated arch along a road's centerline, computed in
 * world/bridges.ts wherever the road geometrically crosses water or a
 * building footprint. Distances are arc-length meters from the start of
 * `Road.centerline` (0 = first point). The profile is a single ramp up
 * from `rampStart` to `plateauStart`, a flat plateau at `heightMeters`
 * from `plateauStart` to `plateauEnd`, then a single ramp back down to
 * `rampEnd` — one continuous rise and one continuous descent, never more
 * than one hump, per the real shape of a bridge.
 */
export interface BridgeSpan {
  rampStart: number
  rampEnd: number
  plateauStart: number
  plateauEnd: number
  /** meters of extra height above the normal terrain-drape height, at the plateau */
  heightMeters: number
}

export interface Road {
  id: string
  centerline: LocalPoint[]
  widthMeters: number
  kind: RoadKind
  tags: Record<string, string>
  /** present only where this road needs to arch above water or a building — see world/bridges.ts */
  bridgeSpans?: BridgeSpan[]
}

export type LandUseKind = 'forest' | 'farmland' | 'water' | 'residential' | 'grass' | 'other'

export interface LandUseArea {
  id: string
  polygon: LocalPoint[]
  kind: LandUseKind
  tags: Record<string, string>
}

export interface TreePoint {
  position: LocalPoint
  /** canopy radius, meters */
  radius: number
  heightMeters: number
}

export interface WorldModel {
  origin: LatLon
  boundsMeters: { width: number; depth: number }
  terrain: TerrainPatch
  buildings: Building[]
  roads: Road[]
  landUse: LandUseArea[]
  trees: TreePoint[]
  generatedAt: string
  sourceAttribution: { osm: true; mapbox: true }
}
