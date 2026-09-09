import { riskInk, routeInk } from "../lib/colormap";
import { coord, duration, iceStage, nf, riskLabel } from "../lib/format";
import { LineChart, ParetoPlot } from "./Plot";
import { useConsole } from "../lib/useConsole";
import { downloadPassagePlan, renderPassagePlan } from "../lib/passagePlan";

/** Right rail: the candidate routes and everything about the chosen one. */
export default function RoutePanel() {
  const c = useConsole();
  const plan_ = c.plan;
  const route = c.route;

  if (!plan_ || !route) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>Route candidates</h2>
        </div>
        <div className="empty">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 17c3.5-4.5 6.2-1 9-4.8S18.5 7 21 4" />
            <circle cx="3" cy="17" r="1.8" />
            <circle cx="21" cy="4" r="1.8" />
          </svg>
          <span>{c.planning ? "Optimising the passage" : "Choose a vessel and destination, then compute routes."}</span>
        </div>
      </section>
    );
  }

  const cheapest = Math.min(...plan_.routes.map((r) => r.fuel_t));
  const safest = Math.min(...plan_.routes.map((r) => r.mean_risk));

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Route candidates</h2>
          <span className="spacer" />
          <span className="eyebrow">Pareto set</span>
        </div>
        <div className="panel-body">
          <div className="route-list">
            {plan_.routes.map((r, i) => (
              <button
                key={`${r.label}-${i}`}
                className="route-card"
                aria-pressed={i === c.selectedRoute}
                style={{ ["--accent-color" as string]: routeInk(r.label) }}
                onClick={() => c.setSelectedRoute(i)}
                onMouseEnter={() => c.setHoveredRoute(i)}
                onMouseLeave={() => c.setHoveredRoute(null)}
              >
                <div className="head">
                  <span className="label" style={{ color: routeInk(r.label) }}>
                    {r.label}
                  </span>
                  <span className="weights mono">
                    fuel {nf(r.weights.fuel * 100)} / safety {nf(r.weights.safety * 100)}
                  </span>
                </div>
                <div className="figures">
                  <div>
                    <div className="k">Fuel</div>
                    <div className="v">
                      {nf(r.fuel_t, 1)}
                      <small>t</small>
                      {r.fuel_t > cheapest && (
                        <small style={{ color: "var(--text-4)" }}>
                          {" "}+{nf(r.fuel_t - cheapest, 1)}
                        </small>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="k">Passage</div>
                    <div className="v">{duration(r.duration_h)}</div>
                  </div>
                  <div>
                    <div className="k">Risk</div>
                    <div className="v" style={{ color: riskInk(r.mean_risk) }}>
                      {nf(r.mean_risk, 3)}
                      {r.mean_risk > safest && (
                        <small style={{ color: "var(--text-4)" }}>
                          {" "}+{nf(r.mean_risk - safest, 3)}
                        </small>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Trade-off surface</h2>
        </div>
        <div className="panel-body">
          <ParetoPlot
            height={170}
            selected={c.selectedRoute}
            onSelect={c.setSelectedRoute}
            points={plan_.routes.map((r) => ({
              label: r.label,
              fuel: r.fuel_t,
              risk: r.mean_risk,
              colour: routeInk(r.label),
            }))}
          />
          <p className="note">
            Every point is an optimal answer to a different question. Moving left buys fuel with
            exposure; moving down buys safety with fuel.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{route.label} passage</h2>
          <span className="spacer" />
          <button
            className="btn btn-ghost btn-sm"
            title="Download the full passage plan as a text document"
            onClick={() => {
              const plan = renderPassagePlan({
                route,
                routes: plan_.routes,
                vessel: plan_.vessel,
                origin: plan_.origin,
                destination: plan_.destination,
                departure: plan_.departure,
                analysisDate: c.boot?.snapshot.reference_date ?? "",
                horizonDays: c.boot?.snapshot.horizon_days ?? 14,
              });
              const stamp = plan_.departure.slice(0, 10);
              downloadPassagePlan(
                `passage-plan-${plan_.vessel.id}-${plan_.destination.id}-${stamp}.txt`,
                plan,
              );
            }}
          >
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 1.8v7.4M4.2 6.6 7 9.4l2.8-2.8M2.2 11.6h9.6" />
            </svg>
            Plan
          </button>
        </div>
        <div className="panel-body">
          <div className="stat-grid">
            <div className="stat">
              <div className="k">Fuel burn</div>
              <div className="v">
                {nf(route.fuel_t, 1)}
                <small>t</small>
              </div>
            </div>
            <div className="stat">
              <div className="k">Passage time</div>
              <div className="v">{duration(route.duration_h)}</div>
            </div>
            <div className="stat">
              <div className="k">Distance</div>
              <div className="v">
                {nf(route.distance_nm)}
                <small>nm</small>
              </div>
            </div>
            <div className="stat">
              <div className="k">Mean speed</div>
              <div className="v">
                {nf(route.mean_speed_kn, 1)}
                <small>kn</small>
              </div>
            </div>
            <div className="stat">
              <div className="k">Hours in ice</div>
              <div className="v">{nf(route.ice_hours, 0)}</div>
            </div>
            <div className="stat">
              <div className="k">Heaviest ice</div>
              <div className="v">
                {nf(route.max_thickness_m, 2)}
                <small>m</small>
              </div>
            </div>
          </div>

          <div className="mt-12">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
              <span className="eyebrow">Risk exposure</span>
              <span className="mono" style={{ fontSize: 11.5, color: riskInk(route.mean_risk) }}>
                {riskLabel(route.mean_risk)} · peak {nf(route.peak_risk, 2)}
              </span>
            </div>
            <div className="meter">
              <i
                style={{
                  width: `${Math.min(100, route.peak_risk * 100)}%`,
                  background: riskInk(route.peak_risk),
                }}
              />
            </div>
          </div>

          <div className="kv mt-12">
            <span className="k">Arrival</span>
            <span className="v">
              {new Date(route.eta).toLocaleString("en-GB", {
                weekday: "short",
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <div className="kv">
            <span className="k">Worst ice met</span>
            <span className="v" style={{ fontSize: 11 }}>
              {iceStage(route.max_sic)}
            </span>
          </div>
          <div className="kv">
            <span className="k">Bunker margin</span>
            <span className="v">
              {nf(100 * (1 - route.fuel_t / plan_.vessel.fuel_capacity_t), 0)}%
            </span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Along-track profile</h2>
        </div>
        <div className="panel-body">
          <LineChart
            height={150}
            yMin={0}
            yMax={1}
            xLabel="at"
            xFormat={(v) => `${nf(v / 24, 1)}d`}
            yFormat={(v) => nf(v, 1)}
            series={[
              {
                id: "sic",
                label: "Ice concentration",
                colour: "#7da6ff",
                area: true,
                points: route.profile.map((p) => [p.hour, p.sic]),
              },
              {
                id: "risk",
                label: "Risk",
                colour: "#ff7a66",
                dashed: true,
                points: route.profile.map((p) => [p.hour, p.risk]),
              },
            ]}
          />
          <div className="divider" />
          <LineChart
            height={140}
            yMin={0}
            xLabel="at"
            xFormat={(v) => `${nf(v / 24, 1)}d`}
            yFormat={(v) => nf(v, 0)}
            series={[
              {
                id: "speed",
                label: "Speed over ground, kn",
                colour: "#4fd1a5",
                points: route.profile.map((p) => [p.hour, p.speed_kn]),
              },
              {
                id: "fuel",
                label: "Cumulative fuel, t",
                colour: "#f0b429",
                points: route.profile.map((p) => [p.hour, p.cumulative_fuel_t]),
              },
            ]}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Iceberg watch</h2>
          <span className="spacer" />
          <span className="eyebrow">closest approach</span>
        </div>
        <div className="panel-body">
          {route.encounters && route.encounters.length > 0 ? (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>Berg</th>
                    <th className="num">CPA</th>
                    <th className="num">At</th>
                    <th className="num">Length</th>
                  </tr>
                </thead>
                <tbody>
                  {route.encounters.map((b) => (
                    <tr key={b.id}>
                      <td className="mono" style={{ color: "var(--info)" }}>{b.id}</td>
                      <td
                        className="num"
                        style={{ color: b.cpa_km < 40 ? "var(--bad)" : b.cpa_km < 80 ? "var(--warn)" : undefined }}
                      >
                        {nf(b.cpa_km, 1)} km
                      </td>
                      <td className="num">{duration(b.at_hour)}</td>
                      <td className="num">{nf(b.length_m / 1000, 1)} km</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="note mt-8">
                Each berg is compared against the track at the hour the vessel reaches it, using the
                predicted position for that day rather than where it lies today.
              </p>
            </>
          ) : (
            <p className="note">No tracked berg comes within 140 km of this track.</p>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Waypoints</h2>
          <span className="spacer" />
          <span className="eyebrow">{route.profile.length} legs</span>
        </div>
        <div className="panel-body">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Elapsed</th>
                  <th>Position</th>
                  <th className="num">Ice</th>
                  <th className="num">Kn</th>
                </tr>
              </thead>
              <tbody>
                {route.profile.map((p, i) => (
                  <tr key={i}>
                    <td className="num">{duration(p.hour)}</td>
                    <td className="mono" style={{ fontSize: 10.5 }}>
                      {coord(p.lat, p.lon)}
                    </td>
                    <td className="num" style={{ color: p.sic >= 0.15 ? riskInk(p.risk) : undefined }}>
                      {nf(p.sic, 2)}
                    </td>
                    <td className="num">{nf(p.speed_kn, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
