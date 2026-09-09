"""HTTP interface.

Raster layers are returned as base64 unsigned bytes with an explicit value
range rather than as JSON numbers. A single concentration field is 33,480
values; as JSON that is roughly half a megabyte and as bytes it is 33 kB, which
is the difference between a timeline that scrubs smoothly and one that stutters.
"""
from __future__ import annotations

import base64
from datetime import date, datetime, timedelta

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from . import auth
from .config import GRID
from .datasets import fleet, icebergs, stations
from .datasets.ocean_atlas import coastline_payload, land_mask, summary as atlas_summary
from .datasets.reanalysis import surface_current, wind_10m
from .datasets.sea_ice import ice_edge_latitude
from .geo import bilinear, to_index
from .models import resistance as rz
from .models.routing import RouteResult
from .services.engine import ENGINE

# Anything a browser needs before it can sign in.
public = APIRouter(prefix="/api")

# Everything else. The dependency resolves the bearer token to a user, so any
# handler can ask who is calling simply by declaring the parameter.
router = APIRouter(prefix="/api", dependencies=[Depends(auth.require_user)])


@public.post("/auth/login")
def login(body: "LoginRequest") -> dict:
    user = auth.authenticate(body.email, body.password)
    if user is None:
        auth.record("sign-in", body.email.strip().lower(), "rejected", outcome="denied")
        raise HTTPException(401, "Those credentials were not recognised")
    auth.record("sign-in", user.email, auth.ROLES[user.role]["label"])
    return {"token": auth.issue_token(user), "user": user.public()}


@public.get("/public-summary")
def public_summary() -> dict:
    """Headline figures for the landing page.

    Read straight from the engine's own validation report so the page can never
    quote a number the models no longer produce.
    """
    if not ENGINE.ready:
        raise HTTPException(503, f"engine warming: {ENGINE.status}")
    lead7 = next((r for r in ENGINE.sea_ice_skill["by_lead"] if r["lead_days"] == 7),
                 ENGINE.sea_ice_skill["by_lead"][-1])
    berg7 = next((r for r in ENGINE.drift_skill["by_horizon"] if r["horizon_days"] == 7),
                 ENGINE.drift_skill["by_horizon"][-1])
    return {
        "extent": round(ENGINE.ice_extent_km2 / 1e6, 2),
        "bergs": len(ENGINE.berg_tracks),
        "horizon": ENGINE.horizon,
        "rmse": lead7["rmse"],
        "persistence": lead7["rmse_persistence"],
        "skill": lead7["skill_vs_persistence"],
        "edge": lead7["ice_edge_accuracy"],
        "bergError": berg7["corrected_mean_km"],
        "bergPhysics": berg7["physics_mean_km"],
        "reference": ENGINE.reference.isoformat(),
    }


@public.get("/auth/demo-accounts")
def demo_accounts() -> dict:
    """The seeded logins, surfaced so a reviewer never has to read the source."""
    return {"accounts": auth.DEMO_CREDENTIALS,
            "roles": [{"id": k, **v} for k, v in auth.ROLES.items()]}


@router.get("/auth/me")
def me(user: auth.User = Depends(auth.require_user)) -> dict:
    return {"user": user.public()}


@router.get("/admin/users")
def admin_users(user: auth.User = Depends(auth.require_admin)) -> dict:
    return {
        "users": [u.public() for u in auth.USERS.values()],
        "roles": [{"id": k, **v} for k, v in auth.ROLES.items()],
    }


@router.get("/admin/audit")
def admin_audit(limit: int = Query(120, ge=1, le=400),
                user: auth.User = Depends(auth.require_admin)) -> dict:
    return {"entries": auth.audit_trail(limit)}

LAYER_RANGES = {
    "sic": (0.0, 1.0),
    "thickness": (0.0, 3.5),
    "risk": (0.0, 1.0),
    "speed": (0.0, 1.0),
    "bergs": (0.0, 1.0),
}


