"""Antarctic stations, resupply ports and the historical voyage used for benchmarking."""
from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import date


@dataclass(frozen=True)
class Place:
    id: str
    name: str
    kind: str              # port | station | offload
    operator: str
    lat: float
    lon: float
    note: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


# Departure ports used by Antarctic resupply and research programmes.
PORTS: list[Place] = [
    Place("cpt", "Cape Town", "port", "Republic of South Africa", -33.906, 18.423,
          "Standard staging port for the Indian Scientific Expedition to Antarctica"),
    Place("hba", "Hobart", "port", "Australia", -42.881, 147.334,
          "Gateway to the East Antarctic and Ross sectors"),
    Place("lyt", "Lyttelton", "port", "New Zealand", -43.603, 172.722,
          "Gateway to the Ross Sea"),
    Place("pun", "Punta Arenas", "port", "Chile", -53.163, -70.917,
          "Gateway to the Antarctic Peninsula"),
]

# Indian stations and their maritime offload points, plus neighbouring stations
# that give the chart geographic context.
STATIONS: list[Place] = [
    Place("bharati", "Bharati", "station", "NCPOR, Ministry of Earth Sciences", -69.407, 76.187,
          "Larsemann Hills, Prydz Bay. Commissioned 2012"),
    Place("maitri", "Maitri", "station", "NCPOR, Ministry of Earth Sciences", -70.766, 11.731,
          "Schirmacher Oasis, Dronning Maud Land. Commissioned 1989"),
    Place("dg", "Dakshin Gangotri", "station", "NCPOR, Ministry of Earth Sciences", -70.083, 12.000,
          "India's first Antarctic base, 1983. Now a supply depot"),
    Place("mcm", "McMurdo", "station", "United States", -77.846, 166.676),
    Place("rot", "Rothera", "station", "United Kingdom", -67.568, -68.127),
    Place("hal", "Halley VI", "station", "United Kingdom", -75.568, -25.507),
    Place("neu", "Neumayer III", "station", "Germany", -70.667, -8.267),
    Place("san", "SANAE IV", "station", "South Africa", -71.673, -2.842),
    Place("tro", "Troll", "station", "Norway", -72.012, 2.535),
    Place("syo", "Syowa", "station", "Japan", -69.006, 39.590),
    Place("maw", "Mawson", "station", "Australia", -67.603, 62.874),
    Place("dav", "Davis", "station", "Australia", -68.576, 77.967),
    Place("cas", "Casey", "station", "Australia", -66.282, 110.527),
    Place("zho", "Zhongshan", "station", "China", -69.373, 76.377),
    Place("mir", "Mirny", "station", "Russian Federation", -66.553, 93.008),
    Place("ddu", "Dumont d'Urville", "station", "France", -66.663, 140.002),
    Place("pal", "Palmer", "station", "United States", -64.774, -64.053),
    Place("bel", "Belgrano II", "station", "Argentina", -77.874, -34.627),
]

# Where a vessel actually stops. Bharati is reached across fast ice in Prydz
# Bay; Maitri is served from the shelf edge on the Princess Astrid Coast.
OFFLOAD_POINTS: list[Place] = [
    Place("bharati_anchorage", "Bharati anchorage", "offload", "NCPOR", -69.150, 76.100,
          "Prydz Bay fast-ice edge, roughly 30 km north of the station"),
    Place("maitri_shelf", "Maitri shelf edge", "offload", "NCPOR", -70.100, 11.500,
          "India Bay ice shelf front, helicopter and convoy transfer to Maitri"),
]

ALL_PLACES: list[Place] = PORTS + STATIONS + OFFLOAD_POINTS
BY_ID = {p.id: p for p in ALL_PLACES}


def get(place_id: str) -> Place:
    if place_id not in BY_ID:
        raise KeyError(f"unknown place: {place_id}")
    return BY_ID[place_id]


def default_origin() -> Place:
    return BY_ID["cpt"]


def default_destination() -> Place:
    return BY_ID["bharati_anchorage"]


@dataclass(frozen=True)
class HistoricalVoyage:
    """A completed resupply leg, replayed to benchmark the router.

    Waypoints are the reported track. The benchmark scores this track through
    exactly the same resistance and fuel model as the optimiser output, so the
    comparison isolates the routing decision rather than the cost model.
    """

    id: str
    label: str
    short_label: str
    vessel_id: str
    origin_id: str
    destination_id: str
    departure: date
    reported_days: float
    waypoints: list[tuple[float, float]]
    note: str

    def to_dict(self) -> dict:
        d = asdict(self)
        d["departure"] = self.departure.isoformat()
        d["waypoints"] = [[lat, lon] for lat, lon in self.waypoints]
        return d


VOYAGES: list[HistoricalVoyage] = [
    HistoricalVoyage(
        id="isea-45-bharati",
        label="Resupply leg, Cape Town to Bharati",
        short_label="Bharati resupply",
        vessel_id="golovnin",
        origin_id="cpt",
        destination_id="bharati_anchorage",
        departure=date(2025, 12, 5),
        reported_days=14.5,
        waypoints=[
            (-33.906, 18.423), (-38.20, 22.60), (-43.10, 28.90), (-47.60, 36.20),
            (-51.40, 44.10), (-54.90, 52.60), (-58.10, 60.40), (-61.20, 66.80),
            (-63.90, 71.20), (-66.10, 73.90), (-67.80, 75.30), (-69.15, 76.10),
        ],
        note="Great-circle track with a standard southerly approach into Prydz Bay",
    ),
    HistoricalVoyage(
        id="isea-45-maitri",
        label="Resupply leg, Cape Town to Maitri shelf edge",
        short_label="Maitri resupply",
        vessel_id="agulhas2",
        origin_id="cpt",
        destination_id="maitri_shelf",
        departure=date(2025, 12, 5),
        reported_days=9.0,
        waypoints=[
            (-33.906, 18.423), (-39.40, 17.40), (-45.10, 16.20), (-50.60, 15.10),
            (-55.80, 14.20), (-60.40, 13.40), (-64.50, 12.80), (-67.60, 12.10),
            (-70.10, 11.50),
        ],
        note="Direct meridional run down the Greenwich meridian corridor",
    ),
]

VOYAGES.append(
    HistoricalVoyage(
        id="sagar-nidhi-transect",
        label="Science transect, Cape Town to Maitri shelf edge",
        short_label="Maitri transect, 1A hull",
        vessel_id="sagarnidhi",
        origin_id="cpt",
        destination_id="maitri_shelf",
        departure=date(2025, 12, 5),
        reported_days=11.0,
        waypoints=[
            (-33.906, 18.423), (-40.10, 16.90), (-46.30, 15.60), (-52.20, 14.60),
            (-57.40, 13.80), (-62.00, 13.10), (-65.80, 12.60), (-68.40, 12.20),
            (-70.10, 11.50),
        ],
        note=("A first-year-ice hull on the same meridional track. With only 0.4 m of "
              "level-ice capability the pack, not the distance, sets the passage"),
    )
)

VOYAGE_BY_ID = {v.id: v for v in VOYAGES}
