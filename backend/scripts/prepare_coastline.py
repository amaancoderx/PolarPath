"""Clip Natural Earth land polygons to the Southern Ocean domain.

Run once (network required) to regenerate ``polarpath/assets/southern_land.json``.
The output is checked in so that the application itself never needs the network.

    python backend/scripts/prepare_coastline.py path/to/ne_50m_land.geojson
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from polarpath.config import ASSET_DIR

LAT_LIMIT = -28.0
TOLERANCE = 0.06  # degrees, Douglas-Peucker simplification tolerance


def clip_ring(ring: list[list[float]], limit: float) -> list[list[float]]:
    """Sutherland-Hodgman clip of a ring against the half-plane lat <= limit."""
    out: list[list[float]] = []
    n = len(ring)
    for k in range(n):
        cur = ring[k]
        nxt = ring[(k + 1) % n]
        cur_in = cur[1] <= limit
        nxt_in = nxt[1] <= limit
        if cur_in:
            out.append(cur)
        if cur_in != nxt_in:
            t = (limit - cur[1]) / (nxt[1] - cur[1])
            out.append([cur[0] + t * (nxt[0] - cur[0]), limit])
    return out


def simplify(points: list[list[float]], tol: float) -> list[list[float]]:
    """Iterative Douglas-Peucker so that deep coastlines do not blow the stack."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi <= lo + 1:
            continue
        ax, ay = points[lo]
        bx, by = points[hi]
        dx, dy = bx - ax, by - ay
        norm = (dx * dx + dy * dy) ** 0.5
        best, best_i = -1.0, -1
        for i in range(lo + 1, hi):
            px, py = points[i]
            if norm < 1e-12:
                d = ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best:
                best, best_i = d, i
        if best > tol:
            keep[best_i] = True
            stack.append((lo, best_i))
            stack.append((best_i, hi))
    return [p for p, k in zip(points, keep) if k]


def main(src: str) -> None:
    data = json.loads(Path(src).read_text(encoding="utf-8"))
    rings: list[list[float]] = []

    for feature in data["features"]:
        geom = feature["geometry"]
        polygons = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for polygon in polygons:
            outer = [[float(x), float(y)] for x, y in polygon[0]]
            if min(p[1] for p in outer) > LAT_LIMIT:
                continue
            clipped = clip_ring(outer, LAT_LIMIT)
            if len(clipped) < 4:
                continue
            simplified = simplify(clipped, TOLERANCE)
            if len(simplified) < 4:
                continue
            # Reject slivers that carry no area worth drawing.
            span_lon = max(p[0] for p in simplified) - min(p[0] for p in simplified)
            span_lat = max(p[1] for p in simplified) - min(p[1] for p in simplified)
            if span_lon < 0.25 and span_lat < 0.25:
                continue
            flat: list[float] = []
            for x, y in simplified:
                flat.append(round(x, 3))
                flat.append(round(y, 3))
            rings.append(flat)

    rings.sort(key=len, reverse=True)
    payload = {
        "source": "Natural Earth 1:50m physical land, clipped to lat <= %.0f" % LAT_LIMIT,
        "tolerance_deg": TOLERANCE,
        "rings": rings,
    }
    out = ASSET_DIR / "southern_land.json"
    out.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    total = sum(len(r) // 2 for r in rings)
    print(f"wrote {out} — {len(rings)} rings, {total} vertices, {out.stat().st_size / 1024:.0f} kB")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "ne_50m_land.geojson")
