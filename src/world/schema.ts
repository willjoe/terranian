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

export interface Road {
  id: string
  centerline: LocalPoint[]
  widthMeters: number
  kind: RoadKind
  tags: Record<string, string>
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
