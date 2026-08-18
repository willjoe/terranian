export class MapboxTokenMissingError extends Error {
  constructor() {
    super('VITE_MAPBOX_TOKEN is not set. Copy .env.example to .env and add a free Mapbox token.')
    this.name = 'MapboxTokenMissingError'
  }
}

export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

export function requireMapboxToken(): string {
  if (!MAPBOX_TOKEN) throw new MapboxTokenMissingError()
  return MAPBOX_TOKEN
}
