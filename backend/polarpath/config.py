"""Central configuration for the PolarPath prototype.

Every tunable that a reviewer might want to inspect lives here rather than
being scattered through the modelling code.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent
BACKEND_ROOT = PACKAGE_ROOT.parent
PROJECT_ROOT = BACKEND_ROOT.parent
ASSET_DIR = PACKAGE_ROOT / "assets"
CACHE_DIR = BACKEND_ROOT / "data" / "cache"
ARTEFACT_DIR = BACKEND_ROOT / "data" / "artefacts"

for _d in (ASSET_DIR, CACHE_DIR, ARTEFACT_DIR):
    # A serverless filesystem is read-only. The directories are committed, so
    # there is nothing to create there and nothing to fail over.
    try:
        _d.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass


@dataclass(frozen=True)
class GridSpec:
    """Regular latitude/longitude analysis grid for the Southern Ocean.

    A 0.5 deg latitude by 1.0 deg longitude grid is close to square at 60 S
    (55.6 km by 55.5 km), which keeps the routing graph well conditioned.
    """

    lat_min: float = -78.0
    lat_max: float = -32.0
    lat_step: float = 0.5
    lon_min: float = -180.0
    lon_max: float = 180.0
    lon_step: float = 1.0

    @property
    def n_lat(self) -> int:
        return int(round((self.lat_max - self.lat_min) / self.lat_step)) + 1

    @property
    def n_lon(self) -> int:
        return int(round((self.lon_max - self.lon_min) / self.lon_step))


GRID = GridSpec()

# Reference date for the prototype. Early December is the real departure window
# for the Indian Scientific Expedition to Antarctica, and it is the part of the
# season where the routing problem is hard: the pack still reaches well north of
# the stations but the resupply cannot wait for it to clear. Kept fixed so every
# demo run, screenshot and slide reproduces exactly the same fields.
REFERENCE_DATE = date.fromisoformat(os.environ.get("POLARPATH_DATE", "2025-12-05"))

HISTORY_DAYS = 400          # days of synthesised reanalysis held in the archive
FORECAST_HORIZON = 14       # days of sea-ice / iceberg forecast produced
INPUT_WINDOW = 7            # days of history fed to the forecast model
RANDOM_SEED = 20260112

# Routing
CORRIDOR_SLACK = 1.30       # ellipse slack factor for the search corridor
MAX_CORRIDOR_CELLS = 14000  # hard ceiling on the search graph
TIME_STEP_HOURS = 6.0       # forecast field is refreshed on this cadence
MIN_SPEED_KN = 1.5          # below this the vessel is considered beset

CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