def _encode(field: np.ndarray, lo: float, hi: float, mask_land: bool = True) -> dict:
    """Quantise a field to bytes. 255 is reserved for land so the client can
    paint the coastline without a second request."""
    arr = np.clip((np.asarray(field, dtype=np.float32) - lo) / (hi - lo), 0.0, 1.0)
    byte = (arr * 254.0).round().astype(np.uint8)
    if mask_land:
        byte[land_mask()] = 255
    return {
        "width": GRID.n_lon,
        "height": GRID.n_lat,
        "min": lo,
        "max": hi,
        "land_value": 255,
        "data": base64.b64encode(byte.tobytes()).decode("ascii"),
    }


def _require_ready() -> None:
    if not ENGINE.ready:
        raise HTTPException(status_code=503, detail=f"engine warming: {ENGINE.status}")


def _route_payload(r: RouteResult, departure: datetime) -> dict:
    return {
        "label": r.label,
        "weights": {"fuel": r.weights[0], "safety": r.weights[1]},
        "path": [[round(la, 3), round(lo, 3)] for la, lo in r.path],
        "fuel_t": round(r.fuel_t, 1),
        "duration_h": round(r.duration_h, 1),
        "duration_days": round(r.duration_h / 24.0, 2),
        "distance_km": round(r.distance_km, 0),
        "distance_nm": round(r.distance_km / 1.852, 0),
        "mean_risk": round(r.mean_risk, 4),
        "peak_risk": round(r.peak_risk, 4),
        "mean_speed_kn": round(r.mean_speed_kn, 2),
        "max_sic": round(r.max_sic, 3),
        "max_thickness_m": round(r.max_thickness, 2),
        "ice_hours": round(r.ice_hours, 1),
        "close_pack_hours": round(r.close_pack_hours, 1),
        "eta": (departure + timedelta(hours=r.duration_h)).isoformat(timespec="minutes"),
        "profile": r.profile,
    }


# ------------------------------------------------------------------ meta

@public.get("/health")
def health() -> dict:
    """Readiness. Public, because the sign-in screen has to know whether the
    engine is up before anyone has a token."""
    return {"ready": ENGINE.ready, "status": ENGINE.status, "timings": ENGINE.timings}


@router.get("/bootstrap")
def bootstrap() -> dict:
    """Everything the client needs before it can draw a single frame."""
    _require_ready()
    snap = ENGINE.snapshot()
    days = [
        {
            "lead": f.lead,
            "valid": f.valid.isoformat(),
            "label": f.valid.strftime("%a %d %b"),
            "kind": "analysis" if f.lead == 0 else "forecast",
        }
        for f in ENGINE.forecasts
    ]
    return {
        "snapshot": snap,
        "atlas": atlas_summary(),
        "coastline": coastline_payload(),
        "days": days,
        "fleet": [v.to_dict() for v in fleet.FLEET],
        "ports": [p.to_dict() for p in stations.PORTS],
        "stations": [p.to_dict() for p in stations.STATIONS],
        "offloads": [p.to_dict() for p in stations.OFFLOAD_POINTS],
        "voyages": [v.to_dict() for v in stations.VOYAGES],
        "layers": [
            {"id": "sic", "label": "Sea-ice concentration", "unit": "fraction",
             "source": "NSIDC passive microwave, forecast by PolarPath"},
            {"id": "thickness", "label": "Ice thickness", "unit": "m",
             "source": "Derived from pack position and season"},
            {"id": "risk", "label": "Navigational risk", "unit": "index",
             "source": "Composite of ice, bergs, power margin and remoteness"},
            {"id": "speed", "label": "Attainable speed", "unit": "fraction of service",
             "source": "Lindqvist resistance with the selected hull"},
            {"id": "bergs", "label": "Iceberg exposure", "unit": "index",
             "source": "Predicted berg positions"},
        ],
    }


