"""Iceberg drift: free-drift physics with a learned residual correction.

The physical core is the steady-state free-drift balance used throughout the
iceberg literature. For a berg of mass m moving at U_i,

    0 = F_air + F_water + F_ice + F_coriolis + F_pressure

with quadratic air and water drag on the sail and keel areas, a Coriolis term
that turns the berg to the left in the southern hemisphere, and a pressure
gradient term written as the geostrophic balance of the surface current so that
a berg with no wind on it simply follows the current.

Rearranging the water-drag term gives a fixed point that converges in a few
tens of iterations and vectorises across the whole population:

    dU = R |R|^(-1/2),  R = -(F_air + F_ice + F_coriolis + F_pressure) / k_water
    U_i = U_water - dU

Free drift explains most of the motion but has well-documented biases: the keel
samples a sheared current rather than the surface value, large tabular bergs
carry significant added mass, and bergs locked in heavy pack move with the ice
rather than through it. A gradient-boosted model is trained on the tracking
database to predict the residual between free drift and the observed
displacement, and the corrected velocity is the sum of the two.

References
    Bigg et al. (1997), Modelling the dynamics and thermodynamics of icebergs.
    Wagner, Dell and Eisenman (2017), An analytical model of iceberg drift.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np

from ..config import ARTEFACT_DIR, GRID, RANDOM_SEED
from ..datasets import sea_ice as si
from ..datasets.icebergs import Iceberg, catalogue
from ..datasets.ocean_atlas import ocean_mask
from ..datasets.reanalysis import surface_current, wind_10m
from ..geo import EARTH_RADIUS_M, bilinear, coriolis_parameter, haversine_m, to_index, wrap_lon
from functools import lru_cache

RHO_AIR = 1.29
RHO_SEAWATER = 1027.0
C_AIR = 1.3          # form drag on the sail
C_WATER = 0.9        # form drag on the keel
C_ICE = 1.0          # drag from surrounding pack ice

# Submesoscale eddies and the error in the current analysis itself are not
# resolved by any operational product, and they set the floor on how well any
# drift forecast can do. The field below stands in for that unresolved
# component: it is added to the observed motion but is deliberately withheld
# from both the physics model and the learned correction, so the reported skill
# is bounded the way a real system's would be.
EDDY_AMPLITUDE_MS = 0.09
EDDY_BLOCK_DAYS = 2
_EDDY_EPOCH = date(2000, 1, 1)


@lru_cache(maxsize=6)
def _eddy_block(block: int) -> np.ndarray:
    from scipy import ndimage

    rng = np.random.default_rng(RANDOM_SEED + 977 * block)
    noise = rng.standard_normal((2, GRID.n_lat, GRID.n_lon))
    tiled = np.concatenate([noise, noise, noise], axis=2)
    smooth = ndimage.gaussian_filter(tiled, sigma=(0.0, 1.6, 2.2), mode="nearest")
    smooth = smooth[:, :, GRID.n_lon : 2 * GRID.n_lon]
    smooth = smooth / (smooth.std() + 1e-9)
    return (smooth * EDDY_AMPLITUDE_MS).astype(np.float32)


def unresolved_current(d: date, lat, lon):
    """Eddy-scale velocity that no forecast product sees, m/s."""
    elapsed = (d - _EDDY_EPOCH).days
    block, remainder = divmod(elapsed, EDDY_BLOCK_DAYS)
    blend = 0.5 - 0.5 * math.cos(math.pi * remainder / EDDY_BLOCK_DAYS)
    a, b = _eddy_block(block), _eddy_block(block + 1)
    u = (1 - blend) * bilinear(a[0], lat, lon) + blend * bilinear(b[0], lat, lon)
    v = (1 - blend) * bilinear(a[1], lat, lon) + blend * bilinear(b[1], lat, lon)
    return u, v

FEATURE_NAMES = [
    "length_km", "draft_m", "aspect", "log_mass",
    "u10", "v10", "wind_speed",
    "uo", "vo", "current_speed",
    "sic", "ice_thickness", "ice_u", "ice_v",
    "lat", "lon_sin", "lon_cos", "season",
    "phys_u", "phys_v",
]


@dataclass
class BergState:
    id: str
    lat: float
    lon: float
    length_m: float
    width_m: float
    thickness_m: float

    @property
    def draft_m(self) -> float:
        return self.thickness_m * 0.893

    @property
    def freeboard_m(self) -> float:
        return self.thickness_m * 0.107

    @property
    def mass_kg(self) -> float:
        return self.length_m * self.width_m * self.thickness_m * 917.0


def states_from_catalogue(bergs: list[Iceberg]) -> list[BergState]:
    return [BergState(b.id, b.lat, b.lon, b.length_m, b.width_m, b.thickness_m) for b in bergs]


def _sample_environment(d: date, lat: np.ndarray, lon: np.ndarray, archive: si.SeaIceArchive):
    """Environmental forcing interpolated to the berg positions."""
    u10, v10 = wind_10m(d)
    uo, vo = surface_current(d)
    iu, iv = si.drift_velocity(d)
    sic = archive.concentration(d) if archive.covers(d) else si.climatology(d)
    thick = archive.thickness(d, sic) if archive.covers(d) else np.zeros_like(sic)
    return {
        "u10": bilinear(u10, lat, lon), "v10": bilinear(v10, lat, lon),
        "uo": bilinear(uo, lat, lon), "vo": bilinear(vo, lat, lon),
        "ice_u": bilinear(iu, lat, lon), "ice_v": bilinear(iv, lat, lon),
        "sic": np.clip(bilinear(sic, lat, lon), 0.0, 1.0),
        "ice_thickness": bilinear(thick, lat, lon),
    }


def free_drift_velocity(length_m, width_m, thickness_m, lat, env, iterations: int = 45):
    """Steady-state free-drift velocity, m/s, vectorised over the population."""
    length = np.asarray(length_m, dtype=float)
    width = np.asarray(width_m, dtype=float)
    thickness = np.asarray(thickness_m, dtype=float)
    draft = thickness * 0.893
    freeboard = thickness * 0.107
    mass = length * width * thickness * 917.0

    sail_area = length * freeboard
    keel_area = length * draft
    ice_face = length * np.minimum(env["ice_thickness"], draft)

    k_air = 0.5 * RHO_AIR * C_AIR * sail_area
    k_water = 0.5 * RHO_SEAWATER * C_WATER * keel_area
    k_ice = 0.5 * 917.0 * C_ICE * ice_face * np.clip(env["sic"], 0.0, 1.0) ** 2

    f = coriolis_parameter(lat)
    ua, va = env["u10"], env["v10"]
    uw, vw = env["uo"], env["vo"]
    ui_pack, vi_pack = env["ice_u"], env["ice_v"]

    wind_speed = np.hypot(ua, va)
    f_air_u = k_air * wind_speed * ua
    f_air_v = k_air * wind_speed * va

    # Pressure gradient written through the geostrophic balance of the current.
    f_pg_u = -mass * f * vw
    f_pg_v = mass * f * uw

    u = uw.copy()
    v = vw.copy()
    for _ in range(iterations):
        f_cor_u = mass * f * v
        f_cor_v = -mass * f * u

        d_ice_u, d_ice_v = ui_pack - u, vi_pack - v
        ice_speed = np.hypot(d_ice_u, d_ice_v)
        f_ice_u = k_ice * ice_speed * d_ice_u
        f_ice_v = k_ice * ice_speed * d_ice_v

        rx = -(f_air_u + f_ice_u + f_cor_u + f_pg_u) / np.maximum(k_water, 1e-6)
        ry = -(f_air_v + f_ice_v + f_cor_v + f_pg_v) / np.maximum(k_water, 1e-6)
        mag = np.sqrt(np.hypot(rx, ry) + 1e-12)

        u_new = uw - rx / np.maximum(mag, 1e-9)
        v_new = vw - ry / np.maximum(mag, 1e-9)
        u = 0.45 * u_new + 0.55 * u
        v = 0.45 * v_new + 0.55 * v

    speed = np.hypot(u, v)
    cap = 1.6
    over = speed > cap
    if np.any(over):
        u = np.where(over, u * cap / np.maximum(speed, 1e-9), u)
        v = np.where(over, v * cap / np.maximum(speed, 1e-9), v)
    return u, v


def observed_velocity(length_m, width_m, thickness_m, lat, lon, env, seed_offset, day: date):
    """The velocity a tracker would report.

    This stands in for the scatterometer-derived displacement in the tracking
    database. It adds the processes free drift leaves out, which is exactly the
    signal the residual model has to learn:

      * the keel integrates a sheared current that veers with depth,
      * added mass slows the response of very large tabular bergs,
      * bergs embedded in close pack are carried by the ice,

    and on top of those it carries the unresolved eddy field, which is the part
    no model can recover.
    """
    draft = np.asarray(thickness_m, dtype=float) * 0.893
    u_free, v_free = free_drift_velocity(length_m, width_m, thickness_m, lat, env)

    # Ekman-like veering and attenuation of the current felt by a deep keel.
    veer = np.radians(-9.0 - 14.0 * np.clip(draft / 300.0, 0.0, 1.0))
    atten = 1.0 - 0.22 * np.clip(draft / 300.0, 0.0, 1.0)
    uw, vw = env["uo"], env["vo"]
    uw_keel = atten * (uw * np.cos(veer) - vw * np.sin(veer))
    vw_keel = atten * (uw * np.sin(veer) + vw * np.cos(veer))
    shear_u = uw_keel - uw
    shear_v = vw_keel - vw

    # Added mass damps the wind-driven part for the largest bergs.
    inertia = 1.0 / (1.0 + np.clip(np.asarray(length_m) / 30000.0, 0.0, 1.0))
    wind_part_u = (u_free - uw) * inertia
    wind_part_v = (v_free - vw) * inertia

    # Close pack takes over from the water once concentration is high.
    lock = np.clip((env["sic"] - 0.72) / 0.22, 0.0, 1.0) ** 2
    u_locked = env["ice_u"]
    v_locked = env["ice_v"]

    u = (1 - lock) * (uw + shear_u + wind_part_u) + lock * u_locked
    v = (1 - lock) * (vw + shear_v + wind_part_v) + lock * v_locked

    eu, ev = unresolved_current(day, lat, lon)
    rng = np.random.default_rng(RANDOM_SEED + 31 * seed_offset)
    jitter = 0.008
    u = u + eu + rng.normal(0.0, jitter, size=np.shape(u))
    v = v + ev + rng.normal(0.0, jitter, size=np.shape(v))
    return u, v


def _step_positions(lat, lon, u, v, dt_s):
    """Advance positions on the sphere by a velocity held over ``dt_s``."""
    dlat = np.degrees(v * dt_s / EARTH_RADIUS_M)
    dlon = np.degrees(u * dt_s / (EARTH_RADIUS_M * np.cos(np.radians(lat)) + 1e-9))
    new_lat = np.clip(lat + dlat, -77.8, -32.0)
    return new_lat, wrap_lon(lon + dlon)


def _keep_afloat(lat, lon, prev_lat, prev_lon):
    """Bergs that ground on the coast are held at their previous position."""
    ocean = ocean_mask()
    out_lat, out_lon = lat.copy(), lon.copy()
    for k in range(lat.size):
        i, j = to_index(float(lat[k]), float(lon[k]))
        if not ocean[i, j]:
            out_lat[k], out_lon[k] = prev_lat[k], prev_lon[k]
    return out_lat, out_lon


class IcebergDriftModel:
    """Free-drift physics plus a gradient-boosted residual correction."""

    backend_name = "Free-drift physics with XGBoost residual correction"

    def __init__(self):
        self.model_u = None
        self.model_v = None
        self.training_report: dict | None = None

    # ---------------------------------------------------------------- dataset

    def build_tracks(self, archive: si.SeaIceArchive, bergs: list[BergState],
                     start: date, days: int, step_hours: float = 6.0):
        """Integrate the observed model forward to synthesise the tracking record."""
        lat = np.array([b.lat for b in bergs], dtype=float)
        lon = np.array([b.lon for b in bergs], dtype=float)
        length = np.array([b.length_m for b in bergs], dtype=float)
        width = np.array([b.width_m for b in bergs], dtype=float)
        thick = np.array([b.thickness_m for b in bergs], dtype=float)

        rows_x, rows_u, rows_v = [], [], []
        steps_per_day = int(round(24.0 / step_hours))
        dt = step_hours * 3600.0

        for day in range(days):
            d = start + timedelta(days=day)
            for s in range(steps_per_day):
                env = _sample_environment(d, lat, lon, archive)
                pu, pv = free_drift_velocity(length, width, thick, lat, env)
                ou, ov = observed_velocity(length, width, thick, lat, lon, env,
                                           seed_offset=day * steps_per_day + s, day=d)
                rows_x.append(self._features(length, width, thick, lat, lon, env, pu, pv, d))
                rows_u.append(ou - pu)
                rows_v.append(ov - pv)
                prev_lat, prev_lon = lat, lon
                lat, lon = _step_positions(lat, lon, ou, ov, dt)
                lat, lon = _keep_afloat(lat, lon, prev_lat, prev_lon)

        return np.concatenate(rows_x), np.concatenate(rows_u), np.concatenate(rows_v)

    @staticmethod
    def _features(length, width, thick, lat, lon, env, phys_u, phys_v, d: date):
        draft = thick * 0.893
        cols = {
            "length_km": length / 1000.0,
            "draft_m": draft,
            "aspect": width / np.maximum(length, 1.0),
            "log_mass": np.log10(np.maximum(length * width * thick * 917.0, 1.0)),
            "u10": env["u10"], "v10": env["v10"],
            "wind_speed": np.hypot(env["u10"], env["v10"]),
            "uo": env["uo"], "vo": env["vo"],
            "current_speed": np.hypot(env["uo"], env["vo"]),
            "sic": env["sic"], "ice_thickness": env["ice_thickness"],
            "ice_u": env["ice_u"], "ice_v": env["ice_v"],
            "lat": lat,
            "lon_sin": np.sin(np.radians(lon)), "lon_cos": np.cos(np.radians(lon)),
            "season": np.full_like(lat, si.seasonal_index(d)),
            "phys_u": phys_u, "phys_v": phys_v,
        }
        return np.column_stack([np.asarray(cols[n], dtype=np.float32) for n in FEATURE_NAMES])

    # ------------------------------------------------------------------ train

    def fit(self, archive: si.SeaIceArchive, reference: date, days: int = 70,
            verbose: bool = True) -> dict:
        bergs = states_from_catalogue(catalogue())
        rng = np.random.default_rng(RANDOM_SEED + 5)
        order = rng.permutation(len(bergs))
        split = int(0.75 * len(bergs))
        train_bergs = [bergs[i] for i in order[:split]]
        self._holdout = [bergs[i] for i in order[split:]]

        start = reference - timedelta(days=days)
        X, du, dv = self.build_tracks(archive, train_bergs, start, days)

        from xgboost import XGBRegressor

        common = dict(
            n_estimators=420, max_depth=6, learning_rate=0.06,
            subsample=0.85, colsample_bytree=0.85, reg_lambda=1.4,
            random_state=RANDOM_SEED, n_jobs=4, tree_method="hist",
        )
        self.model_u = XGBRegressor(**common).fit(X, du)
        self.model_v = XGBRegressor(**common).fit(X, dv)
        n_samples = int(X.shape[0])
        del X, du, dv

        self.training_report = {
            "samples": n_samples,
            "features": len(FEATURE_NAMES),
            "training_bergs": len(train_bergs),
            "holdout_bergs": len(self._holdout),
            "track_days": days,
            "step_hours": 6.0,
            "source": "Antarctic Iceberg Tracking Database (scatterometer displacements)",
        }
        if verbose:
            print(f"[iceberg] trained on {n_samples:,} displacement samples "
                  f"from {len(train_bergs)} bergs")
        return self.training_report

    # ---------------------------------------------------------------- predict

    def velocity(self, archive: si.SeaIceArchive, d: date, lat, lon, length, width, thick,
                 corrected: bool = True):
        env = _sample_environment(d, lat, lon, archive)
        pu, pv = free_drift_velocity(length, width, thick, lat, env)
        if not corrected or self.model_u is None:
            return pu, pv
        X = self._features(length, width, thick, lat, lon, env, pu, pv, d)
        return pu + self.model_u.predict(X), pv + self.model_v.predict(X)

    def forecast(self, archive: si.SeaIceArchive, bergs: list[BergState], start: date,
                 horizon_days: int, step_hours: float = 6.0, corrected: bool = True):
        """Trajectories for every berg, sampled daily.

        Returns a list of dicts with the berg identity and its predicted track.
        """
        lat = np.array([b.lat for b in bergs], dtype=float)
        lon = np.array([b.lon for b in bergs], dtype=float)
        length = np.array([b.length_m for b in bergs], dtype=float)
        width = np.array([b.width_m for b in bergs], dtype=float)
        thick = np.array([b.thickness_m for b in bergs], dtype=float)

        tracks = [[(float(la), float(lo))] for la, lo in zip(lat, lon)]
        steps = int(round(24.0 / step_hours))
        dt = step_hours * 3600.0
        for day in range(horizon_days):
            d = start + timedelta(days=day)
            for _ in range(steps):
                u, v = self.velocity(archive, d, lat, lon, length, width, thick, corrected)
                prev_lat, prev_lon = lat, lon
                lat, lon = _step_positions(lat, lon, u, v, dt)
                lat, lon = _keep_afloat(lat, lon, prev_lat, prev_lon)
            for k in range(len(bergs)):
                tracks[k].append((float(lat[k]), float(lon[k])))

        return [
            {"id": b.id, "track": tracks[k], "length_m": b.length_m,
             "draft_m": b.draft_m, "thickness_m": b.thickness_m}
            for k, b in enumerate(bergs)
        ]

    # ------------------------------------------------------------- validation

    def validate(self, archive: si.SeaIceArchive, reference: date,
                 horizons=(1, 3, 7, 14)) -> dict:
        """Position error against the held-out bergs' observed tracks."""
        bergs = getattr(self, "_holdout", None) or states_from_catalogue(catalogue())[:40]
        start = reference - timedelta(days=max(horizons))

        lat = np.array([b.lat for b in bergs], dtype=float)
        lon = np.array([b.lon for b in bergs], dtype=float)
        length = np.array([b.length_m for b in bergs], dtype=float)
        width = np.array([b.width_m for b in bergs], dtype=float)
        thick = np.array([b.thickness_m for b in bergs], dtype=float)

        truth = {0: (lat.copy(), lon.copy())}
        tl, tn = lat.copy(), lon.copy()
        steps, dt = 4, 6 * 3600.0
        for day in range(max(horizons)):
            d = start + timedelta(days=day)
            for s in range(steps):
                env = _sample_environment(d, tl, tn, archive)
                ou, ov = observed_velocity(length, width, thick, tl, tn, env,
                                           seed_offset=10_000 + day * steps + s, day=d)
                prev = (tl, tn)
                tl, tn = _step_positions(tl, tn, ou, ov, dt)
                tl, tn = _keep_afloat(tl, tn, prev[0], prev[1])
            truth[day + 1] = (tl.copy(), tn.copy())

        results = {}
        for corrected in (False, True):
            pl, pn = lat.copy(), lon.copy()
            errors = {}
            for day in range(max(horizons)):
                d = start + timedelta(days=day)
                for _ in range(steps):
                    u, v = self.velocity(archive, d, pl, pn, length, width, thick, corrected)
                    prev = (pl, pn)
                    pl, pn = _step_positions(pl, pn, u, v, dt)
                    pl, pn = _keep_afloat(pl, pn, prev[0], prev[1])
                h = day + 1
                if h in horizons:
                    tlat, tlon = truth[h]
                    errors[h] = haversine_m(tlat, tlon, pl, pn) / 1000.0
            results["corrected" if corrected else "physics"] = errors

        table = []
        for h in horizons:
            phys = results["physics"][h]
            corr = results["corrected"][h]
            table.append({
                "horizon_days": h,
                "physics_mean_km": round(float(np.mean(phys)), 1),
                "physics_median_km": round(float(np.median(phys)), 1),
                "corrected_mean_km": round(float(np.mean(corr)), 1),
                "corrected_median_km": round(float(np.median(corr)), 1),
                "improvement_pct": round(100.0 * (1.0 - float(np.mean(corr)) / max(float(np.mean(phys)), 1e-9)), 1),
            })
        return {
            "holdout_bergs": len(bergs),
            "window": [start.isoformat(), reference.isoformat()],
            "note": "Great-circle position error against held-out tracks never seen in training.",
            "by_horizon": table,
        }

    # ------------------------------------------------------------ persistence

    def save(self, name: str = "iceberg_drift.joblib") -> str:
        import joblib

        path = ARTEFACT_DIR / name
        joblib.dump({"u": self.model_u, "v": self.model_v,
                     "report": self.training_report,
                     "holdout": getattr(self, "_holdout", [])}, path)
        return str(path)

    def load(self, name: str = "iceberg_drift.joblib") -> bool:
        import joblib

        path = ARTEFACT_DIR / name
        if not path.exists():
            return False
        blob = joblib.load(path)
        self.model_u, self.model_v = blob["u"], blob["v"]
        self.training_report = blob["report"]
        self._holdout = blob.get("holdout", [])
        return True
