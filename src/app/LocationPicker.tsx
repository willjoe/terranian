import { useEffect } from 'react'
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { GENERATION_RADIUS_M } from '@/config/constants'
import type { LatLon } from '@/geo/coords'
import { useWorldStore } from '@/store/worldStore'

const pickedMarkerIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

// Arbitrary default view (New York City) before the user picks or searches a location.
const DEFAULT_CENTER: LatLon = { lat: 40.7128, lon: -74.006 }

function ClickHandler() {
  const setPickedLocation = useWorldStore((s) => s.setPickedLocation)
  useMapEvents({
    click(e) {
      setPickedLocation({ lat: e.latlng.lat, lon: e.latlng.lng })
    },
  })
  return null
}

function JumpToLocation({ location }: { location: LatLon | null }) {
  const map = useMap()
  useEffect(() => {
    if (location) map.setView([location.lat, location.lon], Math.max(map.getZoom(), 15), { animate: false })
  }, [location, map])
  return null
}

export function LocationPicker() {
  const pickedLocation = useWorldStore((s) => s.pickedLocation)

  return (
    <MapContainer
      center={[DEFAULT_CENTER.lat, DEFAULT_CENTER.lon]}
      zoom={13}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler />
      <JumpToLocation location={pickedLocation} />
      {pickedLocation && (
        <>
          <Marker position={[pickedLocation.lat, pickedLocation.lon]} icon={pickedMarkerIcon} />
          <Circle
            center={[pickedLocation.lat, pickedLocation.lon]}
            radius={GENERATION_RADIUS_M}
            pathOptions={{ color: '#4f8cff' }}
          />
        </>
      )}
    </MapContainer>
  )
}
