import { GENERATION_RADIUS_M } from '@/config/constants'
import { MapboxTokenMissingError } from '@/config/env'
import { bboxAroundPoint, type LatLon } from '@/geo/coords'
import { fetchOverpassDataCached } from '@/data/overpass/tileCache'
import { parseOverpass } from '@/data/overpass/parseOverpass'
import { fetchElevationHeightmap } from '@/data/mapbox/heightmap'
import { buildWorldModel } from '@/world/build'
import { MapboxElevationError, OverpassFetchError } from '@/pipeline/errors'
import { useWorldStore } from '@/store/worldStore'

/** Orchestrates: bbox -> parallel OSM+elevation fetch -> world model -> store. */
export async function generateWorld(location: LatLon): Promise<void> {
  const { setStatus, setWorldModel, setError } = useWorldStore.getState()

  try {
    setStatus('computing-bbox')
    const bbox = bboxAroundPoint(location, GENERATION_RADIUS_M)

    setStatus('fetching-osm-and-elevation')
    const [osmRaw, terrainPatch] = await Promise.all([
      fetchOverpassDataCached(bbox),
      fetchElevationHeightmap(bbox, location),
    ])

    setStatus('building-world')
    const parsed = parseOverpass(osmRaw)
    const worldModel = buildWorldModel(location, parsed, terrainPatch)

    setWorldModel(worldModel)
    setStatus('ready')
  } catch (err) {
    setError(messageForError(err))
  }
}

function messageForError(err: unknown): string {
  if (err instanceof MapboxTokenMissingError) return err.message
  if (err instanceof MapboxElevationError) return `Elevation data error: ${err.message}`
  if (err instanceof OverpassFetchError) return `OpenStreetMap data error: ${err.message}`
  if (err instanceof Error) return err.message
  return 'World generation failed for an unknown reason.'
}
