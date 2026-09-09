"""Time-dependent multi-objective route optimisation.

The search runs on a 16-connected lattice restricted to an ellipse around the
direct track, which keeps the graph small enough to explore many objective
weightings in a fraction of a second while still allowing a thirty percent
detour.

Three things make this more than a shortest-path demonstration:

  * **Cost comes from the physics.** Each edge is priced with the attainable
    speed and fuel burn that the Lindqvist resistance model gives for the ice
    the vessel will actually meet, not with a penalty invented for the ice
    concentration.
  * **The graph is time dependent.** A label carries the hour at which the
    vessel reaches the cell, and the ice field and iceberg positions consulted
    for the next edge are the forecast valid at that hour. A route that arrives
    somewhere in four days is priced against the day-four forecast.
  * **The answer is a Pareto set, not a single line.** The search is repeated
    across a sweep of fuel-versus-safety weightings, dominated outcomes are
    discarded, and the master retains the trade-off rather than a hidden
    compromise chosen for them.
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

import numpy as np

from ..config import CORRIDOR_SLACK, FORECAST_HORIZON, GRID, MAX_CORRIDOR_CELLS, MIN_SPEED_KN
from ..datasets.fleet import Vessel
from ..datasets.ocean_atlas import distance_to_coast_km, ocean_mask
from ..geo import axes, haversine_m, to_index, to_position, wrap_lon
from . import resistance as rz

# 16-way connectivity. The knight moves give the router eight extra headings,
# which removes the diagonal staircase that 8-connected grids produce.
NEIGHBOUR_OFFSETS = [
    (-1, 0), (1, 0), (0, -1), (0, 1),
    (-1, -1), (-1, 1), (1, -1), (1, 1),
    (-1, -2), (-1, 2), (1, -2), (1, 2),
    (-2, -1), (-2, 1), (2, -1), (2, 1),
]

# Objective weightings swept to trace the trade-off surface.
WEIGHT_SWEEP = [
    (1.00, 0.00), (0.92, 0.08), (0.82, 0.18), (0.70, 0.30), (0.58, 0.42),
    (0.45, 0.55), (0.32, 0.68), (0.20, 0.80), (0.10, 0.90), (0.00, 1.00),
]
TIME_WEIGHT = 0.16


@dataclass
class RouteRequest:
    vessel: Vessel
    origin: tuple[float, float]
    destination: tuple[float, float]
    departure: datetime
    origin_name: str = "Origin"
    destination_name: str = "Destination"


@dataclass
class Field:
    """Everything the router needs to know about one forecast day."""

    speed_kn: np.ndarray
    fuel_kg_per_km: np.ndarray
    risk: np.ndarray
    passable: np.ndarray
    sic: np.ndarray
    thickness: np.ndarray
    berg_exposure: np.ndarray


def iceberg_exposure(tracks: list[dict], day: int) -> np.ndarray:
    """Raster of proximity risk from the predicted berg positions on ``day``."""
    lats, lons = axes()
    grid = np.zeros((GRID.n_lat, GRID.n_lon), dtype=np.float32)
    if not tracks:
        return grid

    lat_step, lon_step = GRID.lat_step, GRID.lon_step
    for berg in tracks:
        track = berg["track"]
        pos = track[min(day, len(track) - 1)]
        lat, lon = pos
        # Larger bergs shed more growlers and demand a wider berth.
        radius_km = float(np.clip(28.0 + 0.0022 * berg["length_m"], 30.0, 95.0))
        sigma_lat = max(radius_km / 111.0, lat_step)
        sigma_lon = max(radius_km / (111.0 * max(math.cos(math.radians(lat)), 0.15)), lon_step)

        i0 = int((lat - GRID.lat_min) / lat_step)
        j0 = int((wrap_lon(lon) - GRID.lon_min) / lon_step)
        span_i = int(math.ceil(2.5 * sigma_lat / lat_step))
        span_j = int(math.ceil(2.5 * sigma_lon / lon_step))

        for di in range(-span_i, span_i + 1):
            i = i0 + di
            if not 0 <= i < GRID.n_lat:
                continue
            dlat = (lats[i] - lat) / sigma_lat
            for dj in range(-span_j, span_j + 1):
                j = (j0 + dj) % GRID.n_lon
                dlon = (dj * lon_step) / sigma_lon
                grid[i, j] += math.exp(-0.5 * (dlat * dlat + dlon * dlon))

    return np.clip(grid, 0.0, 1.0)


def risk_index(vessel: Vessel, sic: np.ndarray, thickness: np.ndarray,
               speed: np.ndarray, bergs: np.ndarray) -> np.ndarray:
    """Composite navigational risk in [0, 1].

    The four terms are kept separate and separately weighted so a master can be
    told which of them is driving a number, rather than being handed an opaque
    score.
    """
    ice_severity = np.clip((sic - 0.15) / 0.70, 0.0, 1.0) * np.clip(
        thickness / max(vessel.max_level_ice_m, 0.1), 0.0, 1.4
    )
    ice_severity = np.clip(ice_severity, 0.0, 1.0)

    berg_exposure = np.clip(bergs, 0.0, 1.0)

    margin_deficit = np.clip(1.0 - speed / vessel.service_speed_kn, 0.0, 1.0) ** 1.5

    # Remoteness: a besetting far from open water is a far worse outcome than
    # one a few hours from the ice edge.
    besetting = np.clip((sic - 0.80) / 0.20, 0.0, 1.0) * np.clip(
        distance_to_coast_km() / 900.0, 0.2, 1.0
    )

    total = (0.40 * ice_severity + 0.28 * berg_exposure
             + 0.18 * margin_deficit + 0.14 * besetting)
    return np.clip(total, 0.0, 1.0).astype(np.float32)


def build_fields(vessel: Vessel, forecasts, berg_tracks: list[dict]) -> list[Field]:
    """Turn the forecast cycle into per-day routing fields."""
    fields = []
    ocean = ocean_mask()
    for f in forecasts:
        profile = rz.transit_profile(vessel, f.thickness, f.concentration)
        bergs = iceberg_exposure(berg_tracks, f.lead)
        risk = risk_index(vessel, f.concentration, f.thickness, profile["speed_kn"], bergs)
        fields.append(Field(
            speed_kn=profile["speed_kn"].astype(np.float32),
            fuel_kg_per_km=profile["fuel_kg_per_km"].astype(np.float32),
            risk=risk,
            passable=(profile["passable"] & ocean),
            sic=f.concentration,
            thickness=f.thickness,
            berg_exposure=bergs,
        ))
    return fields


def _snap_to_ocean(lat: float, lon: float, max_ring: int = 6) -> tuple[int, int]:
    """Nearest navigable cell to a position, searched outwards ring by ring."""
    ocean = ocean_mask()
    i0, j0 = to_index(lat, lon)
    if ocean[i0, j0]:
        return i0, j0
    for ring in range(1, max_ring + 1):
        best, best_d = None, 1e18
        for di in range(-ring, ring + 1):
            for dj in range(-ring, ring + 1):
                if max(abs(di), abs(dj)) != ring:
                    continue
                i, j = i0 + di, (j0 + dj) % GRID.n_lon
                if not 0 <= i < GRID.n_lat or not ocean[i, j]:
                    continue
                la, lo = to_position(i, j)
                d = haversine_m(lat, lon, la, lo)
                if d < best_d:
                    best, best_d = (i, j), d
        if best:
            return best
    raise ValueError(f"no navigable cell near {lat:.2f}, {lon:.2f}")


class Corridor:
    """The subset of the grid the search is allowed to visit."""

    def __init__(self, start: tuple[int, int], goal: tuple[int, int], slack: float = CORRIDOR_SLACK):
        lats, lons = axes()
        lat2d = np.repeat(lats[:, None], GRID.n_lon, axis=1)
        lon2d = np.repeat(lons[None, :], GRID.n_lat, axis=0)

        s_lat, s_lon = to_position(*start)
        g_lat, g_lon = to_position(*goal)
        direct = haversine_m(s_lat, s_lon, g_lat, g_lon)
        d_start = haversine_m(s_lat, s_lon, lat2d, lon2d)
        d_goal = haversine_m(g_lat, g_lon, lat2d, lon2d)

        # Widest corridor that still fits the cell budget. A long leg gets a
        # tighter relative detour allowance, which is also the right trade: the
        # scope for a useful diversion is set by the ice, not by the distance.
        ocean = ocean_mask()
        total = d_start + d_goal
        inside = None
        used = slack
        for factor in (slack, 1.22, 1.16, 1.11, 1.07, 1.04):
            margin = max(factor * direct, direct + 700e3)
            candidate = (total <= margin) & ocean
            used = factor
            if int(candidate.sum()) <= MAX_CORRIDOR_CELLS:
                inside = candidate
                break
        if inside is None:
            inside = candidate
        inside[start] = True
        inside[goal] = True
        self.slack = used

        self.mask = inside
        self.direct_m = float(direct)
        self.index = -np.ones((GRID.n_lat, GRID.n_lon), dtype=np.int32)
        cells = np.flatnonzero(inside.ravel())
        self.index.ravel()[cells] = np.arange(cells.size, dtype=np.int32)
        self.cells = cells
        self.size = int(cells.size)

        self.lat = lat2d.ravel()[cells].astype(np.float32)
        self.lon = lon2d.ravel()[cells].astype(np.float32)
        self.to_goal_m = d_goal.ravel()[cells].astype(np.float32)

        self.start = int(self.index[start])
        self.goal = int(self.index[goal])

        # Pre-resolved adjacency in compressed form: one flat array of
        # neighbour ids and one of edge lengths, indexed by an offset table.
        # Lists of tuples cost several times this once a corridor spans a whole
        # ocean basin, and the search loop reads slices with no per-edge object.
        rows = cells // GRID.n_lon
        cols = cells % GRID.n_lon
        sources: list[np.ndarray] = []
        targets: list[np.ndarray] = []
        lengths: list[np.ndarray] = []
        for di, dj in NEIGHBOUR_OFFSETS:
            ni = rows + di
            nj = (cols + dj) % GRID.n_lon
            ok = (ni >= 0) & (ni < GRID.n_lat)
            if not ok.any():
                continue
            src = np.flatnonzero(ok)
            nid = self.index[ni[ok], nj[ok]]
            live = nid >= 0
            src = src[live]
            nid = nid[live]
            n_lat = lat2d[ni[ok][live], nj[ok][live]]
            n_lon = lon2d[ni[ok][live], nj[ok][live]]
            sources.append(src.astype(np.int32))
            targets.append(nid.astype(np.int32))
            lengths.append((haversine_m(self.lat[src], self.lon[src], n_lat, n_lon) / 1000.0)
                           .astype(np.float32))

        src_all = np.concatenate(sources)
        tgt_all = np.concatenate(targets)
        len_all = np.concatenate(lengths)
        order = np.argsort(src_all, kind="stable")
        self.edge_target = tgt_all[order]
        self.edge_km = len_all[order]
        counts = np.bincount(src_all, minlength=self.size)
        self.edge_start = np.zeros(self.size + 1, dtype=np.int64)
        np.cumsum(counts, out=self.edge_start[1:])


@dataclass
class RouteResult:
    label: str
    weights: tuple[float, float]
    cells: list[int]
    path: list[tuple[float, float]]
    fuel_t: float
    duration_h: float
    distance_km: float
    mean_risk: float
    peak_risk: float
    mean_speed_kn: float
    max_sic: float
    max_thickness: float
    ice_hours: float
    close_pack_hours: float
    waypoints: list[dict] = field(default_factory=list)
    profile: list[dict] = field(default_factory=list)


class RoutePlanner:
    """Multi-objective time-dependent planner."""

    def __init__(self, vessel: Vessel, fields: list[Field], departure: datetime):
        self.vessel = vessel
        self.fields = fields
        self.departure = departure
        self.horizon = len(fields) - 1

    # ------------------------------------------------------------------ setup

    def _pack(self, corridor: Corridor):
        """Gather the per-day fields onto the corridor cells."""
        cells = corridor.cells
        n_days = len(self.fields)
        shape = (n_days, corridor.size)
        speed = np.empty(shape, dtype=np.float32)
        fuel = np.empty(shape, dtype=np.float32)
        risk = np.empty(shape, dtype=np.float32)
        passable = np.empty(shape, dtype=bool)
        sic = np.empty(shape, dtype=np.float32)
        thick = np.empty(shape, dtype=np.float32)
        for k, f in enumerate(self.fields):
            speed[k] = f.speed_kn.ravel()[cells]
            fuel[k] = f.fuel_kg_per_km.ravel()[cells]
            risk[k] = f.risk.ravel()[cells]
            passable[k] = f.passable.ravel()[cells]
            sic[k] = f.sic.ravel()[cells]
            thick[k] = f.thickness.ravel()[cells]
        return speed, fuel, risk, passable, sic, thick

    # ----------------------------------------------------------------- search

    def search(self, corridor: Corridor, w_fuel: float, w_risk: float,
               packed=None) -> RouteResult | None:
        speed, fuel, risk, passable, sic, thick = packed or self._pack(corridor)
        v = self.vessel

        # Reference scales make the three objectives commensurate, so the
        # weights mean what they look like they mean.
        direct_km = corridor.direct_m / 1000.0
        open_burn = float(rz.fuel_rate_kg_per_h(v, rz.open_water_power_kw(v, v.service_speed_kn)))
        fuel_ref = max(open_burn / (v.service_speed_kn * 1.852) * direct_km, 1.0)
        time_ref = max(direct_km / (v.service_speed_kn * 1.852), 1.0)
        risk_ref = max(direct_km, 1.0)

        per_km_floor = (w_fuel * (open_burn / (v.service_speed_kn * 1.852)) / fuel_ref
                        + TIME_WEIGHT * (1.0 / (v.service_speed_kn * 1.852)) / time_ref)

        n = corridor.size
        best = np.full(n, np.inf, dtype=np.float64)
        arrive_h = np.zeros(n, dtype=np.float64)
        parent = np.full(n, -1, dtype=np.int32)
        closed = np.zeros(n, dtype=bool)

        start, goal = corridor.start, corridor.goal
        best[start] = 0.0
        heap = [(corridor.to_goal_m[start] / 1000.0 * per_km_floor, 0.0, start)]

        edge_start = corridor.edge_start
        edge_target = corridor.edge_target
        edge_km = corridor.edge_km
        max_day = self.horizon

        while heap:
            _, cost, node = heapq.heappop(heap)
            if closed[node]:
                continue
            closed[node] = True
            if node == goal:
                break

            hour = arrive_h[node]
            day = int(hour // 24.0)
            if day > max_day:
                day = max_day

            for e in range(edge_start[node], edge_start[node + 1]):
                nid = int(edge_target[e])
                if closed[nid] or not passable[day, nid]:
                    continue
                km = edge_km[e]
                v_kn = speed[day, nid]
                if v_kn < MIN_SPEED_KN:
                    continue
                leg_h = float(km) / (float(v_kn) * 1.852)
                leg_fuel = float(fuel[day, nid]) * float(km)
                leg_risk = float(risk[day, nid]) * float(km)

                step = (w_fuel * leg_fuel / fuel_ref
                        + TIME_WEIGHT * leg_h / time_ref
                        + w_risk * leg_risk / risk_ref)
                new_cost = cost + step
                if new_cost < best[nid]:
                    best[nid] = new_cost
                    arrive_h[nid] = hour + leg_h
                    parent[nid] = node
                    priority = new_cost + corridor.to_goal_m[nid] / 1000.0 * per_km_floor
                    heapq.heappush(heap, (priority, new_cost, nid))

        if not np.isfinite(best[goal]):
            return None

        chain = [goal]
        while parent[chain[-1]] >= 0:
            chain.append(int(parent[chain[-1]]))
        chain.reverse()

        return self._summarise(corridor, chain, (w_fuel, w_risk),
                               speed, fuel, risk, sic, thick)

    # ---------------------------------------------------------------- summary

    def _summarise(self, corridor: Corridor, chain: list[int], weights,
                   speed, fuel, risk, sic, thick) -> RouteResult:
        v = self.vessel
        hour = 0.0
        total_fuel = 0.0
        total_km = 0.0
        ice_hours = 0.0
        close_pack_hours = 0.0
        risk_weighted = 0.0
        peak_risk = 0.0
        max_sic = 0.0
        max_thick = 0.0
        profile: list[dict] = []

        path = [(float(corridor.lat[chain[0]]), float(corridor.lon[chain[0]]))]
        day0 = 0
        profile.append({
            "hour": 0.0,
            "lat": path[0][0], "lon": path[0][1],
            "sic": float(sic[day0, chain[0]]),
            "thickness_m": float(thick[day0, chain[0]]),
            "speed_kn": float(speed[day0, chain[0]]),
            "risk": float(risk[day0, chain[0]]),
            "cumulative_fuel_t": 0.0,
            "cumulative_km": 0.0,
        })

        for a, b in zip(chain[:-1], chain[1:]):
            day = min(int(hour // 24.0), self.horizon)
            la, lo = float(corridor.lat[b]), float(corridor.lon[b])
            km = haversine_m(corridor.lat[a], corridor.lon[a], la, lo) / 1000.0
            v_kn = float(speed[day, b])
            leg_h = km / max(v_kn * 1.852, 1e-6)
            leg_fuel = float(fuel[day, b]) * km
            cell_risk = float(risk[day, b])
            cell_sic = float(sic[day, b])

            hour += leg_h
            total_fuel += leg_fuel
            total_km += km
            risk_weighted += cell_risk * km
            peak_risk = max(peak_risk, cell_risk)
            max_sic = max(max_sic, cell_sic)
            max_thick = max(max_thick, float(thick[day, b]))
            if cell_sic >= 0.15:
                ice_hours += leg_h
            if cell_sic >= 0.70:
                close_pack_hours += leg_h

            path.append((la, lo))
            profile.append({
                "hour": round(hour, 2),
                "lat": la, "lon": lo,
                "sic": cell_sic,
                "thickness_m": float(thick[day, b]),
                "speed_kn": v_kn,
                "risk": cell_risk,
                "cumulative_fuel_t": round(total_fuel / 1000.0, 3),
                "cumulative_km": round(total_km, 1),
            })

        mean_risk = risk_weighted / max(total_km, 1e-9)
        mean_speed = total_km / max(hour * 1.852, 1e-9)

        return RouteResult(
            label="",
            weights=weights,
            cells=chain,
            path=path,
            fuel_t=total_fuel / 1000.0,
            duration_h=hour,
            distance_km=total_km,
            mean_risk=mean_risk,
            peak_risk=peak_risk,
            mean_speed_kn=mean_speed,
            max_sic=max_sic,
            max_thickness=max_thick,
            ice_hours=ice_hours,
            close_pack_hours=close_pack_hours,
            profile=_thin(profile, 42),
        )

    # ----------------------------------------------------------------- pareto

    def plan(self, origin: tuple[float, float], destination: tuple[float, float]):
        start = _snap_to_ocean(*origin)
        goal = _snap_to_ocean(*destination)
        corridor = Corridor(start, goal)
        packed = self._pack(corridor)

        sweep = WEIGHT_SWEEP if corridor.size <= 6500 else WEIGHT_SWEEP[::2] + [WEIGHT_SWEEP[-1]]

        found: list[RouteResult] = []
        seen: set[tuple[int, ...]] = set()
        for w_fuel, w_risk in sweep:
            r = self.search(corridor, w_fuel, w_risk, packed)
            if r is None:
                continue
            key = tuple(r.cells)
            if key in seen:
                continue
            seen.add(key)
            found.append(r)

        if not found:
            return [], corridor

        pareto = _pareto_front(found)
        _label(pareto)
        return pareto, corridor


def _thin(rows: list[dict], target: int) -> list[dict]:
    """Keep the endpoints and an even sample in between."""
    if len(rows) <= target:
        return rows
    idx = np.unique(np.linspace(0, len(rows) - 1, target).astype(int))
    return [rows[i] for i in idx]


def _pareto_front(routes: list[RouteResult]) -> list[RouteResult]:
    """Non-dominated routes on fuel, risk exposure and passage time."""
    keep: list[RouteResult] = []
    for r in routes:
        dominated = False
        for other in routes:
            if other is r:
                continue
            better_or_equal = (
                other.fuel_t <= r.fuel_t + 1e-9
                and other.mean_risk <= r.mean_risk + 1e-9
                and other.duration_h <= r.duration_h + 1e-9
            )
            strictly_better = (
                other.fuel_t < r.fuel_t - 1e-9
                or other.mean_risk < r.mean_risk - 1e-9
                or other.duration_h < r.duration_h - 1e-9
            )
            if better_or_equal and strictly_better:
                dominated = True
                break
        if not dominated:
            keep.append(r)
    keep.sort(key=lambda r: r.fuel_t)
    return keep


def _label(routes: list[RouteResult]) -> None:
    """Name the three routes a master actually chooses between."""
    if not routes:
        return
    for r in routes:
        r.label = "Alternative"
    cheapest = min(routes, key=lambda r: r.fuel_t)
    safest = min(routes, key=lambda r: r.mean_risk)
    cheapest.label = "Fuel optimal"
    safest.label = "Safest"
    if len(routes) > 2:
        remaining = [r for r in routes if r.label == "Alternative"]
        if remaining:
            span_f = max(r.fuel_t for r in routes) - min(r.fuel_t for r in routes) or 1.0
            span_r = max(r.mean_risk for r in routes) - min(r.mean_risk for r in routes) or 1.0
            base_f = min(r.fuel_t for r in routes)
            base_r = min(r.mean_risk for r in routes)
            balanced = min(
                remaining,
                key=lambda r: abs((r.fuel_t - base_f) / span_f - (r.mean_risk - base_r) / span_r),
            )
            balanced.label = "Balanced"

    counter = 0
    for r in routes:
        if r.label == "Alternative":
            counter += 1
            r.label = f"Alternative {counter}"


def berg_encounters(route: RouteResult, tracks: list[dict], limit: int = 8,
                    threshold_km: float = 140.0) -> list[dict]:
    """Closest point of approach to each tracked berg along a route.

    This is where the three models meet. The berg positions compared against
    each leg are the ones predicted for the hour the vessel is actually there,
    not the positions they hold today, so a berg drifting into the track is
    caught and one drifting out of it is not flagged.
    """
    if not route.profile or not tracks:
        return []

    hours = np.array([p["hour"] for p in route.profile], dtype=float)
    lat = np.array([p["lat"] for p in route.profile], dtype=float)
    lon = np.array([p["lon"] for p in route.profile], dtype=float)
    day_index = np.clip((hours // 24.0).astype(int), 0, None)

    out = []
    for berg in tracks:
        track = berg["track"]
        last = len(track) - 1
        idx = np.minimum(day_index, last)
        b_lat = np.array([track[k][0] for k in idx], dtype=float)
        b_lon = np.array([track[k][1] for k in idx], dtype=float)
        distance = haversine_m(lat, lon, b_lat, b_lon) / 1000.0
        k = int(np.argmin(distance))
        cpa = float(distance[k])
        if cpa > threshold_km:
            continue
        out.append({
            "id": berg["id"],
            "cpa_km": round(cpa, 1),
            "at_hour": round(float(hours[k]), 1),
            "lat": round(float(track[int(idx[k])][0]), 3),
            "lon": round(float(track[int(idx[k])][1]), 3),
            "length_m": round(float(berg["length_m"])),
            "draft_m": round(float(berg["draft_m"]), 1),
        })

    out.sort(key=lambda r: r["cpa_km"])
    return out[:limit]


def score_track(vessel: Vessel, fields: list[Field], waypoints: list[tuple[float, float]],
                sample_km: float = 55.0) -> RouteResult:
    """Price an externally supplied track through the same cost model.

    Used to benchmark a reported voyage against the optimiser output. The track
    is resampled onto the analysis grid so that both routes are integrated at
    the same resolution and the comparison is like for like.
    """
    from ..geo import great_circle_points

    horizon = len(fields) - 1
    dense: list[tuple[float, float]] = []
    for (a_lat, a_lon), (b_lat, b_lon) in zip(waypoints[:-1], waypoints[1:]):
        seg_km = haversine_m(a_lat, a_lon, b_lat, b_lon) / 1000.0
        n = max(int(seg_km / sample_km) + 1, 2)
        pts = great_circle_points(a_lat, a_lon, b_lat, b_lon, n)
        dense.extend([(float(p[0]), float(p[1])) for p in pts[:-1]])
    dense.append(waypoints[-1])

    hour = 0.0
    total_fuel = 0.0
    total_km = 0.0
    ice_hours = 0.0
    close_pack_hours = 0.0
    risk_weighted = 0.0
    peak_risk = 0.0
    max_sic = 0.0
    max_thick = 0.0
    profile = [{"hour": 0.0, "lat": dense[0][0], "lon": dense[0][1], "sic": 0.0,
                "thickness_m": 0.0, "speed_kn": vessel.service_speed_kn, "risk": 0.0,
                "cumulative_fuel_t": 0.0, "cumulative_km": 0.0}]

    for (a_lat, a_lon), (b_lat, b_lon) in zip(dense[:-1], dense[1:]):
        day = min(int(hour // 24.0), horizon)
        f = fields[day]
        i, j = _snap_to_ocean(b_lat, b_lon)
        km = haversine_m(a_lat, a_lon, b_lat, b_lon) / 1000.0
        v_kn = max(float(f.speed_kn[i, j]), MIN_SPEED_KN)
        leg_h = km / (v_kn * 1.852)
        leg_fuel = float(f.fuel_kg_per_km[i, j]) * km
        cell_risk = float(f.risk[i, j])
        cell_sic = float(f.sic[i, j])

        hour += leg_h
        total_fuel += leg_fuel
        total_km += km
        risk_weighted += cell_risk * km
        peak_risk = max(peak_risk, cell_risk)
        max_sic = max(max_sic, cell_sic)
        max_thick = max(max_thick, float(f.thickness[i, j]))
        if cell_sic >= 0.15:
            ice_hours += leg_h
        if cell_sic >= 0.70:
            close_pack_hours += leg_h
        profile.append({
            "hour": round(hour, 2), "lat": b_lat, "lon": b_lon,
            "sic": cell_sic, "thickness_m": float(f.thickness[i, j]),
            "speed_kn": v_kn, "risk": cell_risk,
            "cumulative_fuel_t": round(total_fuel / 1000.0, 3),
            "cumulative_km": round(total_km, 1),
        })

    return RouteResult(
        label="Reported track",
        weights=(0.0, 0.0),
        cells=[],
        path=dense,
        fuel_t=total_fuel / 1000.0,
        duration_h=hour,
        distance_km=total_km,
        mean_risk=risk_weighted / max(total_km, 1e-9),
        peak_risk=peak_risk,
        mean_speed_kn=total_km / max(hour * 1.852, 1e-9),
        max_sic=max_sic,
        max_thickness=max_thick,
        ice_hours=ice_hours,
        close_pack_hours=close_pack_hours,
        profile=_thin(profile, 42),
    )
