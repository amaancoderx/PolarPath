import { useEffect, useState } from "react";
import { api, type CapabilityReport } from "../lib/api";
import { nf } from "../lib/format";
import { LineChart } from "./Plot";
import Select from "./Select";
import { useConsole } from "../lib/useConsole";

/** Left rail: who is sailing, from where, to where, and what that hull can take. */
export default function MissionPanel() {
  const c = useConsole();
  const [capability, setCapability] = useState<CapabilityReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .capability(c.vesselId)
      .then((r) => !cancelled && setCapability(r))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [c.vesselId]);

  if (!c.boot) return null;

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Vessel</h2>
        </div>
        <div className="panel-body">
          <div className="vessel-list">
            {c.boot.fleet.map((v) => (
              <button
                key={v.id}
                className="vessel-card"
                aria-pressed={v.id === c.vesselId}
                onClick={() => c.setVesselId(v.id)}
              >
                <div className="name">
                  {v.name}
                  {v.id === "prv" && <span className="badge">planned</span>}
                </div>
                <div className="meta">
                  <span>{v.ice_class_short}</span>
                  <span>{nf(v.installed_power_kw / 1000, 1)} MW</span>
                  <span>{nf(v.max_level_ice_m, 2)} m ice</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Passage</h2>
        </div>
        <div className="panel-body">
          <div className="field">
            <label htmlFor="origin">Departure port</label>
            <Select
              id="origin"
              ariaLabel="Departure port"
              value={c.originId}
              onChange={c.setOriginId}
              options={c.boot.ports.map((p) => ({
                value: p.id,
                label: p.name,
                hint: p.operator.split(",")[0],
              }))}
            />
          </div>

          <div className="field">
            <label htmlFor="destination">Destination</label>
            <Select
              id="destination"
              ariaLabel="Destination"
              value={c.destinationId}
              onChange={c.setDestinationId}
              options={[
                ...c.boot.offloads.map((p) => ({
                  value: p.id,
                  label: p.name,
                  group: "Indian offload points",
                  hint: "NCPOR",
                })),
                ...c.boot.stations
                  .filter((s) => s.id !== "dg")
                  .map((p) => ({
                    value: p.id,
                    label: p.name,
                    group: "Antarctic stations",
                    hint: p.operator.split(",")[0],
                  })),
              ]}
            />
          </div>

          <div className="field">
            <label htmlFor="departure">Departure</label>
            <input
              id="departure"
              className="control"
              value={new Date(c.boot.snapshot.reference_date).toLocaleDateString("en-GB", {
                weekday: "short",
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              readOnly
              title="The prototype plans from the analysis date of the loaded forecast cycle"
            />
          </div>

          <button
            className="btn btn-primary mt-8"
            onClick={() => void c.runPlan()}
            disabled={c.planning}
          >
            {c.planning ? (
              <>
                <svg className="spin" width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5.4" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.6" />
                  <path d="M12.4 7A5.4 5.4 0 0 0 7 1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                Optimising
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1.8 9.6c2-2.6 3.6-.6 5.2-2.8s3.4-.4 5.2-3.4" />
                  <circle cx="1.8" cy="9.6" r="1.1" fill="currentColor" stroke="none" />
                  <circle cx="12.2" cy="3.4" r="1.1" fill="currentColor" stroke="none" />
                </svg>
                Compute routes
              </>
            )}
          </button>

          {c.planError && (
            <div
              className="mt-8"
              style={{
                padding: "9px 11px",
                borderRadius: "var(--r-sm)",
                border: "1px solid rgba(255,107,107,0.3)",
                background: "rgba(255,107,107,0.07)",
              }}
            >
              <div
                className="row gap-4"
                style={{ color: "var(--bad)", fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                  <circle cx="7" cy="7" r="5.6" />
                  <path d="M7 4.2v3.4M7 9.6v.5" />
                </svg>
                No feasible passage
              </div>
              <p className="note" style={{ margin: 0 }}>
                {c.vessel?.name} is classed for {c.vessel?.max_level_ice_m.toFixed(2)} m of level
                ice. Every crossing of this corridor demands more than that, so the leg needs a
                heavier hull, an escort or a later departure.
              </p>
            </div>
          )}
          {c.plan && !c.planError && (
            <p className="note mt-8">
              {c.plan.routes.length} non-dominated routes over{" "}
              <span className="mono">{nf(c.plan.corridor_cells)}</span> corridor cells in{" "}
              <span className="mono">{nf(c.plan.solve_seconds, 2)} s</span>.
            </p>
          )}
        </div>
      </section>

      {c.vessel && (
        <section className="panel">
          <div className="panel-head">
            <h2>Hull particulars</h2>
          </div>
          <div className="panel-body">
            <div className="kv">
              <span className="k">Ice class</span>
              <span className="v" style={{ fontSize: 11 }}>
                {c.vessel.ice_class}
              </span>
            </div>
            <div className="kv">
              <span className="k">Length and beam</span>
              <span className="v">
                {nf(c.vessel.length_m, 0)} × {nf(c.vessel.beam_m, 1)} m
              </span>
            </div>
            <div className="kv">
              <span className="k">Draft</span>
              <span className="v">{nf(c.vessel.draft_m, 2)} m</span>
            </div>
            <div className="kv">
              <span className="k">Displacement</span>
              <span className="v">{nf(c.vessel.displacement_t)} t</span>
            </div>
            <div className="kv">
              <span className="k">Installed power</span>
              <span className="v">{nf(c.vessel.installed_power_kw)} kW</span>
            </div>
            <div className="kv">
              <span className="k">Service speed</span>
              <span className="v">{nf(c.vessel.service_speed_kn, 1)} kn</span>
            </div>
            <div className="kv">
              <span className="k">Bunker capacity</span>
              <span className="v">{nf(c.vessel.fuel_capacity_t)} t</span>
            </div>
            <p className="note mt-8">{c.vessel.note}</p>
          </div>
        </section>
      )}

      {capability && (
        <section className="panel">
          <div className="panel-head">
            <h2>Speed in level ice</h2>
          </div>
          <div className="panel-body">
            <LineChart
              height={132}
              legend={false}
              yMin={0}
              series={[
                {
                  id: "speed",
                  label: "Attainable speed",
                  colour: "#7da6ff",
                  area: true,
                  points: capability.curve.map((p) => [p.thickness_m, p.speed_kn]),
                },
              ]}
              xFormat={(v) => `${nf(v, 1)}m`}
              yFormat={(v) => `${nf(v, 0)}kn`}
            />
            <p className="note">
              Solved from the Lindqvist resistance model at full ice cover, capped by installed
              power with a 15 percent sea margin.
            </p>
          </div>
        </section>
      )}
    </>
  );
}