# ---------------------------------------------------------------- layers

@router.get("/layer/{name}")
def layer(name: str, day: int = Query(0, ge=0), vessel: str = "golovnin") -> dict:
    _require_ready()
    if name not in LAYER_RANGES:
        raise HTTPException(404, f"unknown layer {name}")
    day = min(day, ENGINE.horizon)
    lo, hi = LAYER_RANGES[name]

    if name == "sic":
        data = ENGINE.forecasts[day].concentration
    elif name == "thickness":
        data = ENGINE.forecasts[day].thickness
    else:
        f = ENGINE.fields(vessel)[day]
        if name == "risk":
            data = f.risk
        elif name == "bergs":
            data = f.berg_exposure
        else:
            data = f.speed_kn / max(fleet.get(vessel).service_speed_kn, 1e-6)

    payload = _encode(data, lo, hi)
    payload["layer"] = name
    payload["day"] = day
    payload["valid"] = ENGINE.forecasts[day].valid.isoformat()
    return payload


@router.get("/vectors")
def vectors(day: int = Query(0, ge=0), stride: int = Query(5, ge=2, le=12)) -> dict:
    """Decimated wind and current vectors for the animated overlay."""
    _require_ready()
    valid = ENGINE.forecasts[min(day, ENGINE.horizon)].valid
    uw, vw = wind_10m(valid)
    uo, vo = surface_current(valid)
    ocean = ~land_mask()

    out_wind, out_current = [], []
    for i in range(0, GRID.n_lat, stride):
        for j in range(0, GRID.n_lon, stride):
            if not ocean[i, j]:
                continue
            lat = GRID.lat_min + i * GRID.lat_step
            lon = GRID.lon_min + j * GRID.lon_step
            out_wind.append([round(lat, 2), round(lon, 2), round(float(uw[i, j]), 2), round(float(vw[i, j]), 2)])
            out_current.append([round(lat, 2), round(lon, 2), round(float(uo[i, j]), 3), round(float(vo[i, j]), 3)])
    return {"day": day, "valid": valid.isoformat(), "wind": out_wind, "current": out_current}


@router.get("/ice-edge")
def ice_edge(day: int = Query(0, ge=0)) -> dict:
    """The 15 percent contour latitude by longitude, for the edge overlay."""
    _require_ready()
    valid = ENGINE.forecasts[min(day, ENGINE.horizon)].valid
    field = ENGINE.forecasts[min(day, ENGINE.horizon)].concentration
    lats = np.linspace(GRID.lat_min, GRID.lat_max, GRID.n_lat)
    edge = []
    for j in range(GRID.n_lon):
        column = field[:, j]
        ice = np.flatnonzero(column >= 0.15)
        lon = GRID.lon_min + j * GRID.lon_step
        edge.append([round(float(lats[ice.max()]), 2) if ice.size else None, round(lon, 2)])
    return {"day": day, "valid": valid.isoformat(),
            "climatology": [round(float(x), 2) for x in ice_edge_latitude(valid)],
            "observed": edge}


# -------------------------------------------------------------- icebergs

@router.get("/icebergs")
def iceberg_positions(day: int = Query(0, ge=0), limit: int = Query(220, ge=1, le=400)) -> dict:
    _require_ready()
    day = min(day, ENGINE.horizon)
    catalogue = {b.id: b for b in icebergs.catalogue()}
    out = []
    for track in ENGINE.berg_tracks[:limit]:
        pos = track["track"][min(day, len(track["track"]) - 1)]
        meta = catalogue.get(track["id"])
        if meta is None:
            continue
        out.append({
            "id": track["id"],
            "lat": round(pos[0], 3),
            "lon": round(pos[1], 3),
            "length_m": round(track["length_m"]),
            "draft_m": round(track["draft_m"], 1),
            "area_km2": round(meta.area_km2, 2),
            "size_class": meta.size_class,
            "named": meta.named,
            "first_seen": meta.first_seen,
        })
    return {"day": day, "count": len(out), "icebergs": out}


