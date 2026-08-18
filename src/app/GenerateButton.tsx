import { generateWorld } from '@/pipeline/generateWorld'
import { useWorldStore, type GenerationStatus } from '@/store/worldStore'

const BUSY_LABELS: Partial<Record<GenerationStatus, string>> = {
  'computing-bbox': 'Computing area…',
  'fetching-osm-and-elevation': 'Fetching map + elevation data…',
  'building-world': 'Building world…',
}

export function GenerateButton() {
  const pickedLocation = useWorldStore((s) => s.pickedLocation)
  const status = useWorldStore((s) => s.status)
  const busyLabel = BUSY_LABELS[status]

  return (
    <button
      type="button"
      disabled={!pickedLocation || busyLabel !== undefined}
      onClick={() => pickedLocation && generateWorld(pickedLocation)}
    >
      {busyLabel ?? 'Generate World'}
    </button>
  )
}
