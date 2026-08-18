import type { BBox } from '@/geo/coords'

/**
 * Builds an Overpass QL query for the feature categories terranian
 * understands. Uses `out geom;` so each way's node coordinates come back
 * inline (avoids manually stitching node IDs to ways client-side).
 *
 * Only `way` elements are queried — OSM `relation` (multipolygon) features
 * (large forests/lakes/farms sometimes modeled that way) are intentionally
 * out of scope for this MVP; acceptable at the ~500m generation radius,
 * where most such features are simple ways.
 */
export function buildOverpassQuery(bbox: BBox): string {
  const b = `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`
  return `
[out:json][timeout:25];
(
  way["building"]${b};
  way["highway"]${b};
  way["landuse"]${b};
  way["natural"]${b};
  way["leisure"~"^(park|garden)$"]${b};
  way["water"]${b};
  way["waterway"]${b};
);
out geom;
`.trim()
}
