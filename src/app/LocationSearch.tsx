import { useState, type FormEvent } from 'react'
import { NOMINATIM_SEARCH_ENDPOINT } from '@/config/constants'
import { useWorldStore } from '@/store/worldStore'

interface NominatimResult {
  display_name: string
  lat: string
  lon: string
}

export function LocationSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NominatimResult[]>([])
  const [searching, setSearching] = useState(false)
  const setPickedLocation = useWorldStore((s) => s.setPickedLocation)

  async function handleSearch(e: FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    try {
      const url = `${NOMINATIM_SEARCH_ENDPOINT}?format=json&q=${encodeURIComponent(query)}&limit=5`
      const response = await fetch(url)
      const data = (await response.json()) as NominatimResult[]
      setResults(data)
    } finally {
      setSearching(false)
    }
  }

  function selectResult(result: NominatimResult) {
    setPickedLocation({ lat: parseFloat(result.lat), lon: parseFloat(result.lon) })
    setResults([])
    setQuery(result.display_name)
  }

  return (
    <div className="location-search">
      <form onSubmit={handleSearch}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a place…"
        />
        <button type="submit" disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>
      {results.length > 0 && (
        <ul className="location-search-results">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <button type="button" onClick={() => selectResult(r)}>
                {r.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
