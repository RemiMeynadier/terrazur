"""Sky horizons of every open café/bar terrace in Paris.

For each terrace (Ville de Paris open data), a few points at seated height are
placed on the terrace, and for every compass direction the elevation angle of
the highest obstacle is measured on the IGN LiDAR HD surface model (50 cm,
buildings and trees). The sun shines on a point when it is above that angle,
so the app only has to compare the sun's position with these profiles.

Two profiles per point: all obstacles, and buildings only (BD TOPO
footprints). Where they differ, the shade comes from trees.

Usage: python3 scripts/build_horizons.py OUT_DIR [--cache DIR] [--limit-cells N]
"""

import argparse
import base64
import concurrent.futures as cf
import datetime as dt
import hashlib
import json
import math
import os
import subprocess
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from lambert93 import from_l93, to_l93  # noqa: E402

TERRACES = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/terrasses-autorisations/exports/json'
WMS = 'https://data.geopf.fr/wms-r/wms'
WFS = 'https://data.geopf.fr/wfs/ows'
DSM_LAYER = 'IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93'
DTM_LAYER = 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93'

TILE = 500  # m, also the size of an output cell
RES = 0.5  # m, surface model resolution
REACH = 400  # m, farthest obstacle considered (a 30 m building at 4.3° elevation)
SEAT = 1.1  # m above ground: a seated person's shoulders

# Profiles cover the azimuths the sun can reach in Paris (sunrise ~50°, sunset ~310°).
AZ0, NAZ = 45, 271  # 45°…315°, 1° steps
ANGLE_STEP = 0.3  # degrees per unit in the uint8 encoding (0…76.5°)

# Ray steps: fine near the terrace, coarser (on max-pooled grids) further out.
STEPS = [(0.5, 40, 0.5, 1), (40, 120, 1.0, 2), (120, REACH, 2.0, 4)]  # start, end, step, pooling

OPEN_TYPES = ('TERRASSE', 'CONTRE TERRASSE', 'CONTRE-TERRASSE')
CLOSED = ('FERMÉ', 'ÉTALAGE', 'ETALAGE')


def curl(url, binary=False, tries=4):
    for attempt in range(tries):
        r = subprocess.run(['curl', '-sf', '--compressed', '--max-time', '120', url], capture_output=True)
        if r.returncode == 0 and r.stdout:
            return r.stdout if binary else r.stdout.decode()
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'download failed: {url}')


# --- Terraces -----------------------------------------------------------------

def load_terraces():
    rows = json.loads(curl(TERRACES))
    out = []
    for r in rows:
        typ = (r.get('typologie') or '').upper()
        if not typ.startswith(OPEN_TYPES) or any(c in typ for c in CLOSED):
            continue
        g = (r.get('geo_shape') or {}).get('geometry') or {}
        if g.get('type') != 'Point':
            continue
        lon, lat = g['coordinates']
        x, y = to_l93(lon, lat)
        out.append({
            'name': (r.get('nom_enseigne') or r.get('nom_societe') or '').strip(),
            'addr': (r.get('adresse') or '').strip(),
            'arr': r.get('arrondissement'),
            'typ': typ,
            'L': float(r.get('longueur') or 0) or 3.0,
            'W': float(r.get('largeur') or 0) or 1.0,
            'x': x,
            'y': y,
        })
    return out


# --- IGN data, one 500 m tile at a time ---------------------------------------

def tile_bbox(ix, iy):
    return ix * TILE, iy * TILE, (ix + 1) * TILE, (iy + 1) * TILE


def wms_grid(layer, ix, iy, res):
    x0, y0, x1, y1 = tile_bbox(ix, iy)
    n = int(TILE / res)
    url = (f'{WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS={layer}&STYLES=&CRS=EPSG:2154'
           f'&BBOX={x0},{y0},{x1},{y1}&WIDTH={n}&HEIGHT={n}&FORMAT=image/x-bil;bits=32')
    a = np.frombuffer(curl(url, binary=True), '<f4').reshape(n, n).copy()
    a[a < -1000] = np.nan
    return a  # row 0 = north


def buildings(ix, iy):
    x0, y0, x1, y1 = tile_bbox(ix, iy)
    polys, start = [], 0
    while True:
        url = (f'{WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment'
               f'&OUTPUTFORMAT=application/json&SRSNAME=EPSG:2154&COUNT=5000&STARTINDEX={start}'
               f'&BBOX={x0},{y0},{x1},{y1},urn:ogc:def:crs:EPSG::2154')
        feats = json.loads(curl(url))['features']
        for f in feats:
            g = f['geometry']
            for poly in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]):
                polys.append([[(p[0], p[1]) for p in ring] for ring in poly])
        if len(feats) < 5000:
            return polys
        start += 5000


