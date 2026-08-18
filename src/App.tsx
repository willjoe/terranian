import { LocationPicker } from '@/app/LocationPicker'
import { LocationSearch } from '@/app/LocationSearch'
import { GenerateButton } from '@/app/GenerateButton'
import { StatusOverlay } from '@/app/StatusOverlay'
import { WorldScene } from '@/scene/WorldScene'
import { useWorldStore } from '@/store/worldStore'

export function App() {
  const worldModel = useWorldStore((s) => s.worldModel)

  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <div className="app-brand">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="app-logo" />
          <h1>terranian</h1>
        </div>
        <p className="app-tagline">Pick a place, generate a theoretical 3D world from real map data.</p>
        <LocationSearch />
        <div className="app-map">
          <LocationPicker />
        </div>
        <GenerateButton />
        <StatusOverlay />
      </aside>
      <main className="app-viewport">
        {worldModel ? (
          <WorldScene world={worldModel} />
        ) : (
          <div className="app-empty-state">Pick a location and click Generate World.</div>
        )}
      </main>
    </div>
  )
}
