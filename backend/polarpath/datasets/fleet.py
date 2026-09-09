"""Vessel register.

Every field here feeds either the Lindqvist ice-resistance model or the
propulsion and fuel model, so the register is the single place to change when a
new hull is added. Principal dimensions follow the published particulars of the
vessels used on Indian Antarctic expeditions.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class Vessel:
    id: str
    name: str
    role: str
    operator: str
    ice_class: str
    ice_class_short: str
    length_m: float              # length between perpendiculars
    beam_m: float
    draft_m: float
    displacement_t: float
    installed_power_kw: float    # total propulsion power at the shaft
    service_speed_kn: float      # open-water service speed
    service_power_kw: float      # shaft power at the service speed
    stem_angle_deg: float        # phi, stem rake from the horizontal
    waterline_angle_deg: float   # alpha, waterline entrance angle
    friction_coeff: float        # mu, hull-ice friction
    sfoc_g_per_kwh: float        # specific fuel oil consumption
    propulsive_eff: float        # quasi-propulsive coefficient in ice
    max_level_ice_m: float       # contractual level-ice capability at 3 knots
    hotel_load_kw: float
    fuel_capacity_t: float
    note: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


FLEET: list[Vessel] = [
    Vessel(
        id="golovnin",
        name="MV Vasiliy Golovnin",
        role="Ice-strengthened cargo and personnel carrier",
        operator="Chartered for the Indian Scientific Expedition to Antarctica",
        ice_class="Russian Register UL / equivalent to IACS PC6",
        ice_class_short="UL / PC6",
        length_m=122.0,
        beam_m=19.0,
        draft_m=8.5,
        displacement_t=15200.0,
        installed_power_kw=5880.0,
        service_speed_kn=15.0,
        service_power_kw=4300.0,
        stem_angle_deg=30.0,
        waterline_angle_deg=24.0,
        friction_coeff=0.12,
        sfoc_g_per_kwh=196.0,
        propulsive_eff=0.58,
        max_level_ice_m=0.90,
        hotel_load_kw=520.0,
        fuel_capacity_t=1750.0,
        note="Workhorse of recent Indian resupply legs to Bharati and Maitri",
    ),
    Vessel(
        id="agulhas2",
        name="SA Agulhas II",
        role="Polar supply and research vessel",
        operator="Department of Forestry, Fisheries and the Environment",
        ice_class="DNV Polar Class 5 (ICE-05)",
        ice_class_short="PC5",
        length_m=121.0,
        beam_m=21.7,
        draft_m=7.65,
        displacement_t=12897.0,
        installed_power_kw=9000.0,
        service_speed_kn=14.0,
        service_power_kw=5600.0,
        stem_angle_deg=26.0,
        waterline_angle_deg=21.0,
        friction_coeff=0.10,
        sfoc_g_per_kwh=190.0,
        propulsive_eff=0.62,
        max_level_ice_m=1.00,
        hotel_load_kw=900.0,
        fuel_capacity_t=2400.0,
        note="Diesel-electric, twin 4.5 MW propulsion motors, 1 m level ice at 5 knots",
    ),
    Vessel(
        id="sagarnidhi",
        name="ORV Sagar Nidhi",
        role="Oceanographic research vessel",
        operator="National Institute of Ocean Technology, Ministry of Earth Sciences",
        ice_class="DNV ICE-1A",
        ice_class_short="ICE-1A",
        length_m=94.0,
        beam_m=18.0,
        draft_m=5.4,
        displacement_t=4500.0,
        installed_power_kw=4000.0,
        service_speed_kn=14.5,
        service_power_kw=2600.0,
        stem_angle_deg=34.0,
        waterline_angle_deg=28.0,
        friction_coeff=0.15,
        sfoc_g_per_kwh=200.0,
        propulsive_eff=0.52,
        max_level_ice_m=0.40,
        hotel_load_kw=380.0,
        fuel_capacity_t=1100.0,
        note="Indian-flagged research vessel, first-year ice capability only",
    ),
    Vessel(
        id="prv",
        name="Polar Research Vessel (planned)",
        role="Dedicated Indian polar research and resupply vessel",
        operator="NCPOR, Ministry of Earth Sciences",
        ice_class="IACS Polar Class 4",
        ice_class_short="PC4",
        length_m=118.0,
        beam_m=23.0,
        draft_m=8.0,
        displacement_t=14500.0,
        installed_power_kw=13000.0,
        service_speed_kn=15.0,
        service_power_kw=6800.0,
        stem_angle_deg=22.0,
        waterline_angle_deg=18.0,
        friction_coeff=0.08,
        sfoc_g_per_kwh=185.0,
        propulsive_eff=0.66,
        max_level_ice_m=1.60,
        hotel_load_kw=1100.0,
        fuel_capacity_t=3000.0,
        note="Planning profile used to size future capability against the same routes",
    ),
]

BY_ID = {v.id: v for v in FLEET}


def get(vessel_id: str) -> Vessel:
    if vessel_id not in BY_ID:
        raise KeyError(f"unknown vessel: {vessel_id}")
    return BY_ID[vessel_id]


def default_vessel() -> Vessel:
    return BY_ID["golovnin"]
