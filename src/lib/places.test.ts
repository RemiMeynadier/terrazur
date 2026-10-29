import { describe, expect, it } from 'vitest'
import type { DataIndex } from '../api/data'
import { contains, streetOf, suggest } from './places'

const index = {
  quartiers: [
    { id: 22, name: 'Odéon', arr: 6, lat: 48.85, lon: 2.34 },
    { id: 40, name: 'Hôpital-Saint-Louis', arr: 10, lat: 48.88, lon: 2.37 },
  ],
  terraces: [
    { id: 1, name: 'A', lat: 48.85, lon: 2.34, cell: 'x', quartier: 22, addr: '12 RUE DE TOURNON' },
    { id: 2, name: 'B', lat: 48.85, lon: 2.34, cell: 'x', quartier: 22, addr: '14 BIS RUE DE TOURNON' },
    { id: 3, name: 'C', lat: 48.88, lon: 2.37, cell: 'y', quartier: 40, addr: '35 RUE DE LA GRANGE AUX BELLES' },
  ],
} as unknown as DataIndex

describe('places', () => {
  it('strips street numbers', () => {
    expect(streetOf('14 BIS RUE DE TOURNON')).toBe('RUE DE TOURNON')
    expect(streetOf('3 PLACE DE LA CONTRESCARPE')).toBe('PLACE DE LA CONTRESCARPE')
  })

  it('suggests arrondissements, quartiers and streets', () => {
    expect(suggest(index, '10e', true)[0].label).toBe('10e arrondissement')
    expect(suggest(index, '75006', true)[0].label).toBe('6e arrondissement')
    expect(suggest(index, 'odeon', true)[0].label).toBe('Odéon')
    expect(suggest(index, 'saint louis', true)[0].label).toBe('Hôpital-Saint-Louis')
    const street = suggest(index, 'tournon', true)[0]
    expect(street.label).toBe('Rue de Tournon')
    expect(street.hint).toBe('2')
    const venue = suggest(index, 'grange', true).find((x) => x.place.kind === 'venue')
    expect(venue).toBeUndefined() // no terrace named so; streets still match
    expect(suggest(index, 'tournon', true).some((x) => x.place.kind === 'street')).toBe(true)
  })

  it('finds establishments by name, once each', () => {
    const idx = { ...index, terraces: [...index.terraces, { id: 4, name: 'CAFE TOURNON', lat: 48.849, lon: 2.337, cell: 'x', quartier: 22, addr: '18 RUE DE TOURNON' }, { id: 5, name: 'CAFE TOURNON', lat: 48.8490001, lon: 2.3370001, cell: 'x', quartier: 22, addr: '18 RUE DE TOURNON' }] } as unknown as DataIndex
    const v = suggest(idx, 'cafe tour', true).filter((x) => x.place.kind === 'venue')
    expect(v.length).toBe(1)
    expect(v[0].label).toBe('Cafe Tournon')
    expect(idx.terraces.filter((x) => contains(idx, x, v[0].place)).map((x) => x.id)).toEqual([4, 5])
  })

  it('selects the terraces of a place', () => {
    const e = index.terraces
    expect(e.filter((x) => contains(index, x, { kind: 'arr', n: 6 })).map((x) => x.id)).toEqual([1, 2])
    expect(e.filter((x) => contains(index, x, { kind: 'street', name: 'RUE DE TOURNON' })).length).toBe(2)
    expect(e.filter((x) => contains(index, x, { kind: 'here', lat: 48.88, lon: 2.37 })).map((x) => x.id)).toEqual([3])
  })
})
