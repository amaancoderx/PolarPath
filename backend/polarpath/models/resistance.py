"""Ship-in-ice resistance, attainable speed and fuel consumption.

Ice resistance uses the Lindqvist (1989) decomposition into crushing, bending
and submersion components, each with its own speed correction:

    R_ice(V) = (R_C + R_B) (1 + 1.4 V / sqrt(g h)) + R_S (1 + 9.4 V / sqrt(g L))

Lindqvist's coefficients are dimensional and assume SI units throughout, which
is why the bending term carries a bare 0.003. The formulation is stated for
level ice at full concentration, so a concentration factor and a deformation
factor are applied on top to represent a real pack.

The chain that turns resistance into a routing cost is:

    shaft power  = open-water power + R_ice V / eta_D
    attainable V = largest speed whose shaft power fits inside the sea margin
    fuel rate    = SFOC (propulsion power + hotel load)

Because the attainable speed is solved rather than assumed, a heavy ice field
raises the cost of an edge through both a longer transit and a higher burn,
which is what makes the fuel objective meaningful.

Reference
    Lindqvist, G. (1989). A straightforward method for calculation of ice
    resistance of ships. POAC 89, Lulea, Sweden.
"""
from __future__ import annotations

import math

import numpy as np

from ..datasets.fleet import Vessel

GRAVITY = 9.81
RHO_SEAWATER = 1025.0
RHO_ICE = 917.0
FLEXURAL_STRENGTH_PA = 500e3    # typical first-year Antarctic ice, 500 kPa
SEA_MARGIN = 0.85               # fraction of installed power available at sea
KNOT_MS = 0.5144444


def _hull_angles(vessel: Vessel) -> tuple[float, float, float]:
    """Stem angle phi, waterline entrance angle alpha and the derived psi, radians."""
    phi = math.radians(vessel.stem_angle_deg)
    alpha = math.radians(vessel.waterline_angle_deg)
    psi = math.atan(math.tan(phi) / math.sin(alpha))
    return phi, alpha, psi


def lindqvist_components(vessel: Vessel, thickness_m):
    """Speed-independent crushing, bending and submersion resistance, newtons."""
    h = np.maximum(np.asarray(thickness_m, dtype=float), 0.0)
    phi, alpha, psi = _hull_angles(vessel)
    mu = vessel.friction_coeff
    B, L, T = vessel.beam_m, vessel.length_m, vessel.draft_m
    sigma = FLEXURAL_STRENGTH_PA

    denom = 1.0 - mu * math.sin(phi) / math.cos(psi)
    shape = (math.tan(phi) + mu * math.cos(phi) / math.cos(psi)) / denom

    r_crush = 0.5 * sigma * h ** 2 * shape

    bend_shape = (math.tan(psi) + mu * math.cos(phi) / (math.sin(alpha) * math.cos(psi)))
    r_bend = 0.003 * sigma * B * h ** 1.5 * bend_shape * (1.0 + 1.0 / math.cos(psi))

    buoy = (RHO_SEAWATER - RHO_ICE) * GRAVITY * h
    hydro = T * (B + T) / (B + 2.0 * T)
    friction_path = (
        0.7 * L
        - T / math.tan(phi)
        - B / (4.0 * math.tan(alpha))
        + T * math.cos(phi) * math.cos(psi) * math.sqrt(1.0 / math.sin(phi) ** 2 + 1.0 / math.tan(alpha) ** 2)
    )
    r_submerge = buoy * B * (hydro + mu * max(friction_path, 0.0))

    return r_crush, r_bend, r_submerge


def ice_resistance_n(vessel: Vessel, thickness_m, concentration, speed_kn):
    """Total ice resistance in newtons for a pack of given thickness and cover."""
    h = np.maximum(np.asarray(thickness_m, dtype=float), 0.0)
    c = np.clip(np.asarray(concentration, dtype=float), 0.0, 1.0)
    v = np.maximum(np.asarray(speed_kn, dtype=float), 0.0) * KNOT_MS

    r_c, r_b, r_s = lindqvist_components(vessel, h)
    safe_h = np.maximum(h, 0.05)
    speed_break = 1.0 + 1.4 * v / np.sqrt(GRAVITY * safe_h)
    speed_submerge = 1.0 + 9.4 * v / math.sqrt(GRAVITY * vessel.length_m)

    level = (r_c + r_b) * speed_break + r_s * speed_submerge

    # Lindqvist describes an unbroken level-ice sheet. In a real pack the hull
    # spends part of the time in open leads, so the load falls faster than
    # linearly with concentration.
    cover = c ** 1.6
    return level * cover