def fetch_tile(cache, ix, iy):
    path = os.path.join(cache, f'{ix}_{iy}.npz')
    if os.path.exists(path):
        return path
    dsm = wms_grid(DSM_LAYER, ix, iy, RES)
    dtm = wms_grid(DTM_LAYER, ix, iy, 1.0)
    polys = buildings(ix, iy)
    np.savez_compressed(path, dsm=(np.nan_to_num(dsm, nan=0) * 20).astype(np.uint16), dtm=dtm.astype(np.float32),
                        polys=np.array(json.dumps(polys)))
    return path


# --- Mosaic around a cell -----------------------------------------------------

class Mosaic:
    """Surface model, ground model and building mask over a cell and its 8 neighbours."""

    def __init__(self, cache, ix, iy):
        n = int(TILE / RES)
        self.x0, self.y1 = (ix - 1) * TILE, (iy + 2) * TILE  # top-left corner
        self.dsm = np.zeros((3 * n, 3 * n), np.float32)
        self.dtm = np.full((3 * TILE, 3 * TILE), np.nan, np.float32)
        self.polys = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                path = os.path.join(cache, f'{ix + dx}_{iy + dy}.npz')
                if not os.path.exists(path):
                    continue
                z = np.load(path)
                r, c = (1 - dy) * n, (dx + 1) * n
                self.dsm[r:r + n, c:c + n] = z['dsm'] / 20.0
                r1, c1 = (1 - dy) * TILE, (dx + 1) * TILE
                self.dtm[r1:r1 + TILE, c1:c1 + TILE] = z['dtm']
                self.polys += json.loads(str(z['polys']))
        # Building mask at 50 cm, grown by 1 m: footprints and LiDAR differ by up to ~1 m.
        img = Image.new('L', (3 * n, 3 * n), 0)
        draw = ImageDraw.Draw(img)
        for poly in self.polys:
            draw.polygon([self.pix(x, y)[::-1] for x, y in poly[0]], fill=1)
            for hole in poly[1:]:
                draw.polygon([self.pix(x, y)[::-1] for x, y in hole], fill=0)
        self.mask = np.array(img, bool)
        self.bldg = pool(self.mask[None], 1, grow=2)[0]
        segs = [(a[0], a[1], b[0], b[1]) for poly in self.polys for ring in poly for a, b in zip(ring, ring[1:])]
        self.segs = np.array(segs, np.float64).reshape(-1, 4)
        # Max-pooled pyramids for the far field, so thin tall features are not skipped.
        self.levels = {1: (self.dsm, self.bldg)}
        for k in (2, 4):
            self.levels[k] = (pool(self.dsm[None], k)[0], pool(self.bldg[None], k)[0])

    def pix(self, x, y, res=RES):
        return (self.y1 - y) / res, (x - self.x0) / res  # row, col (float)

    def ground(self, x, y):
        r, c = self.pix(x, y, 1.0)
        r0, c0 = int(math.floor(r - 0.5)), int(math.floor(c - 0.5))
        fr, fc = r - 0.5 - r0, c - 0.5 - c0
        g = self.dtm[r0:r0 + 2, c0:c0 + 2]
        if g.shape != (2, 2) or np.isnan(g).any():
            v = self.dtm[int(r), int(c)]
            return float(v) if not np.isnan(v) else None
        return float(g[0, 0] * (1 - fr) * (1 - fc) + g[0, 1] * (1 - fr) * fc + g[1, 0] * fr * (1 - fc) + g[1, 1] * fr * fc)


