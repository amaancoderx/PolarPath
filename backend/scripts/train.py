"""Build every artefact the application needs and print the validation report.

    python backend/scripts/train.py

Safe to re-run: each stage is skipped if its artefact is already on disk.
Delete backend/data/cache and backend/data/artefacts to force a full rebuild.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from polarpath.services.engine import ENGINE


def main() -> None:
    ENGINE.warm(verbose=True)
    snap = ENGINE.snapshot()

    print("\n" + "=" * 74)
    print("  PolarPath model report")
    print("=" * 74)
    print(f"  Reference date      {snap['reference_date']}")
    print(f"  Sea-ice extent      {snap['ice_extent_km2']/1e6:.2f} million km2")
    print(f"  Tracked icebergs    {snap['tracked_bergs']}")
    print(f"  Sea-ice backend     {snap['sea_ice_backend']}")
    print(f"  Iceberg backend     {snap['iceberg_backend']}")

    print("\n  Sea-ice concentration forecast skill")
    print("  " + "-" * 70)
    print("  %-6s %-9s %-13s %-13s %-11s %-8s" % (
        "lead", "RMSE", "persistence", "climatology", "advection", "skill"))
    for r in ENGINE.sea_ice_skill["by_lead"]:
        print("  %-6d %-9.4f %-13.4f %-13.4f %-11.4f %+7.1f%%" % (
            r["lead_days"], r["rmse"], r["rmse_persistence"], r["rmse_climatology"],
            r["rmse_advection"], 100 * r["skill_vs_persistence"]))

    print("\n  Iceberg trajectory error, held-out bergs")
    print("  " + "-" * 70)
    print("  %-10s %-18s %-18s %-12s" % ("horizon", "free drift (km)", "corrected (km)", "improvement"))
    for r in ENGINE.drift_skill["by_horizon"]:
        print("  %-10s %-18.1f %-18.1f %+11.1f%%" % (
            f"{r['horizon_days']} d", r["physics_mean_km"], r["corrected_mean_km"],
            r["improvement_pct"]))

    out = Path(__file__).resolve().parents[1] / "data" / "artefacts" / "validation_report.json"
    out.write_text(json.dumps(
        {"snapshot": snap, "sea_ice": ENGINE.sea_ice_skill, "drift": ENGINE.drift_skill},
        indent=2, default=str), encoding="utf-8")
    print(f"\n  Report written to {out}")
    print("=" * 74)


if __name__ == "__main__":
    main()