@router.get("/icebergs/tracks")
def iceberg_tracks(limit: int = Query(28, ge=1, le=200)) -> dict:
    _require_ready()
    catalogue = {b.id: b for b in icebergs.catalogue()}
    out = []
    for track in ENGINE.berg_tracks[:limit]:
        meta = catalogue.get(track["id"])
        out.append({
            "id": track["id"],
            "named": bool(meta and meta.named),
            "length_m": round(track["length_m"]),
            "draft_m": round(track["draft_m"], 1),
            "area_km2": round(meta.area_km2, 2) if meta else None,
            "size_class": meta.size_class if meta else None,
            "track": [[round(la, 3), round(lo, 3)] for la, lo in track["track"]],
        })
    return {"count": len(out), "tracks": out}


# ----------------------------------------------------------------- routing

class LoginRequest(BaseModel):
    email: str
    password: str


class RouteQuery(BaseModel):
    vessel_id: str = Field(default="golovnin")
    origin_id: str = Field(default="cpt")
    destination_id: str = Field(default="bharati_anchorage")
    departure: date | None = None


@router.post("/route")
def plan_route(q: RouteQuery, user: auth.User = Depends(auth.require_user)) -> dict:
    _require_ready()
    try:
        departure = datetime.combine(q.departure or ENGINE.reference, datetime.min.time())
        result = ENGINE.plan(q.vessel_id, q.origin_id, q.destination_id, departure)
    except KeyError as exc:
        raise HTTPException(400, str(exc)) from exc

    routes = [_route_payload(r, departure) for r in result["routes"]]
    for payload, encounters in zip(routes, result.get("encounters", [])):
        payload["encounters"] = encounters
    if not routes:
        auth.record(
            "passage refused", user.email,
            f'{result["vessel"].name} cannot reach {result["destination"].name} '
            f'in the forecast ice', outcome="blocked",
        )
        raise HTTPException(422, "no navigable route found for this hull and ice state")

    baseline = min(routes, key=lambda r: r["fuel_t"])
    auth.record(
        "passage planned", user.email,
        f'{result["vessel"].name}: {result["origin"].name} to {result["destination"].name}, '
        f'{len(routes)} optimal routes, best {baseline["fuel_t"]} t',
    )
    return {
        "vessel": result["vessel"].to_dict(),
        "origin": result["origin"].to_dict(),
        "destination": result["destination"].to_dict(),
        "departure": departure.isoformat(timespec="minutes"),
        "direct_km": round(result["direct_km"], 0),
        "corridor_cells": result["corridor_cells"],
        "solve_seconds": result["solve_seconds"],
        "routes": routes,
        "reference_fuel_t": baseline["fuel_t"],
    }


@router.get("/point")
def point(lat: float, lon: float, day: int = 0, vessel: str = "golovnin") -> dict:
    """Sounding at one position, for the chart read-out."""
    _require_ready()
    day = min(day, ENGINE.horizon)
    f = ENGINE.forecasts[day]
    fields = ENGINE.fields(vessel)[day]
    i, j = to_index(lat, lon)
    uw, vw = wind_10m(f.valid)
    uo, vo = surface_current(f.valid)
    v = fleet.get(vessel)
    return {
        "lat": lat, "lon": lon, "day": day, "valid": f.valid.isoformat(),
        "land": bool(land_mask()[i, j]),
        "sic": round(float(bilinear(f.concentration, lat, lon)), 3),
        "thickness_m": round(float(bilinear(f.thickness, lat, lon)), 2),
        "risk": round(float(fields.risk[i, j]), 3),
        "berg_exposure": round(float(fields.berg_exposure[i, j]), 3),
        "speed_kn": round(float(fields.speed_kn[i, j]), 2),
        "fuel_kg_per_km": round(float(fields.fuel_kg_per_km[i, j]), 2),
        "passable": bool(fields.passable[i, j]),
        "wind_ms": round(float(np.hypot(bilinear(uw, lat, lon), bilinear(vw, lat, lon))), 1),
        "current_ms": round(float(np.hypot(bilinear(uo, lat, lon), bilinear(vo, lat, lon))), 2),
        "service_speed_kn": v.service_speed_kn,
    }


