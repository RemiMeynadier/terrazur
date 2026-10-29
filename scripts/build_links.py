#!/usr/bin/env python3
"""Website (or Instagram / Facebook page) of each terrace's café, bar or restaurant.

Terraces only carry the operator's name; websites come from OpenStreetMap
(Overpass API): an establishment of the same name within 60 m.

Usage: python3 scripts/build_links.py DATA_DIR [--osm FILE]
Reads DATA_DIR/index.json (from build_horizons.py), writes DATA_DIR/links.json.
"""

import argparse
import datetime as dt
import json
import math
import os
import re
import subprocess
import sys
import time
import unicodedata

OVERPASS = 'https://overpass-api.de/api/interpreter'
QUERY = (
    '[out:json][timeout:90][bbox:48.815,2.224,48.903,2.47];'
    'nwr["amenity"~"^(cafe|bar|pub|restaurant|fast_food|ice_cream|biergarten)$"]["name"];'
    'out center tags;'
)
UA = 'terrazur/1.0 (https://github.com/RemiMeynadier/terrazur)'
RADIUS = 60  # m
LINK_TAGS = ('website', 'contact:website', 'url', 'contact:instagram', 'instagram', 'contact:facebook', 'facebook')

# Words that say nothing about which place it is.
NOISE = set(
    'SARL SAS SASU SNC EURL SA SCI STE SOCIETE ETS LE LA LES L DE DU DES D ET AU AUX A THE CHEZ '
    'CAFE BAR BRASSERIE RESTAURANT RESTO BISTROT BISTRO TABAC PARIS'.split()
)


def overpass():
    for attempt in range(5):
        r = subprocess.run(
            ['curl', '-s', '--compressed', '-m', '120', '-A', UA, '--data-urlencode', f'data={QUERY}', OVERPASS],
            capture_output=True,
        )
        try:
            return json.loads(r.stdout)['elements']
        except (ValueError, KeyError):
            print(f'overpass busy, retry {attempt + 1}', file=sys.stderr)
            time.sleep(30)
    sys.exit('overpass unavailable')


def words(name):
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().upper()
    return [w for w in re.split(r'[^A-Z0-9]+', s) if w and w not in NOISE]


def similar(a, b):
    """1 for the same name, down to 0; small words must match exactly."""
    wa, wb = words(a), words(b)
    if not wa or not wb:
        return 0.0
    if ''.join(wa) == ''.join(wb):
        return 1.0
    sa, sb = set(wa), set(wb)
    j = len(sa & sb) / len(sa | sb)
    ja, jb = ''.join(wa), ''.join(wb)
    if min(len(ja), len(jb)) >= 5 and (ja in jb or jb in ja):
        j = max(j, 0.8)
    return j


def link(tags):
    for k in LINK_TAGS:
        v = tags.get(k, '').split(';')[0].strip()
        if not v:
            continue
        if k.endswith('instagram') and not v.startswith('http'):
            v = 'https://www.instagram.com/' + v.lstrip('@')
        if k.endswith('facebook') and not v.startswith('http'):
            v = 'https://www.facebook.com/' + v
        if not re.match(r'^https?://', v):
            v = 'https://' + v
        if re.match(r'^https?://[^\s/]+\.[^\s/]+', v):
            return v
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('data')
    ap.add_argument('--osm', help='saved Overpass answer, instead of querying')
    a = ap.parse_args()

    with open(os.path.join(a.data, 'index.json')) as f:
        terraces = json.load(f)['terraces']
    elements = json.load(open(a.osm))['elements'] if a.osm else overpass()

    # OSM places with a link, on a ~110 m grid.
    grid = {}
    for e in elements:
        url = link(e.get('tags', {}))
        lat, lon = (e['lat'], e['lon']) if 'lat' in e else (e['center']['lat'], e['center']['lon'])
        if url:
            grid.setdefault((round(lat * 1000), round(lon * 1000)), []).append((lat, lon, e['tags']['name'], url))

    links = {}
    for tid, name, lat, lon, *_ in terraces:
        best = None
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for plat, plon, pname, url in grid.get((round(lat * 1000) + di, round(lon * 1000) + dj), []):
                    d = math.hypot((plat - lat) * 111_320, (plon - lon) * 111_320 * math.cos(math.radians(lat)))
                    s = similar(name, pname)
                    if d <= RADIUS and s >= 0.5 and (best is None or (s, -d) > best[0]):
                        best = ((s, -d), url)
        if best:
            links[str(tid)] = best[1]

    out = {'generated': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), 'links': links}
    with open(os.path.join(a.data, 'links.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'{len(links)} of {len(terraces)} terraces linked', file=sys.stderr)


if __name__ == '__main__':
    main()
