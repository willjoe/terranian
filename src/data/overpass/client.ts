import { OVERPASS_ENDPOINTS, OVERPASS_TIMEOUT_MS } from '@/config/constants'
import type { BBox } from '@/geo/coords'
import { OverpassFetchError } from '@/pipeline/errors'
import { buildOverpassQuery } from '@/data/overpass/query'

interface OverpassElement {
  type: 'way' | 'node' | 'relation'
  id: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
}

interface OverpassResponse {
  elements: OverpassElement[]
}

async function fetchFromEndpoint(endpoint: string, query: string): Promise<OverpassResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`status ${response.status}`)
    }

    const data = (await response.json()) as OverpassResponse
    if (!Array.isArray(data.elements)) {
      throw new Error('missing elements array')
    }
    return data
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Tries each configured Overpass mirror in order, moving on to the next on
 * any failure (bad status, timeout, malformed response) — public Overpass
 * instances are shared free infrastructure and routinely get overloaded.
 */
export async function fetchOverpassData(bbox: BBox): Promise<OverpassResponse> {
  const query = buildOverpassQuery(bbox)
  const failures: string[] = []

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      return await fetchFromEndpoint(endpoint, query)
    } catch (err) {
      const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : String(err)
      failures.push(`${new URL(endpoint).hostname}: ${reason}`)
    }
  }

  throw new OverpassFetchError(
    `All Overpass mirrors failed or timed out. This is usually a busy public server — try again shortly. ` +
      `If it keeps happening, an ad-blocker or privacy extension may be silently blocking these requests; ` +
      `try disabling it for this site, or check the Network tab for the actual request status. (${failures.join('; ')})`,
  )
}

export type { OverpassElement, OverpassResponse }
