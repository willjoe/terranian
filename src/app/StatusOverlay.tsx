import { useWorldStore } from '@/store/worldStore'

export function StatusOverlay() {
  const error = useWorldStore((s) => s.error)
  if (!error) return null
  return <div className="status-banner status-banner--error">{error}</div>
}
