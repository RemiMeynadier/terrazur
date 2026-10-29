"""WGS84 / RGF93 longitude-latitude <-> Lambert-93 (EPSG:2154), IGN formulas (ALG0001-0004).

RGF93 and WGS84 differ by a few centimetres, below the precision of the data used here.
"""
import math

E = 0.0818191910428158  # GRS80 eccentricity
A = 6378137.0
LON0 = math.radians(3.0)
PHI1, PHI2, PHI0 = math.radians(44.0), math.radians(49.0), math.radians(46.5)
X0, Y0 = 700000.0, 6600000.0


def _iso_lat(phi):
    s = math.sin(phi)
    return math.log(math.tan(math.pi / 4 + phi / 2) * ((1 - E * s) / (1 + E * s)) ** (E / 2))


def _n(phi):
    return A / math.sqrt(1 - (E * math.sin(phi)) ** 2)


_N = (math.log(_n(PHI2) * math.cos(PHI2) / (_n(PHI1) * math.cos(PHI1)))) / (_iso_lat(PHI1) - _iso_lat(PHI2))
_C = _n(PHI1) * math.cos(PHI1) / _N * math.exp(_N * _iso_lat(PHI1))
_YS = Y0 + _C * math.exp(-_N * _iso_lat(PHI0))


def to_l93(lon, lat):
    L = _iso_lat(math.radians(lat))
    r = _C * math.exp(-_N * L)
    g = _N * (math.radians(lon) - LON0)
    return X0 + r * math.sin(g), _YS - r * math.cos(g)


def from_l93(x, y):
    dx, dy = x - X0, y - _YS
    r = math.hypot(dx, dy)
    g = math.atan2(dx, -dy)
    lon = LON0 + g / _N
    L = -math.log(abs(r / _C)) / _N
    phi = 2 * math.atan(math.exp(L)) - math.pi / 2
    for _ in range(12):
        s = math.sin(phi)
        phi = 2 * math.atan(((1 + E * s) / (1 - E * s)) ** (E / 2) * math.exp(L)) - math.pi / 2
    return math.degrees(lon), math.degrees(phi)