def pool(a, k, grow=0):
    """Max-pool by k (k=1: none); `grow` dilates by that many pixels first."""
    if grow:
        out = a.copy()
        for dy in range(-grow, grow + 1):
            for dx in range(-grow, grow + 1):
                out |= np.roll(np.roll(a, dy, 1), dx, 2)
        a = out
    if k == 1:
        return a
    b, h, w = a.shape
    return a[:, :h // k * k, :w // k * k].reshape(b, h // k, k, w // k, k).max(axis=(2, 4))


# --- Terrace geometry ---------------------------------------------------------

def inside(m, x, y):
    r, c = m.pix(x, y)
    r, c = int(r), int(c)
    return 0 <= r < m.mask.shape[0] and 0 <= c < m.mask.shape[1] and bool(m.mask[r, c])


def facade(m, x, y):
    """Nearest building edge: (distance, unit direction along it, foot point)."""
    s = m.segs
    if not len(s):
        return 1e9, (1.0, 0.0), (x, y)
    dx, dy = s[:, 2] - s[:, 0], s[:, 3] - s[:, 1]
    L2 = np.maximum(dx * dx + dy * dy, 1e-9)
    t = np.clip(((x - s[:, 0]) * dx + (y - s[:, 1]) * dy) / L2, 0, 1)
    fx, fy = s[:, 0] + t * dx, s[:, 1] + t * dy
    d = np.hypot(x - fx, y - fy)
    d[L2 < 0.25] = np.inf  # ignore tiny edges, their direction is noise
    i = int(np.argmin(d))
    L = math.sqrt(L2[i])
    return float(d[i]), (dx[i] / L, dy[i] / L), (fx[i], fy[i])


def place(t, m):
    """Terrace rectangle: centre, axis along the facade, normal pointing away from it."""
    d, (ux, uy), (fx, fy) = facade(m, t['x'], t['y'])
    if d > 25:  # no facade nearby (square, park): keep the point, east-west axis
        return t['x'], t['y'], (1.0, 0.0), (0.0, 1.0)
    nx, ny = -uy, ux
    # Normal pointing to the street side: the side that is not inside a building.
    if inside(m, fx + nx * 0.6, fy + ny * 0.6):
        nx, ny = -nx, -ny
    cx, cy = t['x'], t['y']
    if inside(m, cx, cy):  # footprints are ±1–3 m: put it back on the pavement
        cx, cy = fx + nx * (t['W'] / 2 + 0.2), fy + ny * (t['W'] / 2 + 0.2)
    return cx, cy, (ux, uy), (nx, ny)


# --- Horizons -----------------------------------------------------------------

AZ = np.radians(np.arange(AZ0, AZ0 + NAZ))
SIN, COS = np.sin(AZ), np.cos(AZ)


def horizons(m, pts, rects):
    """pts: (P, 3) x, y, z0. rects: (P, 6) cx, cy, ux, uy, half-length, half-width (own terrace, ignored).
    Returns two (P, NAZ) arrays of elevation angles in degrees: all obstacles, buildings only."""
    P = len(pts)
    h_all = np.zeros((P, NAZ), np.float32)
    h_bld = np.zeros((P, NAZ), np.float32)
    for start, end, step, k in STEPS:
        dsm, bldg = m.levels[k]
        res = RES * k
        d = np.arange(start, end, step, dtype=np.float32)
        X = pts[:, 0, None, None] + d[None, None, :] * SIN[None, :, None]
        Y = pts[:, 1, None, None] + d[None, None, :] * COS[None, :, None]
        r = ((m.y1 - Y) / res).astype(np.int32)
        c = ((X - m.x0) / res).astype(np.int32)
        ok = (r >= 0) & (r < dsm.shape[0]) & (c >= 0) & (c < dsm.shape[1])
        r, c = np.clip(r, 0, dsm.shape[0] - 1), np.clip(c, 0, dsm.shape[1] - 1)
        z = dsm[r, c]
        ang = np.degrees(np.arctan2(z - pts[:, 2, None, None], d[None, None, :]))
        # The terrace itself (umbrellas, awnings at survey time) is not an obstacle.
        lu = (X - rects[:, 0, None, None]) * rects[:, 2, None, None] + (Y - rects[:, 1, None, None]) * rects[:, 3, None, None]
        lv = -(X - rects[:, 0, None, None]) * rects[:, 3, None, None] + (Y - rects[:, 1, None, None]) * rects[:, 2, None, None]
        own = (np.abs(lu) <= rects[:, 4, None, None] + 0.3) & (np.abs(lv) <= rects[:, 5, None, None] + 0.3)
        ang = np.where(ok & ~own, ang, -90)
        h_all = np.maximum(h_all, ang.max(axis=2))
        h_bld = np.maximum(h_bld, np.where(bldg[r, c], ang, -90).max(axis=2))
    return h_all, h_bld


def encode(h):
    return base64.b64encode(np.clip(np.round(h / ANGLE_STEP), 0, 255).astype(np.uint8).tobytes()).decode()


def process_cell(cache, out_dir, key, items):
    ix, iy = key
    m = Mosaic(cache, ix, iy)
    pts, rects, owners = [], [], []
    for t in items:
        cx, cy, (ux, uy), (nx, ny) = place(t, m)
        g = m.ground(cx, cy)
        if g is None:
            continue
        hl, hw = t['L'] / 2, t['W'] / 2
        t['geom'] = (cx, cy, ux, uy, hl, hw)
        t['ground'] = g
        # Three points along the terrace's centre line.
        for f in (-2 / 3, 0, 2 / 3):
            pts.append((cx + ux * hl * f, cy + uy * hl * f, g + SEAT))
            rects.append((cx, cy, ux, uy, hl, hw))
            owners.append(t)
    if not pts:
        return None
    pts, rects = np.array(pts, np.float32), np.array(rects, np.float32)
    h_all = np.zeros((len(pts), NAZ), np.float32)
    h_bld = np.zeros((len(pts), NAZ), np.float32)
    for i in range(0, len(pts), 24):
        h_all[i:i + 24], h_bld[i:i + 24] = horizons(m, pts[i:i + 24], rects[i:i + 24])

    terraces = []
    for j in range(0, len(owners), 3):
        t = owners[j]
        cx, cy, ux, uy, hl, hw = t['geom']
        lon, lat = from_l93(cx, cy)
        # Facade direction as a compass bearing of the street-side normal, for drawing.
        terraces.append({
            'id': t['id'], 'name': t['name'], 'addr': t['addr'], 'arr': t['arr'], 'typ': t['typ'],
            'lat': round(lat, 7), 'lon': round(lon, 7), 'L': t['L'], 'W': t['W'],
            'axis': round(math.degrees(math.atan2(ux, uy)) % 180, 1),
            'z': round(t['ground'], 2),
            'h': encode(h_all[j:j + 3]), 'hb': encode(h_bld[j:j + 3]),
        })
    with open(os.path.join(out_dir, 'cells', f'{ix}_{iy}.json'), 'w') as f:
        json.dump({'cell': [ix, iy], 'terraces': terraces}, f, ensure_ascii=False, separators=(',', ':'))
    return len(terraces)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--cache', default='cache')
    ap.add_argument('--limit-cells', type=int, default=0)
    ap.add_argument('--near', help='lon,lat: only cells within 1 km (for testing)')
    a = ap.parse_args()
    os.makedirs(os.path.join(a.out, 'cells'), exist_ok=True)
    os.makedirs(a.cache, exist_ok=True)

    terraces = load_terraces()
    # Stable ids (shared links survive a rebuild): a hash of what identifies the terrace.
    seen = set()
    for t in terraces:
        key = f"{t['name']}|{t['addr']}|{t['typ']}|{t['x']:.1f}|{t['y']:.1f}|{t['L']}|{t['W']}"
        n = 0
        while True:
            t['id'] = int(hashlib.sha1(f'{key}|{n}'.encode()).hexdigest()[:12], 16)
            if t['id'] not in seen:
                break
            n += 1
        seen.add(t['id'])
    cells = {}
    for t in terraces:
        cells.setdefault((int(t['x'] // TILE), int(t['y'] // TILE)), []).append(t)
    keys = sorted(cells)
    if a.near:
        lon, lat = map(float, a.near.split(','))
        x, y = to_l93(lon, lat)
        keys = [k for k in keys if math.hypot((k[0] + 0.5) * TILE - x, (k[1] + 0.5) * TILE - y) < 1000]
    if a.limit_cells:
        keys = keys[:a.limit_cells]
    tiles = sorted({(ix + dx, iy + dy) for ix, iy in keys for dx in (-1, 0, 1) for dy in (-1, 0, 1)})
    print(f'{len(terraces)} open terraces, {len(keys)} cells, {len(tiles)} tiles to fetch', flush=True)

    with cf.ThreadPoolExecutor(6) as ex:
        for n, _ in enumerate(ex.map(lambda k: fetch_tile(a.cache, *k), tiles), 1):
            if n % 20 == 0:
                print(f'  tiles {n}/{len(tiles)}', flush=True)

    index, done = [], 0
    for n, key in enumerate(keys, 1):
        count = process_cell(a.cache, a.out, key, cells[key])
        if count:
            done += count
        if n % 20 == 0:
            print(f'  cells {n}/{len(keys)}', flush=True)
    for key in keys:
        path = os.path.join(a.out, 'cells', f'{key[0]}_{key[1]}.json')
        if os.path.exists(path):
            for t in json.load(open(path))['terraces']:
                index.append([t['id'], t['name'], t['lat'], t['lon'], f'{key[0]}_{key[1]}'])
    meta = {
        'generated': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'tile': TILE, 'az0': AZ0, 'naz': NAZ, 'angleStep': ANGLE_STEP, 'points': 3, 'seat': SEAT,
        'terraces': index,
    }
    with open(os.path.join(a.out, 'index.json'), 'w') as f:
        json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{done} terraces written', flush=True)


if __name__ == '__main__':
    main()
