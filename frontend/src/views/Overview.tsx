import { useEffect, useState } from "react";
import { api, type SkillReport } from "../lib/api";
import { nf, pct } from "../lib/format";
import { account } from "../lib/session";
import { useConsole } from "../lib/useConsole";

/**
 * Overview.
 *
 * The page a signed-in user lands on. It answers, in order: what is the ice
 * doing right now, is the forecast any good today, what can each hull reach,
 * and what should I do next. Everything on it is a live read, and each card
 * leads somewhere rather than being decoration.
 */

interface Reach {
  vessel: string;
  short: string;
  capability: number;
  bharati: string;
  maitri: string;
  halley: string;
}

export default function Overview() {
  const c = useConsole();
  const [skill, setSkill] = useState<SkillReport | null>(null);
  const [reach, setReach] = useState<Reach[] | null>(null);
  const user = account();

  useEffect(() => {
    api.skill().then(setSkill).catch(() => undefined);
  }, []);

  // Reachability is computed by actually asking the router, not by a rule of
  // thumb about ice class, so the table cannot disagree with the console.
  useEffect(() => {
    if (!c.boot) return;
    let cancelled = false;
    const run = async () => {
      const out: Reach[] = [];
      for (const v of c.boot!.fleet) {
        const cells: string[] = [];
        for (const dest of ["bharati_anchorage", "maitri_shelf", "hal"]) {
          try {
            const plan = await api.route({
              vessel_id: v.id,
              origin_id: "cpt",
              destination_id: dest,
            });
            const best = plan.routes.reduce((a, b) => (a.fuel_t < b.fuel_t ? a : b));
            cells.push(`${nf(best.fuel_t, 0)} t · ${nf(best.duration_days, 1)} d`);
          } catch {
            cells.push("no passage");
          }
          if (cancelled) return;
        }
        out.push({
          vessel: v.name,
          short: v.ice_class_short,
          capability: v.max_level_ice_m,
          bharati: cells[0],
          maitri: cells[1],
          halley: cells[2],
        });
        if (!cancelled) setReach([...out]);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [c.boot]);

  if (!c.boot) return null;
  const snap = c.boot.snapshot;
  const day7 = skill?.sea_ice.by_lead.find((r) => r.lead_days === 7);
  const berg7 = skill?.drift.by_horizon.find((r) => r.horizon_days === 7);
  const best = c.plan?.routes.reduce((a, b) => (a.fuel_t < b.fuel_t ? a : b));

  return (
    <div className="doc fade-in">
      <div className="doc-inner">
        <div className="ov-head">
          <div>
            <h1>Good day{user ? `, ${user.name.split(" ").slice(-1)[0]}` : ""}</h1>
            <p className="lede" style={{ marginBottom: 0 }}>
              The {new Date(snap.reference_date).toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}{" "}
              analysis is loaded, with a {snap.horizon_days} day forecast on top of it. Everything
              below is read live from the engine.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => c.setTab("operations")}>
            Plan a passage
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 7h9M8 3.5 11.5 7 8 10.5" />
            </svg>
          </button>
        </div>

        <h2>State of the ice</h2>
        <div className="grid-4">
          <div className="card big-stat">
            <div className="k">Sea-ice extent</div>
            <div className="v">
              {nf(snap.ice_extent_km2 / 1e6, 2)}
              <small>M km²</small>
            </div>
            <div className="note">area at or above 15 percent cover</div>
          </div>
          <div className="card big-stat">
            <div className="k">Mean cover where ice is present</div>
            <div className="v">{nf(snap.mean_concentration, 2)}</div>
            <div className="note">first-year pack in retreat</div>
          </div>
          <div className="card big-stat">
            <div className="k">Icebergs under track</div>
            <div className="v">{snap.tracked_bergs}</div>
            <div className="note">each with a {snap.horizon_days} day predicted position</div>
          </div>
          <div className="card big-stat">
            <div className="k">Analysis grid</div>
            <div className="v" style={{ fontSize: 20 }}>
              {snap.grid.n_lat} × {snap.grid.n_lon}
            </div>
            <div className="note">
              {nf(snap.grid.lat_step, 1)}° by {nf(snap.grid.lon_step, 1)}° across the Southern Ocean
            </div>
          </div>
        </div>

        <h2>Is today's forecast any good</h2>
        <div className="grid-3">
          <button className="card big-stat ov-link" onClick={() => c.setTab("skill")}>
            <div className="k">Ice cover error at seven days</div>
            <div className="v">{day7 ? nf(day7.rmse, 3) : "—"}</div>
            <div className="note">
              {day7 ? `against ${nf(day7.rmse_persistence, 3)} for assuming nothing changes` : "loading"}
            </div>
            {day7 && (
              <div className="ov-bar">
                <i style={{ width: `${Math.min(100, day7.skill_vs_persistence * 220)}%` }} />
                <span>{pct(day7.skill_vs_persistence, 0)} better</span>
              </div>
            )}
          </button>
          <button className="card big-stat ov-link" onClick={() => c.setTab("skill")}>
            <div className="k">Ice edge agreement</div>
            <div className="v">{day7 ? pct(day7.ice_edge_accuracy, 1) : "—"}</div>
            <div className="note">forecast and reality agree on where the ice ends</div>
          </button>
          <button className="card big-stat ov-link" onClick={() => c.setTab("skill")}>
            <div className="k">Iceberg position at seven days</div>
            <div className="v">
              {berg7 ? nf(berg7.corrected_mean_km, 1) : "—"}
              <small>km</small>
            </div>
            <div className="note">
              {berg7 ? `from ${nf(berg7.physics_mean_km, 1)} km using physics alone` : "loading"}
            </div>
          </button>
        </div>

        <h2>What each hull can reach from Cape Town</h2>
        <div className="card card-tight">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Vessel</th>
                  <th>Ice class</th>
                  <th className="num">Level ice</th>
                  <th>Bharati</th>
                  <th>Maitri</th>
                  <th>Halley VI</th>
                </tr>
              </thead>
              <tbody>
                {(reach ?? []).map((r) => (
                  <tr key={r.vessel}>
                    <td>{r.vessel}</td>
                    <td className="mono">{r.short}</td>
                    <td className="num">{nf(r.capability, 2)} m</td>
                    {[r.bharati, r.maitri, r.halley].map((cell, i) => (
                      <td
                        key={i}
                        className="mono"
                        style={{
                          color: cell === "no passage" ? "var(--bad)" : "var(--text)",
                          fontSize: 11.5,
                        }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
                {!reach && (
                  <tr>
                    <td colSpan={6} className="muted" style={{ padding: 18 }}>
                      Solving every hull against every station.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: 14 }}>
            <p className="note">
              Each cell is the cheapest optimal passage the router can find for that hull in the
              current forecast, with the lowest fuel and the days it takes. A refusal is a real
              result: the ice on every crossing of that corridor is beyond what the ice class
              allows.
            </p>
          </div>
        </div>

        {c.plan && best && (
          <>
            <h2>Current passage</h2>
            <div className="grid-2">
              <div className="card">
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {c.plan.origin.name} to {c.plan.destination.name}
                  </span>
                  <span className="badge">{c.plan.vessel.ice_class_short}</span>
                </div>
                <div className="kv">
                  <span className="k">Vessel</span>
                  <span className="v" style={{ fontSize: 11.5 }}>{c.plan.vessel.name}</span>
                </div>
                <div className="kv">
                  <span className="k">Optimal routes found</span>
                  <span className="v">{c.plan.routes.length}</span>
                </div>
                <div className="kv">
                  <span className="k">Cheapest passage</span>
                  <span className="v">{nf(best.fuel_t, 1)} t over {nf(best.duration_days, 1)} d</span>
                </div>
                <div className="kv">
                  <span className="k">Search graph</span>
                  <span className="v">{nf(c.plan.corridor_cells)} cells in {nf(c.plan.solve_seconds, 2)} s</span>
                </div>
                <button
                  className="btn btn-ghost mt-12"
                  style={{ width: "100%" }}
                  onClick={() => c.setTab("operations")}
                >
                  Open on the chart
                </button>
              </div>
              <div className="card prose">
                <p>
                  <strong>Where to look next.</strong> The chart carries the forecast ice, the
                  iceberg positions on the day of transit and every optimal route at once. Scrub
                  the timeline to watch the pack move under the track.
                </p>
                <p>
                  <strong>If you have five minutes.</strong> Open the voyage benchmark. A completed
                  resupply leg is replayed against the forecast that was available at departure,
                  with both tracks priced through the same resistance model.
                </p>
                <div className="row mt-12" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => c.setTab("benchmark")}>
                    Voyage benchmark
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => c.setTab("method")}>
                    How it works
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