def open_water_power_kw(vessel: Vessel, speed_kn):
    """Shaft power in calm open water, from the cubic speed-power law."""
    v = np.maximum(np.asarray(speed_kn, dtype=float), 0.0)
    return vessel.service_power_kw * (v / vessel.service_speed_kn) ** 3


def shaft_power_kw(vessel: Vessel, thickness_m, concentration, speed_kn):
    """Total propulsion power required to hold ``speed_kn`` through the pack."""
    v_ms = np.maximum(np.asarray(speed_kn, dtype=float), 0.0) * KNOT_MS
    r_ice = ice_resistance_n(vessel, thickness_m, concentration, speed_kn)
    ice_power = r_ice * v_ms / (vessel.propulsive_eff * 1000.0)
    return open_water_power_kw(vessel, speed_kn) + ice_power


def attainable_speed_kn(vessel: Vessel, thickness_m, concentration, iterations: int = 28):
    """Fastest speed the installed power can sustain, knots.

    Shaft power rises monotonically with speed for a fixed ice state, so a
    bisection on speed converges quickly and vectorises over the whole grid.
    """
    h = np.asarray(thickness_m, dtype=float)
    c = np.asarray(concentration, dtype=float)
    budget = vessel.installed_power_kw * SEA_MARGIN

    lo = np.zeros(np.broadcast(h, c).shape, dtype=float)
    hi = np.full_like(lo, vessel.service_speed_kn)

    # If the vessel can make service speed here, stop straight away.
    feasible = shaft_power_kw(vessel, h, c, hi) <= budget
    for _ in range(iterations):
        mid = 0.5 * (lo + hi)
        ok = shaft_power_kw(vessel, h, c, mid) <= budget
        lo = np.where(ok, mid, lo)
        hi = np.where(ok, hi, mid)
    speed = np.where(feasible, vessel.service_speed_kn, lo)
    return speed


def fuel_rate_kg_per_h(vessel: Vessel, power_kw):
    """Fuel burn including the hotel load, kilograms per hour."""
    total_kw = np.asarray(power_kw, dtype=float) + vessel.hotel_load_kw
    return total_kw * vessel.sfoc_g_per_kwh / 1000.0


def transit_profile(vessel: Vessel, thickness_m, concentration):
    """Per-cell speed, power and burn, the quantities the router prices edges with.

    Returns a dict of arrays broadcast to the shape of the inputs:
        speed_kn, power_kw, fuel_kg_per_h, fuel_kg_per_km, ice_resistance_kn,
        passable
    """
    h = np.asarray(thickness_m, dtype=float)
    c = np.asarray(concentration, dtype=float)

    speed = attainable_speed_kn(vessel, h, c)
    power = shaft_power_kw(vessel, h, c, speed)
    burn_h = fuel_rate_kg_per_h(vessel, power)
    km_per_h = np.maximum(speed, 1e-6) * 1.852
    burn_km = burn_h / km_per_h
    resistance = ice_resistance_n(vessel, h, c, speed) / 1000.0

    # A hull is stopped either by running out of power or by meeting ice beyond
    # what its class allows it to work in at all.
    from ..config import MIN_SPEED_KN

    # Effective ice load: 1.2 m of ice at nine tenths cover is a wall, the same
    # thickness at three tenths is a field of floes to be pushed aside.
    class_limit = vessel.max_level_ice_m * 2.4
    effective = h * np.sqrt(np.clip(c, 0.0, 1.0))
    beset = (speed < MIN_SPEED_KN) | (effective > class_limit)
    return {
        "speed_kn": speed,
        "power_kw": power,
        "fuel_kg_per_h": burn_h,
        "fuel_kg_per_km": burn_km,
        "ice_resistance_kn": resistance,
        "passable": ~beset,
    }


def describe(vessel: Vessel) -> dict:
    """Capability curve for the vessel, used by the interface and the report."""
    thicknesses = np.array([0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0, 2.5])
    full_cover = np.ones_like(thicknesses)
    speed = attainable_speed_kn(vessel, thicknesses, full_cover)
    power = shaft_power_kw(vessel, thicknesses, full_cover, speed)
    burn = fuel_rate_kg_per_h(vessel, power)
    resistance = ice_resistance_n(vessel, thicknesses, full_cover, speed) / 1000.0
    return {
        "vessel": vessel.to_dict(),
        "curve": [
            {
                "thickness_m": float(t),
                "speed_kn": round(float(s), 2),
                "power_kw": round(float(p), 0),
                "fuel_kg_per_h": round(float(f), 1),
                "ice_resistance_kn": round(float(r), 1),
            }
            for t, s, p, f, r in zip(thicknesses, speed, power, burn, resistance)
        ],
    }
