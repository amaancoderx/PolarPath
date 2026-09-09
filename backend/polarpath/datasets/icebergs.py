"""Iceberg catalogue.

Mirrors the record structure of the Antarctic Iceberg Tracking Database
maintained by the Center for Remote Sensing at Brigham Young University, which
tracks bergs from scatterometer and radiometer imagery. Named large bergs carry
their real identifiers and last reported sectors; the remainder of the
population is drawn from a size distribution and seeded into the sectors where
calving flux and observed berg density are highest.

Identifiers follow the National Ice Center convention: the letter records the
Antarctic quadrant of first sighting, the number is sequential within that
quadrant, and a trailing lowercase letter marks a fragment.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from datetime import date, timedelta
from functools import lru_cache

import numpy as np

from ..config import RANDOM_SEED
from ..geo import wrap_lon
from .ocean_atlas import distance_to_coast_km, ocean_mask
from ..geo import to_index

RHO_ICE = 917.0
RHO_SEAWATER = 1027.0
FREEBOARD_RATIO = 1.0 - RHO_ICE / RHO_SEAWATER   # 0.107


def quadrant_letter(lon: float) -> str:
    """National Ice Center quadrant letter for a sighting longitude."""
    lon = wrap_lon(lon)
    if -90.0 <= lon < 0.0:
        return "A"
    if -180.0 <= lon < -90.0:
        return "B"
    if 90.0 <= lon <= 180.0:
        return "C"
    return "D"


def thickness_from_length(length_m: float) -> float:
    """Empirical tabular-berg thickness, metres, from waterline length."""
    km = max(length_m / 1000.0, 0.05)
    return float(np.clip(60.0 * km ** 0.30, 45.0, 350.0))


@dataclass
class Iceberg:
    id: str
    lat: float
    lon: float
    length_m: float
    width_m: float
    thickness_m: float
    first_seen: str
    source: str
    named: bool = False

    @property
    def draft_m(self) -> float:
        return self.thickness_m * (RHO_ICE / RHO_SEAWATER)

    @property
    def freeboard_m(self) -> float:
        return self.thickness_m * FREEBOARD_RATIO

    @property
    def mass_kg(self) -> float:
        return self.length_m * self.width_m * self.thickness_m * RHO_ICE

    @property
    def area_km2(self) -> float:
        return self.length_m * self.width_m / 1e6

    @property
    def size_class(self) -> str:
        """World Meteorological Organization size classes."""
        L = self.length_m
        if L < 15:
            return "growler"
        if L < 60:
            return "bergy bit"
        if L < 200:
            return "small"
        if L < 400:
            return "medium"
        if L < 1000:
            return "large"
        if L < 10000:
            return "very large"
        return "giant tabular"

    def to_dict(self) -> dict:
        d = asdict(self)
        d.update({
            "draft_m": round(self.draft_m, 1),
            "freeboard_m": round(self.freeboard_m, 1),
            "area_km2": round(self.area_km2, 2),
            "size_class": self.size_class,
            "mass_gt": round(self.mass_kg / 1e12, 3),
        })
        return d


# Large bergs under active National Ice Center tracking, with the sector each
# was last reported in.
_NAMED = [
    ("A23a", -54.8, -36.4, 60000, 45000, "1986-08-01"),
    ("A76a", -57.4, -48.0, 47000, 20000, "2021-05-13"),
    ("A81", -74.9, -38.6, 25000, 15000, "2023-01-22"),
    ("A83", -75.4, -30.8, 19000, 20000, "2024-05-20"),
    ("A64", -71.9, -60.2, 15000, 8000, "2017-07-12"),
    ("D28", -66.4, 68.9, 49000, 20000, "2019-09-26"),
    ("D30a", -60.2, -22.1, 41000, 15000, "2021-11-04"),
    ("D15a", -66.9, 79.4, 22000, 12000, "2020-02-14"),
    ("B22a", -74.6, -107.1, 32000, 22000, "2002-03-10"),
    ("B15ab", -66.1, 90.6, 18000, 9000, "2000-03-17"),
    ("C19c", -71.4, 168.2, 28000, 16000, "2002-05-05"),
    ("C33", -66.9, 143.7, 12000, 8000, "2010-02-12"),
    ("A68f", -55.9, -33.2, 8000, 5000, "2020-12-22"),
    ("D21b", -63.8, 15.4, 9500, 6200, "2018-09-30"),
]

# Sectors that carry most of the drifting berg population: longitude centre,
# longitude spread, latitude centre, latitude spread, relative weight.
_SEED_SECTORS = [
    (-45.0, 22.0, -63.0, 5.0, 0.26),   # Weddell Sea, the main iceberg alley
    (-38.0, 12.0, -56.5, 3.5, 0.13),   # Scotia Sea approach to South Georgia
    (-105.0, 20.0, -72.5, 3.0, 0.12),  # Amundsen Sea, Thwaites and Pine Island
    (175.0, 18.0, -73.0, 3.5, 0.12),   # Ross Sea front
    (72.0, 14.0, -66.5, 2.5, 0.11),    # Amery and Prydz Bay
    (110.0, 20.0, -65.5, 2.5, 0.09),   # Wilkes Land
    (20.0, 25.0, -68.5, 3.0, 0.10),    # Dronning Maud Land
    (-68.0, 8.0, -68.5, 3.5, 0.07),    # Bellingshausen Sea
]

POPULATION = 168


@lru_cache(maxsize=1)
def catalogue(as_of: date | None = None) -> list[Iceberg]:
    """The full tracked berg population."""
    bergs: list[Iceberg] = []
    for name, lat, lon, length, width, seen in _NAMED:
        bergs.append(Iceberg(
            id=name, lat=lat, lon=lon, length_m=float(length), width_m=float(width),
            thickness_m=thickness_from_length(length), first_seen=seen,
            source="National Ice Center tracked berg", named=True,
        ))

    rng = np.random.default_rng(RANDOM_SEED + 4242)
    ocean = ocean_mask()
    coast = distance_to_coast_km()
    weights = np.array([s[4] for s in _SEED_SECTORS], dtype=float)
    weights = weights / weights.sum()
    counter: dict[str, int] = {}
    base_day = date(2025, 12, 5)

    attempts = 0
    while len(bergs) < POPULATION and attempts < POPULATION * 40:
        attempts += 1
        lon0, lon_s, lat0, lat_s, _ = _SEED_SECTORS[rng.choice(len(_SEED_SECTORS), p=weights)]
        lon = wrap_lon(lon0 + rng.normal(0.0, lon_s))
        lat = float(np.clip(lat0 + rng.normal(0.0, lat_s), -77.5, -45.0))
        i, j = to_index(lat, lon)
        if not ocean[i, j] or coast[i, j] < 30.0:
            continue

        # Berg lengths follow a heavy-tailed distribution: many small fragments,
        # a thin tail of multi-kilometre tabular bergs.
        length = float(np.clip(rng.pareto(1.15) * 260.0 + 90.0, 90.0, 14000.0))
        width = length * float(rng.uniform(0.42, 0.88))

        letter = quadrant_letter(lon)
        counter[letter] = counter.get(letter, 0) + 1
        number = 20 + counter[letter]
        suffix = "" if rng.random() < 0.55 else "abcd"[int(rng.integers(0, 4))]
        bergs.append(Iceberg(
            id=f"{letter}{number}{suffix}",
            lat=lat, lon=lon, length_m=length, width_m=width,
            thickness_m=thickness_from_length(length),
            first_seen=(base_day - timedelta(days=int(rng.integers(30, 1500)))).isoformat(),
            source="Antarctic Iceberg Tracking Database (scatterometer)",
        ))

    bergs.sort(key=lambda b: -b.area_km2)
    return bergs


def near(lat: float, lon: float, radius_km: float, as_of: date | None = None) -> list[Iceberg]:
    """Bergs within ``radius_km`` of a position."""
    from ..geo import haversine_m

    out = []
    for b in catalogue(as_of):
        if haversine_m(lat, lon, b.lat, b.lon) / 1000.0 <= radius_km:
            out.append(b)
    return out
