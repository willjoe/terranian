import { create } from 'zustand'
import type { LatLon } from '@/geo/coords'
import type { WorldModel } from '@/world/schema'

export type GenerationStatus =
  | 'idle'
  | 'computing-bbox'
  | 'fetching-osm-and-elevation'
  | 'building-world'
  | 'ready'
  | 'error'

/** 'overview' is the free-orbit camera; 'driving' hands control to scene/DrivingRig.tsx. */
export type ViewMode = 'overview' | 'driving'

interface WorldStore {
  pickedLocation: LatLon | null
  worldModel: WorldModel | null
  status: GenerationStatus
  error: string | null
  mode: ViewMode
  setPickedLocation: (location: LatLon) => void
  setStatus: (status: GenerationStatus) => void
  setWorldModel: (model: WorldModel) => void
  setError: (message: string) => void
  setMode: (mode: ViewMode) => void
}

export const useWorldStore = create<WorldStore>((set) => ({
  pickedLocation: null,
  worldModel: null,
  status: 'idle',
  error: null,
  mode: 'overview',
  setPickedLocation: (location) => set({ pickedLocation: location, error: null }),
  setStatus: (status) => set({ status }),
  setWorldModel: (model) => set({ worldModel: model }),
  setError: (message) => set({ error: message, status: 'error' }),
  setMode: (mode) => set({ mode }),
}))
