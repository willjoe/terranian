import { GENERATION_RADIUS_M } from '@/config/constants'
import { MapboxTokenMissingError } from '@/config/env'
import { bboxAroundPoint, type LatLon } from '@/geo/coords'
import { fetchOverpassDataCached } from '@/data/overpass/tileCache'
import { parseOverpass } from '@/data/overpass/parseOverpass'
import { fetchElevationHeightmap } from '@/data/mapbox/heightmap'
import { buildWorldModel } from '@/world/build'
import { MapboxElevationError, OverpassFetchError } from '@/pipeline/errors'
import { useWorldStore } from '@/store/worldStore'

/**
 * Guards against overlapping calls (the Generate button disables itself
 * mid-generation, but this is a second line of defense — e.g. a rapid
 * double-click landing before React re-renders the disabled state) ever
 * clobbering the store with a stale result. Each call captures its own
 * generation number; if a newer call has started by the time an earlier
 * one resolves, its result (success OR error) is silently discarded
 * instead of overwriting whatever the latest call already produced.
 */
let currentGeneration = 0

/** Orchestrates: bbox -> parallel OSM+elevation fetch -> world model -> store. */
export async function generateWorld(location: LatLon): Promise<void> {
  const generation = ++currentGeneration
  const isCurrent = () => generation === currentGeneration
  const { setStatus, setWorldModel, setError } = useWorldStore.getState()

  try {
    setStatus('computing-bbox')
    const bbox = bboxAroundPoint(location, GENERATION_RADIUS_M)

    setStatus('fetching-osm-and-elevation')
    const [osmRaw, terrainPatch] = await Promise.all([
      fetchOverpassDataCached(bbox),
      fetchElevationHeightmap(bbox, location),
    ])
    if (!isCurrent()) return

    setStatus('building-world')
    const parsed = parseOverpass(osmRaw)
    const worldModel = buildWorldModel(location, parsed, terrainPatch)
    if (!isCurrent()) return

    setWorldModel(worldModel)
    setStatus('ready')
  } catch (err) {
    if (!isCurrent()) return
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
