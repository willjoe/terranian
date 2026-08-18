import { DEFAULT_BUILDING_HEIGHT_M, METERS_PER_LEVEL } from '@/config/constants'
import type { BuildingKind, LandUseKind, RoadKind } from '@/world/schema'

export function estimateBuildingHeight(tags: Record<string, string>): number {
  const explicitHeight = parseFloat(tags.height ?? '')
  if (!Number.isNaN(explicitHeight) && explicitHeight > 0) return explicitHeight

  const levels = parseFloat(tags['building:levels'] ?? '')
  if (!Number.isNaN(levels) && levels > 0) return levels * METERS_PER_LEVEL

  return DEFAULT_BUILDING_HEIGHT_M
}

export function buildingLevels(tags: Record<string, string>): number | undefined {
  const levels = parseFloat(tags['building:levels'] ?? '')
  return Number.isNaN(levels) ? undefined : levels
}

export function buildingKindForTags(tags: Record<string, string>): BuildingKind {
  const building = tags.building ?? ''
  if (['house', 'apartments', 'residential', 'detached', 'terrace', 'dormitory'].includes(building)) {
    return 'residential'
  }
  if (['commercial', 'retail', 'office', 'supermarket', 'hotel'].includes(building)) {
    return 'commercial'
  }
  if (['industrial', 'warehouse', 'factory'].includes(building)) {
    return 'industrial'
  }
  if (['church', 'cathedral', 'chapel', 'mosque', 'temple', 'synagogue'].includes(building)) {
    return 'religious'
  }
  return 'other'
}

const ROAD_WIDTHS_M: Record<RoadKind, number> = {
  motorway: 12,
  primary: 9,
  secondary: 7,
  tertiary: 6,
  residential: 5.5,
  service: 3.5,
  path: 1.5,
  footway: 1.5,
  other: 4,
}

export function roadKindForHighwayTag(highway: string | undefined): RoadKind {
  switch (highway) {
    case 'motorway':
    case 'motorway_link':
      return 'motorway'
    case 'primary':
    case 'primary_link':
      return 'primary'
    case 'secondary':
    case 'secondary_link':
      return 'secondary'
    case 'tertiary':
    case 'tertiary_link':
      return 'tertiary'
    case 'residential':
    case 'living_street':
    case 'unclassified':
      return 'residential'
    case 'service':
    case 'track':
      return 'service'
    case 'path':
    case 'cycleway':
    case 'bridleway':
    case 'steps':
      return 'path'
    case 'footway':
    case 'pedestrian':
      return 'footway'
    default:
      return 'other'
  }
}

export function roadWidthForHighwayType(highway: string | undefined): number {
  return ROAD_WIDTHS_M[roadKindForHighwayTag(highway)]
}

export function landUseTypeForTags(tags: Record<string, string>): LandUseKind {
  const landuse = tags.landuse
  const natural = tags.natural
  const leisure = tags.leisure

  if (landuse === 'forest' || natural === 'wood') return 'forest'
  if (['farmland', 'farm', 'meadow', 'orchard', 'vineyard'].includes(landuse ?? '')) return 'farmland'
  if (natural === 'water' || landuse === 'reservoir' || tags.water || tags.waterway) return 'water'
  if (landuse === 'residential') return 'residential'
  if (leisure === 'park' || leisure === 'garden' || landuse === 'grass' || natural === 'grassland') {
    return 'grass'
  }
  return 'other'
}
