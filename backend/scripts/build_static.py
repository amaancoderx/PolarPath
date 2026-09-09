"""Precompute the geography that the serving path must not have to derive.

The land mask needs a point-in-polygon test (matplotlib) and the distance to
coast needs a Euclidean distance transform (SciPy). Both are build-time work on
fields that never change, so they are computed once here and written to
``polarpath/assets/geography.npz``. The mesoscale eddy streamfunction goes in
the same file for the same reason.

With this archive in place the running service needs NumPy and nothing else
from the scientific stack, which is what makes it deployable as a function.

    python backend/scripts/build_static.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from polarpath.config import ASSET_DIR
from polarpath.datasets import ocean_atlas as oa
from polarpath.datasets import reanalysis as ra


def main() -> None:
    target = ASSET_DIR / "geography.npz"
    if target.exists():
        target.unlink()
    oa._static.cache_clear()
    oa.land_mask.cache_clear()
    oa.distance_to_coast_km.cache_clear()

    print("computing land mask")
    land = oa._compute_land_mask()
    print("computing distance to coast")
    oa.land_mask.cache_clear()
    oa.ocean_mask.cache_clear()
    coast = oa._compute_distance_to_coast()
    print("computing eddy streamfunction")
    eddy = ra._compute_eddy_streamfunction()

    np.savez_compressed(
        target,
        land=land,
        coast_km=coast.astype(np.float32),
        eddy_psi=eddy.astype(np.float32),
    )
    size = target.stat().st_size / 1024
    print(f"wrote {target} ({size:.0f} kB)")
    print(f"  land cells      {int(land.sum())}")
    print(f"  coast distance  {coast[~land].min():.0f} to {coast.max():.0f} km")


if __name__ == "__main__":
    main()
