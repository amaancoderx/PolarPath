"""Geodesy and grid helpers.

The analysis grid is a plain latitude/longitude lattice. Everything that needs
to reason about real distances (routing, drift, resistance) goes through the
haversine helpers here so that the metre is the only length unit in the models.
"""
from __future__ import annotations

import numpy as np

from .config import GRID, GridSpec

EARTH_RADIUS_M = 6_371_008.8


def axes(grid: GridSpec = GRID) -> tuple[np.ndarray, np.ndarray]:
    """Return the (latitude, longitude) axis vectors of the analysis grid."""
    lats = np.linspace(grid.lat_min, grid.lat_max, grid.n_lat)
    lons = grid.lon_min + np.arange(grid.n_lon) * grid.lon_step
    return lats, lons


def mesh(grid: GridSpec = GRID) -> tuple[np.ndarray, np.ndarray]:
    """Return 2-D latitude/longitude arrays shaped (n_lat, n_lon)."""
    lats, lons = axes(grid)
    return np.meshgrid(lats, lons, indexing="ij")


def wrap_lon(lon: np.ndarray | float) -> np.ndarray | float:
    """Fold longitude onto the [-180, 180) interval."""
    return (np.asarray(lon) + 180.0) % 360.0 - 180.0


def haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres between two positions in degrees."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = p2 - p1
    dlam = np.radians(wrap_lon(np.asarray(lon2, dtype=float) - np.asarray(lon1, dtype=float)))
    a = np.sin(dphi / 2.0) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlam / 2.0) ** 2
    return 2.0 * EARTH_RADIUS_M * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def initial_bearing_deg(lat1, lon1, lat2, lon2):
    """Initial great-circle bearing, degrees clockwise from true north."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dlam = np.radians(wrap_lon(np.asarray(lon2, dtype=float) - np.asarray(lon1, dtype=float)))
    y = np.sin(dlam) * np.cos(p2)
    x = np.cos(p1) * np.sin(p2) - np.sin(p1) * np.cos(p2) * np.cos(dlam)
    return (np.degrees(np.arctan2(y, x)) + 360.0) % 360.0


def great_circle_points(lat1, lon1, lat2, lon2, n: int = 64):
    """Sample ``n`` points along the great circle joining two positions."""
    p1, l1 = np.radians(lat1), np.radians(lon1)
    p2, l2 = np.radians(lat2), np.radians(lon2)
    d = haversine_m(lat1, lon1, lat2, lon2) / EARTH_RADIUS_M
    if d < 1e-9:
        return np.array([[lat1, lon1]])
    f = np.linspace(0.0, 1.0, n)
    a = np.sin((1 - f) * d) / np.sin(d)
    b = np.sin(f * d) / np.sin(d)
    x = a * np.cos(p1) * np.cos(l1) + b * np.cos(p2) * np.cos(l2)
    y = a * np.cos(p1) * np.sin(l1) + b * np.cos(p2) * np.sin(l2)
    z = a * np.sin(p1) + b * np.sin(p2)
    lat = np.degrees(np.arctan2(z, np.hypot(x, y)))
    lon = np.degrees(np.arctan2(y, x))
    return np.column_stack([lat, lon])


def coriolis_parameter(lat_deg: np.ndarray | float) -> np.ndarray | float:
    """Coriolis parameter f = 2 Omega sin(phi). Negative in the south."""
    omega = 7.2921159e-5
    return 2.0 * omega * np.sin(np.radians(lat_deg))


def cell_area_km2(grid: GridSpec = GRID) -> np.ndarray:
    """Area of every grid cell in square kilometres, shaped (n_lat, n_lon)."""
    lats, _ = axes(grid)
    dlat = np.radians(grid.lat_step)
    dlon = np.radians(grid.lon_step)
    band = (EARTH_RADIUS_M ** 2) * dlon * (
        np.sin(np.radians(lats + grid.lat_step / 2)) - np.sin(np.radians(lats - grid.lat_step / 2))
    )
    band = np.abs(band) / 1e6
    return np.repeat(band[:, None], grid.n_lon, axis=1)


def to_index(lat: float, lon: float, grid: GridSpec = GRID) -> tuple[int, int]:
    """Nearest grid indices for a position, clamped to the domain."""
    i = int(round((lat - grid.lat_min) / grid.lat_step))
    j = int(round((wrap_lon(lon) - grid.lon_min) / grid.lon_step)) % grid.n_lon
    return int(np.clip(i, 0, grid.n_lat - 1)), j


def to_position(i: int, j: int, grid: GridSpec = GRID) -> tuple[float, float]:
    """Centre position of a grid cell."""
    return grid.lat_min + i * grid.lat_step, wrap_lon(grid.lon_min + j * grid.lon_step)


def bilinear(field: np.ndarray, lat, lon, grid: GridSpec = GRID):
    """Bilinear sample of a (n_lat, n_lon) field, cyclic in longitude."""
    lat = np.clip(np.asarray(lat, dtype=float), grid.lat_min, grid.lat_max)
    lon = wrap_lon(np.asarray(lon, dtype=float))
    fy = (lat - grid.lat_min) / grid.lat_step
    fx = (lon - grid.lon_min) / grid.lon_step
    i0 = np.clip(np.floor(fy).astype(int), 0, grid.n_lat - 1)
    i1 = np.clip(i0 + 1, 0, grid.n_lat - 1)
    j0 = np.floor(fx).astype(int) % grid.n_lon
    j1 = (j0 + 1) % grid.n_lon
    wy = fy - i0
    wx = fx - np.floor(fx)
    return (
        field[i0, j0] * (1 - wy) * (1 - wx)
        + field[i1, j0] * wy * (1 - wx)
        + field[i0, j1] * (1 - wy) * wx
        + field[i1, j1] * wy * wx
    )
