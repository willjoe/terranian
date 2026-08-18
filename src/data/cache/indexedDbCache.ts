/**
 * Thin generic wrapper around IndexedDB for persisting fetched map data
 * across page reloads. IndexedDB rather than literal `localStorage`:
 * localStorage's ~5-10MB per-origin quota would overflow after just a few
 * generations at this data volume, and it can only store strings (would
 * need manually serializing/deserializing every Float32Array of elevation
 * data); IndexedDB has a much larger practical quota and stores typed
 * arrays natively via structured clone.
 */

const DB_NAME = 'terranian-cache'
const DB_VERSION = 1
export const OVERPASS_TILE_STORE = 'overpass-tiles'
export const ELEVATION_TILE_STORE = 'elevation-tiles'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(OVERPASS_TILE_STORE)) db.createObjectStore(OVERPASS_TILE_STORE)
      if (!db.objectStoreNames.contains(ELEVATION_TILE_STORE)) db.createObjectStore(ELEVATION_TILE_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

/**
 * Reads a cached value. Failures (private browsing, quota issues, an
 * unsupported browser) are swallowed and treated as a cache miss — this
 * cache is purely a performance optimization, never a correctness
 * requirement, so it should never be able to break world generation.
 */
export async function cacheGet<T>(store: string, key: string): Promise<T | undefined> {
  try {
    const db = await openDb()
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).get(key)
      request.onsuccess = () => resolve(request.result as T | undefined)
      request.onerror = () => reject(request.error)
    })
  } catch {
    return undefined
  }
}

export async function cacheSet<T>(store: string, key: string, value: T): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // Best-effort persistence — silently skip on failure.
  }
}