# ------------------------------------------------------------------ skill

@router.get("/skill")
def skill() -> dict:
    _require_ready()
    return {
        "sea_ice": ENGINE.sea_ice_skill,
        "drift": ENGINE.drift_skill,
        "sea_ice_backend": ENGINE.forecaster.backend_name,
        "iceberg_backend": ENGINE.drift.backend_name,
        "sea_ice_training": ENGINE.forecaster.training_report,
        "iceberg_training": ENGINE.drift.training_report,
    }


@router.get("/capability/{vessel_id}")
def capability(vessel_id: str) -> dict:
    try:
        return rz.describe(fleet.get(vessel_id))
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/benchmark/{voyage_id}")
def benchmark(voyage_id: str) -> dict:
    _require_ready()
    if voyage_id not in stations.VOYAGE_BY_ID:
        raise HTTPException(404, f"unknown voyage {voyage_id}")
    result = ENGINE.benchmark(voyage_id)
    voyage = result["voyage"]
    departure = datetime.combine(voyage.departure, datetime.min.time())

    reported = _route_payload(result["reported"], departure)
    planned = [_route_payload(r, departure) for r in result["planned"]["routes"]]
    if not planned:
        # The hull cannot complete this passage in the forecast ice. That is a
        # decision-support answer in its own right, so it is returned as one.
        return {
            "voyage": voyage.to_dict(),
            "vessel": result["planned"]["vessel"].to_dict(),
            "feasible": False,
            "reported": reported,
            "planned": [],
            "recommended": None,
            "rule": ("No route exists for this hull in the forecast ice. Every corridor "
                     "crossing demands more than the ice class allows, so the passage "
                     "needs a heavier hull, an escort or a later departure."),
            "delta": None,
        }

    # The comparison rule matters more than the headline. Among the optimal
    # routes, take the cheapest one that does not accept more risk than the
    # reported track already did, so the saving is never bought with exposure.
    affordable = [r for r in planned if r["mean_risk"] <= reported["mean_risk"] + 1e-9]
    recommended = min(affordable or planned, key=lambda r: r["fuel_t"])
    risk_constrained = bool(affordable)

    fuel_saved = reported["fuel_t"] - recommended["fuel_t"]
    time_saved = reported["duration_h"] - recommended["duration_h"]

    return {
        "voyage": voyage.to_dict(),
        "vessel": result["planned"]["vessel"].to_dict(),
        "feasible": True,
        "reported": reported,
        "planned": planned,
        "recommended": recommended["label"],
        "risk_constrained": risk_constrained,
        "rule": ("Cheapest optimal route that accepts no more risk than the reported track"
                 if risk_constrained else
                 "No optimal route matched the reported track for risk; the safest is shown"),
        "delta": {
            "fuel_t": round(fuel_saved, 1),
            "fuel_pct": round(100.0 * fuel_saved / max(reported["fuel_t"], 1e-9), 1),
            "duration_h": round(time_saved, 1),
            "duration_pct": round(100.0 * time_saved / max(reported["duration_h"], 1e-9), 1),
            "risk": round(reported["mean_risk"] - recommended["mean_risk"], 4),
            "distance_km": round(reported["distance_km"] - recommended["distance_km"], 0),
            "co2_t": round(fuel_saved * 3.114, 1),
            "close_pack_hours": round(reported["close_pack_hours"] - recommended["close_pack_hours"], 1),
        },
    }
