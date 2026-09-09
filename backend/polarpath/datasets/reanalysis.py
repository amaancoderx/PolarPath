"""Atmospheric and oceanic forcing for the Southern Ocean domain.

The shape of every product here matches the operational feed the production
system consumes (ERA5 10 m winds and 2 m temperature, CMEMS surface currents).
For the prototype they are reconstructed analytically from published first-order
structure, which keeps the archive deterministic, offline and reproducible:

  * a zonal mean-sea-level-pressure profile with the subtropical ridge near 32 S
    and the circumpolar trough near 65 S,
  * a train of eastward propagating synoptic lows plus the quasi-stationary
    Amundsen Sea Low,
  * winds from geostrophic balance with a boundary-layer turning angle applied,
  * a non-divergent surface current derived from a streamfunction combining the
    Antarctic Circumpolar Current, the coastal easterly-driven current, the
    Weddell and Ross gyres and a mesoscale eddy field.

Every field is a pure function of the calendar day, so hindcasts, forecasts and
the browser view stay perfectly consistent.
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from functools import lru_cache

import numpy as np
from scipy import ndimage

from ..config import GRID, RANDOM_SEED
from ..geo import EARTH_RADIUS_M, coriolis_parameter, mesh, wrap_lon
from .ocean_atlas import distance_to_coast_km, land_mask

RHO_AIR = 1.29
EPOCH = date(2024, 1, 1)


def day_number(d: date) -> int:
    return (d - EPOCH).days


def _doy_phase(d: date) -> float:
    """Fraction of the year elapsed, expressed as an angle in radians."""
    return 2.0 * math.pi * (d.timetuple().tm_yday - 1) / 365.25


@lru_cache(maxsize=1)
def _geometry() -> dict:
    lat2d, lon2d = mesh()
    dy = EARTH_RADIUS_M * math.radians(GRID.lat_step)
    dx = EARTH_RADIUS_M * np.cos(np.radians(lat2d)) * math.radians(GRID.lon_step)
    dx = np.maximum(dx, 1.0)
    f = coriolis_parameter(lat2d)
    f = np.where(np.abs(f) < 2e-5, -2e-5, f)
    return {"lat": lat2d, "lon": lon2d, "dx": dx, "dy": dy, "f": f}


def _cyclic_gradient(field: np.ndarray, dx: np.ndarray, dy: float):
    """Gradient of a field that wraps in longitude and is closed in latitude."""
    gx = (np.roll(field, -1, axis=1) - np.roll(field, 1, axis=1)) / (2.0 * dx)
    gy = np.empty_like(field)
    gy[1:-1] = (field[2:] - field[:-2]) / (2.0 * dy)
    gy[0] = (field[1] - field[0]) / dy
    gy[-1] = (field[-1] - field[-2]) / dy
    return gx, gy


@lru_cache(maxsize=1)
def _low_pressure_track() -> np.ndarray:
    """Seed longitude, latitude, depth, radius and drift of the synoptic lows."""
    rng = np.random.default_rng(RANDOM_SEED)
    n = 7
    return np.column_stack([
        rng.uniform(-180, 180, n),
        rng.uniform(-64, -52, n),
        rng.uniform(1500, 3400, n),
        rng.uniform(7.0, 13.0, n),
        rng.uniform(15.0, 23.0, n),
        rng.uniform(0, 2 * math.pi, n),
    ])


@lru_cache(maxsize=16)
def mslp(d: date) -> np.ndarray:
    """Mean sea-level pressure in pascals."""
    g = _geometry()
    lat, lon = g["lat"], g["lon"]
    season = math.cos(_doy_phase(d) - math.radians(200))

    ridge = 101800.0 - 700.0 * np.exp(-((lat + 31.0) / 9.0) ** 2)
    trough = -2600.0 * np.exp(-((lat + 65.0) / 9.5) ** 2) * (1.0 + 0.16 * season)
    plateau = 900.0 * np.exp(-((lat + 88.0) / 12.0) ** 2)
    field = ridge + trough + plateau

    asl_lon, asl_lat = -118.0, -69.0
    asl = -(1500.0 + 700.0 * season) * np.exp(
        -((wrap_lon(lon - asl_lon) / 22.0) ** 2 + ((lat - asl_lat) / 8.5) ** 2)
    )
    field = field + asl

    n = day_number(d)
    for lon0, lat0, depth, radius, drift, phase in _low_pressure_track():
        centre_lon = wrap_lon(lon0 + drift * n)
        centre_lat = lat0 + 3.2 * math.sin(0.21 * n + phase)
        dlon = wrap_lon(lon - centre_lon) * np.cos(np.radians(lat))
        pulse = 0.65 + 0.35 * math.sin(0.17 * n + 2.0 * phase)
        field = field - depth * pulse * np.exp(
            -((dlon / (radius * 1.5)) ** 2 + ((lat - centre_lat) / radius) ** 2)
        )
    return field.astype(np.float32)


@lru_cache(maxsize=16)
def wind_10m(d: date) -> tuple[np.ndarray, np.ndarray]:
    """10 m wind components in m/s, u eastward and v northward."""
    g = _geometry()
    p = mslp(d).astype(np.float64)
    gx, gy = _cyclic_gradient(p, g["dx"], g["dy"])
    f = g["f"]
    ug = -gy / (RHO_AIR * f)
    vg = gx / (RHO_AIR * f)

    turn = math.radians(22.0)
    scale = 0.72
    u = scale * (ug * math.cos(turn) - vg * math.sin(turn))
    v = scale * (ug * math.sin(turn) + vg * math.cos(turn))

    speed = np.hypot(u, v)
    cap = 34.0
    over = speed > cap
    if over.any():
        u[over] *= cap / speed[over]
        v[over] *= cap / speed[over]
    return u.astype(np.float32), v.astype(np.float32)


@lru_cache(maxsize=1)
def _eddy_streamfunction() -> np.ndarray:
    """Static mesoscale eddy streamfunction in m^2/s."""
    rng = np.random.default_rng(RANDOM_SEED + 11)
    noise = rng.standard_normal((GRID.n_lat, GRID.n_lon))
    tiled = np.concatenate([noise, noise, noise], axis=1)
    smooth = ndimage.gaussian_filter(tiled, sigma=(2.2, 3.0), mode="nearest")
    smooth = smooth[:, GRID.n_lon : 2 * GRID.n_lon]
    smooth = smooth / np.abs(smooth).max()
    return (smooth * 5.0e4).astype(np.float32)


@lru_cache(maxsize=1)
def _current_streamfunction() -> np.ndarray:
    """Total surface streamfunction for the mean circulation, m^2/s."""
    g = _geometry()
    lat, lon = g["lat"], g["lon"]
    dist = distance_to_coast_km()

    # Streamfunction increases polewards across the fronts, which gives an
    # eastward transport for u = -d(psi)/dy in the southern hemisphere.
    acc = 4.5e5 / (1.0 + np.exp((lat + 55.0) / 3.4))
    acc = acc + 2.0e5 / (1.0 + np.exp((lat + 48.0) / 4.5))
    acc = acc * (1.0 + 0.45 * np.exp(-(wrap_lon(lon + 62.0) / 16.0) ** 2))

    # Coastal current runs westward, so the streamfunction falls away from land.
    coastal = -3.5e4 * np.exp(-(dist / 230.0) ** 2)

    def gyre(lon0, lat0, r_lon, r_lat, strength):
        dl = wrap_lon(lon - lon0) / r_lon
        dp = (lat - lat0) / r_lat
        return strength * np.exp(-(dl ** 2 + dp ** 2))

    gyres = gyre(-40.0, -65.0, 26.0, 6.5, 8.0e4) + gyre(-176.0, -68.0, 24.0, 6.0, 6.0e4)
    return (acc + coastal + gyres + _eddy_streamfunction()).astype(np.float32)


@lru_cache(maxsize=16)
def surface_current(d: date) -> tuple[np.ndarray, np.ndarray]:
    """Surface current components in m/s, non-divergent by construction."""
    g = _geometry()
    psi = _current_streamfunction().astype(np.float64)
    psi = psi * (1.0 + 0.08 * math.sin(_doy_phase(d) - 0.6))
    gx, gy = _cyclic_gradient(psi, g["dx"], g["dy"])
    u, v = -gy, gx
    speed = np.hypot(u, v)
    cap = 1.4
    over = speed > cap
    if over.any():
        u[over] *= cap / speed[over]
        v[over] *= cap / speed[over]
    land = land_mask()
    u[land] = 0.0
    v[land] = 0.0
    return u.astype(np.float32), v.astype(np.float32)


@lru_cache(maxsize=16)
def sea_surface_temperature(d: date) -> np.ndarray:
    """Sea surface temperature in degrees Celsius."""
    g = _geometry()
    lat, lon = g["lat"], g["lon"]
    season = math.cos(_doy_phase(d) - math.radians(35))

    base = 24.0 / (1.0 + np.exp(-(lat + 47.0) / 6.2)) - 1.9
    front = -2.4 / (1.0 + np.exp(-(lat + 58.0) / 2.4))
    # The seasonal swing collapses polewards, where the mixed layer stays at
    # the freezing point for most of the year.
    seasonal = (0.5 + 2.6 * np.exp(-((lat + 42.0) / 16.0) ** 2)) * season
    tongue = 0.9 * np.exp(-(wrap_lon(lon - 20.0) / 40.0) ** 2) * np.exp(-((lat + 40.0) / 8.0) ** 2)

    return np.maximum(base + front + seasonal + tongue, -1.86).astype(np.float32)


@lru_cache(maxsize=16)
def air_temperature_2m(d: date) -> np.ndarray:
    """2 m air temperature in degrees Celsius, the thermodynamic driver."""
    lat = _geometry()["lat"]
    season = math.cos(_doy_phase(d) - math.radians(30))
    sst = sea_surface_temperature(d)
    continental = -26.0 * np.exp(-((lat + 82.0) / 11.0) ** 2) * (1.0 - 0.45 * season)
    return (sst - 2.0 + continental + 3.4 * season).astype(np.float32)


def forcing_bundle(d: date) -> dict[str, np.ndarray]:
    """Every forcing field for one day."""
    u10, v10 = wind_10m(d)
    uo, vo = surface_current(d)
    return {
        "u10": u10,
        "v10": v10,
        "uo": uo,
        "vo": vo,
        "sst": sea_surface_temperature(d),
        "t2m": air_temperature_2m(d),
        "mslp": mslp(d),
    }


def window(d: date, days: int) -> list[date]:
    """The ``days`` calendar days ending on ``d`` inclusive."""
    return [d - timedelta(days=k) for k in range(days - 1, -1, -1)]
