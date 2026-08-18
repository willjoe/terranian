export class OverpassFetchError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'OverpassFetchError'
  }
}

export class MapboxElevationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'MapboxElevationError'
  }
}
