import { useWorldStore, type ViewMode } from '@/store/worldStore'

const MODES: { value: ViewMode; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'driving', label: 'Driving Mode' },
]

export function ModeSelector() {
  const worldModel = useWorldStore((s) => s.worldModel)
  const mode = useWorldStore((s) => s.mode)
  const setMode = useWorldStore((s) => s.setMode)

  return (
    <fieldset className="mode-selector" disabled={!worldModel}>
      <legend>View mode</legend>
      {MODES.map((m) => (
        <label key={m.value} className="mode-selector-option">
          <input type="radio" name="view-mode" checked={mode === m.value} onChange={() => setMode(m.value)} />
          {m.label}
        </label>
      ))}
      {mode === 'driving' && worldModel && (
        <p className="mode-selector-hint">↑ drive, ↓ brake/reverse, ← → steer. Max 150 mph.</p>
      )}
    </fieldset>
  )
}
