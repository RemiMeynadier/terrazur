// Addresses in Paris (Base Adresse Nationale).
export interface Address {
  label: string
  lat: number
  lon: number
}

export async function searchAddress(q: string): Promise<Address[]> {
  const params = new URLSearchParams({ q, limit: '5', lat: '48.8566', lon: '2.3522' })
  const res = await fetch(`https://api-adresse.data.gouv.fr/search/?${params}`)
  if (!res.ok) return []
  const body = await res.json()
  return (body.features ?? [])
    .filter((f: any) => String(f.properties.citycode ?? '').startsWith('751'))
    .map((f: any) => ({ label: f.properties.label, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
}
