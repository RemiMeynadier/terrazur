// Google Places (New): rating and photo of the café behind a terrace.
// Needs a browser key restricted to the site (GOOGLE_PLACES_KEY secret,
// passed to the build as VITE_GOOGLE_PLACES_KEY). Looked up only for the
// terraces on screen, and remembered for the session.

export const PLACES_KEY: string = import.meta.env.VITE_GOOGLE_PLACES_KEY ?? ''

export interface PlaceInfo {
  rating: number | null
  count: number
  url: string | null
  photo: string | null // image URL
  photoBy: { name: string; uri: string } | null
}

const memo = new Map<number, Promise<PlaceInfo | null>>()

export function fetchPlace(id: number, name: string, addr: string, lat: number, lon: number): Promise<PlaceInfo | null> {
  let p = memo.get(id)
  if (!p) {
    p = lookup(name, addr, lat, lon)
    p.catch(() => memo.delete(id))
    memo.set(id, p)
  }
  return p
}

async function lookup(name: string, addr: string, lat: number, lon: number): Promise<PlaceInfo | null> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': PLACES_KEY,
      'X-Goog-FieldMask': 'places.rating,places.userRatingCount,places.googleMapsUri,places.photos,places.location',
    },
    body: JSON.stringify({
      textQuery: `${name} ${addr} Paris`,
      locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: 60 } },
      maxResultCount: 1,
      languageCode: 'fr',
    }),
  })
  if (!res.ok) throw new Error(`Places HTTP ${res.status}`)
  const place = (await res.json()).places?.[0]
  if (!place) return null
  // A match more than ~80 m away is another business.
  const k = 111_320
  const d = Math.hypot((place.location.latitude - lat) * k, (place.location.longitude - lon) * k * Math.cos((lat * Math.PI) / 180))
  if (d > 80) return null
  const photo = place.photos?.[0]
  return {
    rating: place.rating ?? null,
    count: place.userRatingCount ?? 0,
    url: place.googleMapsUri ?? null,
    photo: photo ? `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=640&key=${PLACES_KEY}` : null,
    photoBy: photo?.authorAttributions?.[0] ? { name: photo.authorAttributions[0].displayName, uri: photo.authorAttributions[0].uri } : null,
  }
}
