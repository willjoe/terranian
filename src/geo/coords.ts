export interface LatLon {
  lat: number
  lon: number
}

export interface LocalPoint {
  /** meters east of the origin */
  x: number
  /** meters north of the origin */
  y: number
}

export interface BBox {
  south: number
  west: number
  north: number
  east: number
}

/**
 * Equirectangular flat-earth approximation. Valid at the city/neighborhood
 * scale this app operates at (~1km); not suitable for continental distances.
 */
const METERS_PER_DEG_LAT = 111_320

function metersPerDegLon(originLatDeg: number): number {
  return METERS_PER_DEG_LAT * Math.cos((originLatDeg * Math.PI) / 180)
}

export function latLonToLocal(origin: LatLon, p: LatLon): LocalPoint {
  return {
    x: (p.lon - origin.lon) * metersPerDegLon(origin.lat),
    y: (p.lat - origin.lat) * METERS_PER_DEG_LAT,
  }
}

export function localToLatLon(origin: LatLon, p: LocalPoint): LatLon {
  return {
    lat: origin.lat + p.y / METERS_PER_DEG_LAT,
    lon: origin.lon + p.x / metersPerDegLon(origin.lat),
  }
}

/** Overpass expects bbox args in (south,west,north,east) order — centralized here. */
export function bboxAroundPoint(center: LatLon, radiusMeters: number): BBox {
  const dLat = radiusMeters / METERS_PER_DEG_LAT
  const dLon = radiusMeters / metersPerDegLon(center.lat)
  return {
    south: center.lat - dLat,
    west: center.lon - dLon,
    north: center.lat + dLat,
    east: center.lon + dLon,
  }
}
