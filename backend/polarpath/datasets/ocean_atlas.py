"""Static geography: coastline, land mask, distance to coast, depth proxy.

The coastline is Natural Earth 1:50m physical land clipped to the Southern Ocean
domain by ``scripts/prepare_coastline.py``. It is bundled with the package, so
the application runs with no network access.
"""
from __future__ import annotations

import json
from functools import lru_cache

import numpy as np

from ..config import ASSET_DIR, GRID
from ..geo import axes, mesh

_LAT_KM = 55.66   # one 0.5 deg latitude step, kilometres
_LON_KM = 55.5    # one 1.0 deg longitude step at 60 S, kilometres


@lru_cache(maxsize=1)
def coastline_rings() -> list[np.ndarray]:
    """Coastline rings as (n, 2) arrays of [longitude, latitude]."""
    raw = json.loads((ASSET_DIR / "southern_land.json").read_text(encoding="utf-8"))
    return [np.asarray(r, dtype=np.float32).reshape(-1, 2) for r in raw["rings"]]


@lru_cache(maxsize=1)
def coastline_payload() -> dict:
    """Raw ring payload, forwarded to the browser for map rendering."""
    return json.loads((ASSET_DIR / "southern_land.json").read_text(encoding="utf-8"))


def _static_path():
    """Precomputed geography, written by scripts/build_static.py.

    Deriving the land mask and the distance transform needs matplotlib and
    SciPy. Both are build-time dependencies, so the result is written once and
    the serving path only ever reads it back.
    """
    return ASSET_DIR / "geography.npz"


@lru_cache(maxsize=1)
def _static() -> dict | None:
    path = _static_path()
    if not path.exists():
        return None
    with np.load(path) as z:
        return {k: z[k] for k in z.files}


@lru_cache(maxsize=1)
def land_mask() -> np.ndarray:
    """Boolean (n_lat, n_lon) mask, True where the grid cell centre is land."""
    cached = _static()
    if cached is not None:
        return cached["land"].astype(bool)
    return _compute_land_mask()


def _compute_land_mask() -> np.ndarray:
    from matplotlib.path import Path as MplPath

    lat2d, lon2d = mesh()
    points = np.column_stack([lon2d.ravel(), lat2d.ravel()])
    mask = np.zeros(points.shape[0], dtype=bool)
    for ring in coastline_rings():
        lo_lon, hi_lon = ring[:, 0].min(), ring[:, 0].max()
        lo_lat, hi_lat = ring[:, 1].min(), ring[:, 1].max()
        box = (
            (points[:, 0] >= lo_lon - 1) & (points[:, 0] <= hi_lon + 1)
            & (points[:, 1] >= lo_lat - 1) & (points[:, 1] <= hi_lat + 1)
        )
        if not box.any():
            continue
        inside = MplPath(ring).contains_points(points[box])
        idx = np.flatnonzero(box)[inside]
        mask[idx] = True
    return mask.reshape(lat2d.shape)


@lru_cache(maxsize=1)
def ocean_mask() -> np.ndarray:
    """True where a vessel could physically float."""
    return ~land_mask()


@lru_cache(maxsize=1)
def distance_to_coast_km() -> np.ndarray:
    """Distance from every ocean cell to the nearest land cell, kilometres."""
    cached = _static()
    if cached is not None:
        return cached["coast_km"].astype(np.float32)
    return _compute_distance_to_coast()


def _compute_distance_to_coast() -> np.ndarray:
    """The transform runs on a longitudinally tiled copy so the antimeridian is
    handled without a seam."""
    from scipy import ndimage

    ocean = ocean_mask()
    tiled = np.concatenate([ocean, ocean, ocean], axis=1)
    dist = ndimage.distance_transform_edt(tiled, sampling=(_LAT_KM, _LON_KM))
    n = ocean.shape[1]
    return dist[:, n : 2 * n].astype(np.float32)


@lru_cache(maxsize=1)
def shelf_depth_m() -> np.ndarray:
    """Smooth bathymetry proxy used only for context and grounding checks.

    Real deployments read GEBCO; the proxy reproduces the first-order structure
    of a narrow Antarctic shelf giving way to a deep abyssal plain.
    """
    d = distance_to_coast_km()
    depth = 120.0 + 5200.0 * (1.0 - np.exp(-d / 260.0))
    depth[land_mask()] = 0.0
    return depth.astype(np.float32)


@lru_cache(maxsize=1)
def coast_normal() -> tuple[np.ndarray, np.ndarray]:
    """Unit vector pointing away from the coast at every ocean cell."""
    d = distance_to_coast_km()
    gy, gx = np.gradient(d)
    norm = np.hypot(gx, gy)
    norm[norm < 1e-6] = 1.0
    return (gx / norm).astype(np.float32), (gy / norm).astype(np.float32)


def summary() -> dict:
    """Diagnostics surfaced by the API so the data layer is inspectable."""
    lats, lons = axes()
    ocean = ocean_mask()
    return {
        "grid": {
            "lat_min": GRID.lat_min,
            "lat_max": GRID.lat_max,
            "lat_step": GRID.lat_step,
            "lon_min": GRID.lon_min,
            "lon_max": GRID.lon_max,
            "lon_step": GRID.lon_step,
            "n_lat": GRID.n_lat,
            "n_lon": GRID.n_lon,
        },
        "cells": int(ocean.size),
        "ocean_cells": int(ocean.sum()),
        "coastline_rings": len(coastline_rings()),
        "lat_range": [float(lats[0]), float(lats[-1])],
        "lon_range": [float(lons[0]), float(lons[-1])],
    }
