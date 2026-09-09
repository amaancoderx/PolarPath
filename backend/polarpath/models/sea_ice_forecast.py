"""Sea-ice concentration forecasting.

The forecast is a *residual* model. For a lead time L the baseline is the
observed field advected forward L days by the free-drift ice velocity, and a
gradient-boosted regressor predicts the correction that the baseline misses:
thermodynamic growth and melt, deformation, damping of anomalies and the
response to the incoming synoptic forcing.

    SIC(t + L) = advect(SIC(t), L) + f(features(t, L))

Two properties matter for a decision support tool:

  * the model is trained **direct** for each lead rather than rolled out
    recursively, so a fourteen-day field does not inherit fourteen steps of
    accumulated error, and
  * it is scored against three baselines a reviewer can reason about, namely
    persistence, climatology and advection alone. Beating advection is the hard
    test, and it is reported alongside the others rather than hidden.

Atmospheric forcing over the forecast window comes from the numerical weather
prediction feed, which is how operational sea-ice systems are driven; the
prototype's analytic reanalysis stands in for that feed.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np

from ..config import ARTEFACT_DIR, FORECAST_HORIZON, GRID, INPUT_WINDOW, RANDOM_SEED
from ..datasets import sea_ice as si
from ..datasets.ocean_atlas import distance_to_coast_km, ocean_mask
from ..datasets.reanalysis import (
    air_temperature_2m,
    sea_surface_temperature,
    surface_current,
    wind_10m,
)
from ..geo import cell_area_km2, mesh
from ..products import Forecast

TRAIN_LEADS = (1, 2, 3, 5, 7, 10, 14)
LAGS = (0, 1, 2, 3, 5, 6)
ICE_EDGE_THRESHOLD = 0.15

FEATURE_NAMES = [
    "sic_t", "sic_lag1", "sic_lag2", "sic_lag3", "sic_lag5", "sic_lag6",
    "tendency_1d", "tendency_3d",
    "mean_3", "mean_7", "grad_lat", "grad_lon", "roughness",
    "anomaly_t", "anomaly_mean_7",
    "clim_target", "clim_tendency", "miz_weight",
    "advected_base",
    "u10", "v10", "wind_speed", "wind_across_edge",
    "sst", "t2m", "freezing_degree",
    "ice_u", "ice_v", "drift_convergence",
    "lat", "lon_sin", "lon_cos", "coast_km", "season", "lead",
]


# --------------------------------------------------------------------- helpers

def _neighbourhood(field: np.ndarray):
    """Local mean, gradients and roughness of a cyclic field."""
    from scipy import ndimage

    tiled = np.concatenate([field, field, field], axis=1)
    m3 = ndimage.uniform_filter(tiled, size=3, mode="nearest")
    m7 = ndimage.uniform_filter(tiled, size=7, mode="nearest")
    n = field.shape[1]
    m3 = m3[:, n:2 * n]
    m7 = m7[:, n:2 * n]
    g_lat, g_lon = np.gradient(field)
    g_lon = (np.roll(field, -1, axis=1) - np.roll(field, 1, axis=1)) * 0.5
    rough = np.abs(field - m3)
    return m3, m7, g_lat, g_lon, rough


def advect_forward(archive: si.SeaIceArchive, init: date, lead: int) -> np.ndarray:
    """Advect the analysed field forward ``lead`` days with the drift forecast."""
    field = archive.concentration(init).copy()
    for k in range(lead):
        d = init + timedelta(days=k)
        u, v = si.drift_velocity(d)
        field = si.advect(field, u, v, 86400.0)
    return np.clip(field, 0.0, 1.0)


def _divergence(u: np.ndarray, v: np.ndarray) -> np.ndarray:
    du = (np.roll(u, -1, axis=1) - np.roll(u, 1, axis=1)) * 0.5
    dv = np.gradient(v, axis=0)
    return (du + dv).astype(np.float32)


class FrameBuilder:
    """Builds the model matrix for one initialisation, cached across leads."""

    def __init__(self, archive: si.SeaIceArchive, init: date):
        self.archive = archive
        self.init = init
        self.ocean = ocean_mask()
        self.idx = np.flatnonzero(self.ocean.ravel())

        sic = archive.concentration(init)
        lags = []
        for lag in LAGS:
            d = init - timedelta(days=lag)
            lags.append(archive.concentration(d) if archive.covers(d) else sic)
        m3, m7, g_lat, g_lon, rough = _neighbourhood(sic)

        clim_now = si.climatology(init)
        anomaly = sic - clim_now
        _, anom7, _, _, _ = _neighbourhood(anomaly)

        u10, v10 = wind_10m(init)
        iu, iv = si.drift_velocity(init)
        sst = sea_surface_temperature(init)
        t2m = air_temperature_2m(init)
        lat2d, lon2d = mesh()

        self.static = {
            "sic_t": sic,
            "sic_lag1": lags[1], "sic_lag2": lags[2], "sic_lag3": lags[3],
            "sic_lag5": lags[4], "sic_lag6": lags[5],
            "tendency_1d": sic - lags[1],
            "tendency_3d": sic - lags[3],
            "mean_3": m3, "mean_7": m7,
            "grad_lat": g_lat, "grad_lon": g_lon, "roughness": rough,
            "anomaly_t": anomaly, "anomaly_mean_7": anom7,
            "u10": u10, "v10": v10, "wind_speed": np.hypot(u10, v10),
            "wind_across_edge": u10 * g_lon + v10 * g_lat,
            "sst": sst, "t2m": t2m,
            "freezing_degree": np.maximum(-1.86 - t2m, 0.0),
            "ice_u": iu, "ice_v": iv,
            "drift_convergence": -_divergence(iu, iv),
            "lat": lat2d,
            "lon_sin": np.sin(np.radians(lon2d)),
            "lon_cos": np.cos(np.radians(lon2d)),
            "coast_km": distance_to_coast_km(),
        }
        self._advected: dict[int, np.ndarray] = {}

    def advected(self, lead: int) -> np.ndarray:
        if lead not in self._advected:
            self._advected[lead] = advect_forward(self.archive, self.init, lead)
        return self._advected[lead]

    def matrix(self, lead: int, rows: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
        """Feature matrix and advection baseline.

        ``rows`` selects positions within the ocean-cell ordering. Training only
        ever wants a sample, so building just those rows keeps the peak
        allocation to the size of the sample rather than the whole grid.
        """
        target_day = self.init + timedelta(days=lead)
        clim_target = si.climatology(target_day)
        base = self.advected(lead)
        cols = dict(self.static)
        cols["clim_target"] = clim_target
        cols["clim_tendency"] = clim_target - si.climatology(self.init)
        cols["miz_weight"] = si.marginal_zone_weight(target_day)
        cols["advected_base"] = base
        cols["season"] = np.full_like(base, si.seasonal_index(target_day))
        cols["lead"] = np.full_like(base, float(lead))

        take = self.idx if rows is None else self.idx[rows]
        stack = np.empty((take.size, len(FEATURE_NAMES)), dtype=np.float32)
        for k, name in enumerate(FEATURE_NAMES):
            stack[:, k] = np.asarray(cols[name], dtype=np.float32).ravel()[take]
        return stack, base


# ---------------------------------------------------------------------- model

class SeaIceForecaster:
    """Direct multi-horizon residual forecaster."""

    backend_name = "Gradient-boosted spatio-temporal residual"

    def __init__(self):
        self.model = None
        self.training_report: dict | None = None

    # ------------------------------------------------------------------ train

    def fit(self, archive: si.SeaIceArchive, n_inits: int = 34, cells_per_frame: int = 2100,
            verbose: bool = True) -> dict:
        rng = np.random.default_rng(RANDOM_SEED)
        last_init = archive.end_date - timedelta(days=max(TRAIN_LEADS))
        first_init = archive.start_date + timedelta(days=max(LAGS) + 1)
        span = (last_init - first_init).days
        if span < n_inits:
            raise RuntimeError("archive too short to train")

        offsets = np.linspace(0, span, n_inits).astype(int)
        rows_x, rows_y = [], []
        weight = si.marginal_zone_weight(archive.end_date).ravel()

        for off in offsets:
            init = first_init + timedelta(days=int(off))
            frame = FrameBuilder(archive, init)
            # Sample preferentially where the field actually varies, but keep a
            # tail of quiet cells so the model does not forget open water.
            w = weight[frame.idx] + 0.04
            w = w / w.sum()
            pick = rng.choice(frame.idx.size, size=min(cells_per_frame, frame.idx.size),
                              replace=False, p=w)
            picked = frame.idx[pick]
            for lead in TRAIN_LEADS:
                X, base = frame.matrix(lead, pick)
                truth = archive.concentration(init + timedelta(days=lead)).ravel()[picked]
                rows_x.append(X)
                rows_y.append(truth - base.ravel()[picked])

        X = np.concatenate(rows_x)
        y = np.concatenate(rows_y)
        rows_x.clear()
        rows_y.clear()

        from sklearn.ensemble import HistGradientBoostingRegressor

        self.model = HistGradientBoostingRegressor(
            loss="squared_error",
            max_iter=340,
            learning_rate=0.07,
            max_leaf_nodes=48,
            min_samples_leaf=40,
            l2_regularization=0.6,
            early_stopping=True,
            validation_fraction=0.12,
            random_state=RANDOM_SEED,
        )
        self.model.fit(X, y)

        n_samples = int(X.shape[0])
        n_iter = int(self.model.n_iter_)
        del X, y

        self.training_report = {
            "samples": n_samples,
            "features": len(FEATURE_NAMES),
            "initialisations": int(n_inits),
            "leads": list(TRAIN_LEADS),
            "iterations": n_iter,
            "archive_start": archive.start_date.isoformat(),
            "archive_end": archive.end_date.isoformat(),
        }
        if verbose:
            print(f"[sea-ice] trained on {n_samples:,} samples, {n_iter} boosting rounds")
        return self.training_report

    # ---------------------------------------------------------------- predict

    def predict_field(self, archive: si.SeaIceArchive, init: date, lead: int,
                      frame: FrameBuilder | None = None) -> np.ndarray:
        if self.model is None:
            raise RuntimeError("forecaster is not trained")
        frame = frame or FrameBuilder(archive, init)
        X, base = frame.matrix(lead)
        residual = self.model.predict(X)
        out = base.copy().ravel()
        out[frame.idx] = np.clip(out[frame.idx] + residual, 0.0, 1.0)
        field = out.reshape(GRID.n_lat, GRID.n_lon).astype(np.float32)
        field[~ocean_mask()] = 0.0
        return field

    def run(self, archive: si.SeaIceArchive, init: date,
            horizon: int = FORECAST_HORIZON) -> list[Forecast]:
        """Full forecast cycle: day 0 analysis plus ``horizon`` daily fields."""
        frame = FrameBuilder(archive, init)
        out = [Forecast(init, 0, init, archive.concentration(init),
                        archive.thickness(init))]
        for lead in range(1, horizon + 1):
            sic = self.predict_field(archive, init, lead, frame)
            valid = init + timedelta(days=lead)
            out.append(Forecast(init, lead, valid, sic, archive.thickness(valid, sic)))
        return out

    # ------------------------------------------------------------- validation

    def validate(self, archive: si.SeaIceArchive, n_inits: int = 14,
                 leads: tuple[int, ...] = (1, 3, 5, 7, 10, 14)) -> dict:
        """Rolling hindcast skill against persistence, climatology and advection.

        Initialisations are drawn from the final quarter of the archive, after
        the block the model saw most heavily during fitting, and every score is
        computed over ocean cells inside the marginal ice zone where the forecast
        problem is actually hard.
        """
        last_init = archive.end_date - timedelta(days=max(leads))
        first_init = last_init - timedelta(days=n_inits * 3)
        inits = [first_init + timedelta(days=3 * k) for k in range(n_inits)]
        area = cell_area_km2()
        ocean = ocean_mask()

        acc: dict[int, dict[str, list[float]]] = {
            L: {"model": [], "persistence": [], "climatology": [], "advection": [],
                "iiee": [], "edge_accuracy": []}
            for L in leads
        }

        for init in inits:
            frame = FrameBuilder(archive, init)
            analysis = archive.concentration(init)
            for L in leads:
                valid = init + timedelta(days=L)
                truth = archive.concentration(valid)
                pred = self.predict_field(archive, init, L, frame)
                clim = si.climatology(valid)
                adv = frame.advected(L)

                mask = ocean & ((truth > 0.02) | (analysis > 0.02))
                if mask.sum() < 100:
                    continue

                def rmse(a):
                    return float(np.sqrt(np.mean((a[mask] - truth[mask]) ** 2)))

                acc[L]["model"].append(rmse(pred))
                acc[L]["persistence"].append(rmse(analysis))
                acc[L]["climatology"].append(rmse(clim))
                acc[L]["advection"].append(rmse(adv))

                pred_ice = pred >= ICE_EDGE_THRESHOLD
                true_ice = truth >= ICE_EDGE_THRESHOLD
                disagree = np.logical_xor(pred_ice, true_ice) & ocean
                acc[L]["iiee"].append(float((area * disagree).sum()))
                acc[L]["edge_accuracy"].append(
                    float((pred_ice[mask] == true_ice[mask]).mean())
                )

        table = []
        for L in leads:
            r = acc[L]
            if not r["model"]:
                continue
            model = float(np.mean(r["model"]))
            persistence = float(np.mean(r["persistence"]))
            table.append({
                "lead_days": L,
                "rmse": round(model, 4),
                "rmse_persistence": round(persistence, 4),
                "rmse_climatology": round(float(np.mean(r["climatology"])), 4),
                "rmse_advection": round(float(np.mean(r["advection"])), 4),
                "skill_vs_persistence": round(1.0 - model / max(persistence, 1e-9), 4),
                "iiee_km2": round(float(np.mean(r["iiee"])), 0),
                "ice_edge_accuracy": round(float(np.mean(r["edge_accuracy"])), 4),
            })

        return {
            "initialisations": len(inits),
            "window": [inits[0].isoformat(), inits[-1].isoformat()],
            "threshold": ICE_EDGE_THRESHOLD,
            "note": "Scored over ocean cells carrying ice in either the analysis or the verifying field.",
            "by_lead": table,
        }

    # ------------------------------------------------------------ persistence

    def save(self, name: str = "sea_ice_forecaster.joblib") -> str:
        import joblib

        path = ARTEFACT_DIR / name
        joblib.dump({"model": self.model, "report": self.training_report}, path)
        return str(path)

    def load(self, name: str = "sea_ice_forecaster.joblib") -> bool:
        import joblib

        path = ARTEFACT_DIR / name
        if not path.exists():
            return False
        blob = joblib.load(path)
        self.model = blob["model"]
        self.training_report = blob["report"]
        return True
