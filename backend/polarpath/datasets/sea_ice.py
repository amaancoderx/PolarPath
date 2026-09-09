"""Sea-ice archive: concentration, thickness and drift.

The archive plays the role of the NSIDC/NOAA passive-microwave record. Each
daily field is the sum of

  * a climatological ice edge, interpolated round the continent from published
    sector maxima and minima and modulated by an asymmetric seasonal cycle with
    slow autumn growth and rapid summer retreat, and
  * a synoptic anomaly that is advected by the free-drift ice velocity, damped
    towards zero on a one-week timescale and re-forced daily.

The anomaly is what makes forecasting a real problem: it has spatial structure,
propagates with the ice motion and decays, so a model that learns advection and
persistence of anomalies beats plain persistence, exactly as in the operational
literature. The whole sequence is deterministic given the seed, so metrics
quoted in the interface are reproducible.
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from functools import lru_cache

import numpy as np
from scipy import ndimage

from ..config import CACHE_DIR, GRID, RANDOM_SEED
from ..geo import EARTH_RADIUS_M, axes, mesh, wrap_lon
from .ocean_atlas import distance_to_coast_km, land_mask, ocean_mask
from .reanalysis import surface_current, wind_10m

# Sector ice-edge climatology: longitude, September maximum, February minimum.
# Latitudes in degrees, negative south. Values follow the NSIDC sea-ice index
# sector climatology for 1991-2020.
_EDGE_ANCHORS = np.array([
    [-180.0, -61.0, -74.0],
    [-150.0, -63.0, -75.0],
    [-120.0, -64.0, -72.0],
    [-90.0, -65.0, -71.0],
    [-70.0, -62.0, -69.0],
    [-60.0, -58.0, -66.0],
    [-45.0, -55.0, -68.0],
    [-20.0, -56.5, -70.0],
    [0.0, -57.5, -69.0],
    [30.0, -58.5, -68.0],
    [60.0, -58.5, -66.5],
    [90.0, -60.0, -66.0],
    [120.0, -61.5, -65.5],
    [150.0, -62.0, -66.0],
    [180.0, -61.0, -74.0],
])

# Coastal polynyas: longitude centre, longitude half-width, strength.
_POLYNYAS = [
    (175.0, 12.0, 0.55),    # Ross Sea polynya
    (-55.0, 10.0, 0.35),    # Ronne shelf
    (73.0, 8.0, 0.20),      # Prydz Bay / Cape Darnley
    (145.0, 6.0, 0.35),     # Mertz Glacier
    (-30.0, 9.0, 0.25),     # Maud Rise
]

# Marginal ice zone width. The observed Antarctic transition from the 15 percent
# contour to consolidated pack runs 100 to 200 km, so the profile has to be
# sharp; a wide transition flattens the whole cost gradient the router works on.
MIZ_WIDTH_DEG = 1.15
# Offset that places the 15 percent concentration contour exactly on the
# climatological edge latitude rather than several degrees north of it.
EDGE_OFFSET = 1.42
DAMPING = 0.87
# Anomaly forcing. With the damping above this settles to a standard deviation
# near 0.20 in the marginal ice zone, which is the observed day-to-day spread
# of Antarctic concentration and is what gives the pack its tongues and
# openings. A quieter field would make the router's choices artificially easy.
FORCING_SIGMA = 0.100
SPIN_UP_DAYS = 120
ARCHIVE_DAYS = 260


def seasonal_index(d: date) -> float:
    """Sea-ice season clock: 0 at the February minimum, 1 at the September maximum."""
    doy = d.timetuple().tm_yday
    if 50 <= doy <= 262:
        t = (doy - 50) / 212.0
        return 0.5 - 0.5 * math.cos(math.pi * t)
    shifted = doy if doy > 262 else doy + 365
    t = (shifted - 262) / 153.0
    return 0.5 + 0.5 * math.cos(math.pi * min(t, 1.0))


@lru_cache(maxsize=1)
def _edge_profiles() -> tuple[np.ndarray, np.ndarray]:
    """Maximum and minimum ice-edge latitude on the model longitude axis."""
    _, lons = axes()
    anchors = _EDGE_ANCHORS
    x = np.concatenate([anchors[:, 0] - 360.0, anchors[:, 0], anchors[:, 0] + 360.0])
    hi = np.concatenate([anchors[:, 1]] * 3)
    lo = np.concatenate([anchors[:, 2]] * 3)
    edge_max = np.interp(lons, x, hi)
    edge_min = np.interp(lons, x, lo)
    # Light circular smoothing removes the kinks between anchors.
    kernel = np.ones(9) / 9.0
    tile = lambda a: np.convolve(np.concatenate([a, a, a]), kernel, mode="same")[len(a):2 * len(a)]
    return tile(edge_max).astype(np.float32), tile(edge_min).astype(np.float32)


def ice_edge_latitude(d: date) -> np.ndarray:
    """Climatological ice-edge latitude for each longitude on the given day."""
    edge_max, edge_min = _edge_profiles()
    s = seasonal_index(d)
    return edge_min + s * (edge_max - edge_min)


@lru_cache(maxsize=16)
def climatology(d: date) -> np.ndarray:
    """Climatological sea-ice concentration field for the given calendar day."""
    lat2d, lon2d = mesh()
    edge = ice_edge_latitude(d)[None, :]
    s = seasonal_index(d)

    poleward = edge - lat2d                       # positive inside the pack
    profile = 1.0 / (1.0 + np.exp(-(poleward / MIZ_WIDTH_DEG - EDGE_OFFSET)))
    ceiling = (0.74 + 0.22 * (1.0 - np.exp(-np.maximum(poleward, 0.0) / 4.0)))
    ceiling = ceiling * (0.86 + 0.14 * s)
    field = ceiling * profile

    dist = distance_to_coast_km()
    for lon0, half, strength in _POLYNYAS:
        near_coast = np.exp(-(dist / 170.0) ** 2)
        sector = np.exp(-(wrap_lon(lon2d - lon0) / half) ** 2)
        field = field - strength * (0.45 + 0.55 * s) * near_coast * sector

    field = np.clip(field, 0.0, 1.0)
    field[land_mask()] = 0.0
    return field.astype(np.float32)


def marginal_zone_weight(d: date) -> np.ndarray:
    """Weight that concentrates anomaly variance in the marginal ice zone.

    The floor matters: consolidated pack is not uniform either. Leads, ridging
    and coastal polynyas keep a real spread of concentration well inside the ice
    edge, and that heterogeneity is exactly what a router can exploit.
    """
    lat2d, _ = mesh()
    edge = ice_edge_latitude(d)[None, :]
    p = 1.0 / (1.0 + np.exp(-((edge - lat2d) / (MIZ_WIDTH_DEG * 2.6) - EDGE_OFFSET)))
    inside = 1.0 / (1.0 + np.exp(-((edge - lat2d) / MIZ_WIDTH_DEG - EDGE_OFFSET)))
    return (inside * (0.30 + 0.70 * 4.0 * p * (1.0 - p))).astype(np.float32)


def drift_velocity(d: date) -> tuple[np.ndarray, np.ndarray]:
    """Free-drift sea-ice velocity in m/s.

    Ice moves at roughly 2 percent of the 10 m wind, deflected to the left of
    the wind in the southern hemisphere, plus most of the surface current.
    """
    uw, vw = wind_10m(d)
    uo, vo = surface_current(d)
    theta = math.radians(-18.0)
    ct, st = math.cos(theta), math.sin(theta)
    u = 0.021 * (uw * ct - vw * st) + 0.85 * uo
    v = 0.021 * (uw * st + vw * ct) + 0.85 * vo
    return u.astype(np.float32), v.astype(np.float32)


@lru_cache(maxsize=1)
def _cell_size_m() -> tuple[np.ndarray, float]:
    lat2d, _ = mesh()
    dx = EARTH_RADIUS_M * np.cos(np.radians(lat2d)) * math.radians(GRID.lon_step)
    dy = EARTH_RADIUS_M * math.radians(GRID.lat_step)
    return np.maximum(dx, 1.0).astype(np.float32), float(dy)


def advect(field: np.ndarray, u: np.ndarray, v: np.ndarray, dt_s: float) -> np.ndarray:
    """Semi-Lagrangian advection, cyclic in longitude and clamped in latitude."""
    dx, dy = _cell_size_m()
    n_lat, n_lon = field.shape
    ii, jj = np.meshgrid(np.arange(n_lat), np.arange(n_lon), indexing="ij")
    src_i = ii - (v * dt_s) / dy
    src_j = jj - (u * dt_s) / dx
    src_i = np.clip(src_i, 0, n_lat - 1)
    src_j = np.mod(src_j, n_lon)
    return ndimage.map_coordinates(
        field, [src_i, src_j], order=1, mode="grid-wrap"
    ).astype(np.float32)


def _forcing(day_index: int) -> np.ndarray:
    """Spatially correlated daily anomaly forcing, deterministic in the day index."""
    rng = np.random.default_rng(RANDOM_SEED + 7919 * day_index)
    noise = rng.standard_normal((GRID.n_lat, GRID.n_lon))
    tiled = np.concatenate([noise, noise, noise], axis=1)
    smooth = ndimage.gaussian_filter(tiled, sigma=(2.6, 3.4), mode="nearest")
    smooth = smooth[:, GRID.n_lon : 2 * GRID.n_lon]
    smooth = smooth / (smooth.std() + 1e-9)
    return smooth.astype(np.float32)


class SeaIceArchive:
    """Daily sea-ice history ending on ``end_date``."""

    def __init__(self, end_date: date, days: int = ARCHIVE_DAYS):
        self.end_date = end_date
        self.days = days
        self.start_date = end_date - timedelta(days=days - 1)
        self._anomaly = self._build()

    # ------------------------------------------------------------------ build

    def _cache_path(self):
        return CACHE_DIR / f"seaice_{self.end_date.isoformat()}_{self.days}_{RANDOM_SEED}.npz"

    def _build(self) -> np.ndarray:
        path = self._cache_path()
        if path.exists():
            with np.load(path) as z:
                return z["anomaly"]

        spin_start = self.start_date - timedelta(days=SPIN_UP_DAYS)
        total = SPIN_UP_DAYS + self.days
        state = np.zeros((GRID.n_lat, GRID.n_lon), dtype=np.float32)
        out = np.zeros((self.days, GRID.n_lat, GRID.n_lon), dtype=np.float32)
        ocean = ocean_mask()

        for k in range(total):
            d = spin_start + timedelta(days=k)
            u, v = drift_velocity(d)
            state = advect(state, u, v, 86400.0)
            state = DAMPING * state + FORCING_SIGMA * _forcing((d - date(2000, 1, 1)).days)
            state = np.clip(state, -0.55, 0.55)
            state[~ocean] = 0.0
            if k >= SPIN_UP_DAYS:
                out[k - SPIN_UP_DAYS] = state

        np.savez_compressed(path, anomaly=out.astype(np.float16))
        return out

    # ------------------------------------------------------------------- read

    def index_of(self, d: date) -> int:
        idx = (d - self.start_date).days
        if not 0 <= idx < self.days:
            raise KeyError(f"{d} is outside the archive {self.start_date}..{self.end_date}")
        return idx

    def covers(self, d: date) -> bool:
        return 0 <= (d - self.start_date).days < self.days

    def anomaly(self, d: date) -> np.ndarray:
        return self._anomaly[self.index_of(d)].astype(np.float32)

    @lru_cache(maxsize=12)
    def concentration(self, d: date) -> np.ndarray:
        """Observed sea-ice concentration on ``d``, values in [0, 1]."""
        field = climatology(d) + self.anomaly(d) * marginal_zone_weight(d)
        field = np.clip(field, 0.0, 1.0)
        field[land_mask()] = 0.0
        return field.astype(np.float32)

    def thickness(self, d: date, sic: np.ndarray | None = None) -> np.ndarray:
        """Sea-ice thickness in metres, derived from position inside the pack."""
        if sic is None:
            sic = self.concentration(d)
        lat2d, lon2d = mesh()
        edge = ice_edge_latitude(d)[None, :]
        poleward = np.maximum(edge - lat2d, 0.0)
        s = seasonal_index(d)
        base = 0.18 + 1.05 * (1.0 - np.exp(-poleward / 7.0))
        base = base * (0.62 + 0.38 * s)
        # Deformation piles ice against the western Weddell and the coast.
        dist = distance_to_coast_km()
        ridging = 1.0 + 0.85 * np.exp(-(dist / 260.0) ** 2)
        ridging = ridging * (1.0 + 0.55 * np.exp(-(wrap_lon(lon2d + 52.0) / 18.0) ** 2))
        h = base * ridging * np.sqrt(np.clip(sic, 0.0, 1.0))
        h[sic < 0.05] = 0.0
        return np.clip(h, 0.0, 3.5).astype(np.float32)

    def extent_km2(self, d: date) -> float:
        """Sea-ice extent, the area of cells at or above 15 percent concentration."""
        from ..geo import cell_area_km2

        return float((cell_area_km2() * (self.concentration(d) >= 0.15)).sum())


@lru_cache(maxsize=4)
def get_archive(end_date: date, days: int = ARCHIVE_DAYS) -> SeaIceArchive:
    return SeaIceArchive(end_date, days)
