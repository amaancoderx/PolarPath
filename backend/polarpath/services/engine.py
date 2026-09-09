"""Runtime engine.

Owns the archive, the two trained models and every derived product, and caches
each stage to disk so a restart in front of an audience takes seconds rather
than minutes. Nothing in the API layer touches a model directly.
"""
from __future__ import annotations

import json
import threading
import time
from datetime import date, datetime, timedelta
from functools import lru_cache

import numpy as np

from ..config import (
    CACHE_DIR,
    FORECAST_HORIZON,
    GRID,
    REFERENCE_DATE,
)
from ..datasets import fleet, icebergs, stations
from ..datasets.sea_ice import get_archive
from ..models import routing as rt
from ..models.iceberg_drift import IcebergDriftModel, states_from_catalogue
from ..models.sea_ice_forecast import Forecast, SeaIceForecaster


class Engine:
    """Single shared instance created at application start-up."""

    def __init__(self, reference: date = REFERENCE_DATE, horizon: int = FORECAST_HORIZON):
        self.reference = reference
        self.horizon = horizon
        self.ready = False
        self.status = "cold"
        self.timings: dict[str, float] = {}
        self._lock = threading.Lock()

        self._archive = None
        self.forecaster = SeaIceForecaster()
        self.drift = IcebergDriftModel()
        self.forecasts: list[Forecast] = []
        self.berg_tracks: list[dict] = []
        self.sea_ice_skill: dict = {}
        self.drift_skill: dict = {}

    # ------------------------------------------------------------------- warm

    def warm(self, verbose: bool = True) -> None:
        with self._lock:
            if self.ready:
                return
            steps = [
                ("sea-ice model", self._load_forecaster),
                ("iceberg model", self._load_drift),
                ("forecast cycle", self._load_forecasts),
                ("iceberg trajectories", self._load_tracks),
                ("skill reports", self._load_skill),
            ]
            for name, fn in steps:
                self.status = name
                t0 = time.time()
                fn(verbose)
                self.timings[name] = round(time.time() - t0, 2)
                if verbose:
                    print(f"[engine] {name:<22} {self.timings[name]:>6.2f}s")
            self.status = "ready"
            self.ready = True

    @property
    def archive(self):
        """The observed archive, built only if a stage actually needs it.

        Once the forecast cycle, trajectories and skill report are cached on
        disk the running server never touches it, which keeps a live instance
        well under a couple of hundred megabytes.
        """
        if self._archive is None:
            self._archive = get_archive(self.reference)
        return self._archive

    def _load_forecaster(self, verbose: bool) -> None:
        if not self.forecaster.load():
            self.forecaster.fit(self.archive, verbose=verbose)
            self.forecaster.save()

    def _load_drift(self, verbose: bool) -> None:
        if not self.drift.load():
            self.drift.fit(self.archive, self.reference, verbose=verbose)
            self.drift.save()

    def _forecast_cache(self):
        return CACHE_DIR / f"forecast_{self.reference.isoformat()}_{self.horizon}.npz"

    def _load_forecasts(self, verbose: bool) -> None:
        path = self._forecast_cache()
        if path.exists():
            with np.load(path) as z:
                sic, thick = z["sic"], z["thickness"]
            self.forecasts = [
                Forecast(self.reference, lead, self.reference + timedelta(days=lead),
                         sic[lead].astype(np.float32), thick[lead].astype(np.float32))
                for lead in range(sic.shape[0])
            ]
            return
        self.forecasts = self.forecaster.run(self.archive, self.reference, self.horizon)
        np.savez_compressed(
            path,
            sic=np.stack([f.concentration for f in self.forecasts]).astype(np.float16),
            thickness=np.stack([f.thickness for f in self.forecasts]).astype(np.float16),
        )

    def _tracks_cache(self):
        return CACHE_DIR / f"berg_tracks_{self.reference.isoformat()}_{self.horizon}.json"

    def _load_tracks(self, verbose: bool) -> None:
        path = self._tracks_cache()
        if path.exists():
            self.berg_tracks = json.loads(path.read_text(encoding="utf-8"))
            return
        bergs = states_from_catalogue(icebergs.catalogue())
        self.berg_tracks = self.drift.forecast(
            self.archive, bergs, self.reference, self.horizon, corrected=True
        )
        path.write_text(json.dumps(self.berg_tracks), encoding="utf-8")

    def _skill_cache(self):
        return CACHE_DIR / f"skill_{self.reference.isoformat()}.json"

    def _load_skill(self, verbose: bool) -> None:
        path = self._skill_cache()
        if path.exists():
            blob = json.loads(path.read_text(encoding="utf-8"))
            self.sea_ice_skill = blob["sea_ice"]
            self.drift_skill = blob["drift"]
            return
        self.sea_ice_skill = self.forecaster.validate(self.archive)
        self.drift_skill = self.drift.validate(self.archive, self.reference)
        path.write_text(json.dumps({"sea_ice": self.sea_ice_skill, "drift": self.drift_skill}),
                        encoding="utf-8")

    # -------------------------------------------------------------- products

    @lru_cache(maxsize=2)
    def fields(self, vessel_id: str) -> list[rt.Field]:
        vessel = fleet.get(vessel_id)
        return rt.build_fields(vessel, self.forecasts, self.berg_tracks)

    def plan(self, vessel_id: str, origin_id: str, destination_id: str,
             departure: datetime | None = None):
        vessel = fleet.get(vessel_id)
        origin = stations.get(origin_id)
        destination = stations.get(destination_id)
        departure = departure or datetime.combine(self.reference, datetime.min.time())

        planner = rt.RoutePlanner(vessel, self.fields(vessel_id), departure)
        t0 = time.time()
        routes, corridor = planner.plan((origin.lat, origin.lon), (destination.lat, destination.lon))
        elapsed = time.time() - t0

        encounters = [rt.berg_encounters(r, self.berg_tracks) for r in routes]

        return {
            "routes": routes,
            "encounters": encounters,
            "corridor_cells": corridor.size,
            "direct_km": corridor.direct_m / 1000.0,
            "solve_seconds": round(elapsed, 3),
            "vessel": vessel,
            "origin": origin,
            "destination": destination,
            "departure": departure,
        }

    def benchmark(self, voyage_id: str):
        voyage = stations.VOYAGE_BY_ID[voyage_id]
        fields = self.fields(voyage.vessel_id)
        reported = rt.score_track(fleet.get(voyage.vessel_id), fields, voyage.waypoints)
        planned = self.plan(voyage.vessel_id, voyage.origin_id, voyage.destination_id)
        return {"voyage": voyage, "reported": reported, "planned": planned}

    # ---------------------------------------------------------------- summary

    @property
    def ice_extent_km2(self) -> float:
        """Extent of the day-zero analysis, computed from the cached field."""
        from ..geo import cell_area_km2

        analysis = self.forecasts[0].concentration
        return float((cell_area_km2() * (analysis >= 0.15)).sum())

    def snapshot(self) -> dict:
        analysis = self.forecasts[0]
        return {
            "reference_date": self.reference.isoformat(),
            "horizon_days": self.horizon,
            "status": self.status,
            "ready": self.ready,
            "timings": self.timings,
            "grid": {"n_lat": GRID.n_lat, "n_lon": GRID.n_lon,
                     "lat_min": GRID.lat_min, "lat_max": GRID.lat_max,
                     "lon_min": GRID.lon_min, "lon_max": GRID.lon_max,
                     "lat_step": GRID.lat_step, "lon_step": GRID.lon_step},
            "sea_ice_backend": self.forecaster.backend_name,
            "iceberg_backend": self.drift.backend_name,
            "sea_ice_training": self.forecaster.training_report,
            "iceberg_training": self.drift.training_report,
            "tracked_bergs": len(self.berg_tracks),
            "ice_extent_km2": self.ice_extent_km2,
            "mean_concentration": round(
                float(analysis.concentration[analysis.concentration >= 0.15].mean()), 3),
        }


ENGINE = Engine()
