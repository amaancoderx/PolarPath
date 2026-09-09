import { useEffect, useState } from "react";
import { api, type Benchmark as BenchmarkPayload } from "../lib/api";
import { BarCompare, LineChart } from "../components/Plot";
import { riskInk, routeInk } from "../lib/colormap";
import { duration, longDate, nf, signed } from "../lib/format";
import { useConsole } from "../lib/useConsole";

/**
 * Voyage benchmark.
 *
 * The reported track and the optimised route are both priced through the same
 * resistance and fuel model, so the difference isolates the routing decision
 * rather than flattering the cost model. That is the point a reviewer will
 * press on, so the comparison rule is stated on the page rather than implied.
 */

function VoyagePicker({
  voyages,
  current,
  onPick,
}: {
  voyages: { id: string; label: string; short_label: string }[];
  current: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="row" style={{ marginBottom: 20, gap: 8 }}>
      <div className="segmented" style={{ background: "var(--surface-sunken)" }}>
        {voyages.map((v) => (
          <button key={v.id} aria-pressed={v.id === current} onClick={() => onPick(v.id)}>
            {v.short_label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Benchmark() {
  const c = useConsole();
  const [voyageId, setVoyageId] = useState("isea-45-bharati");
  const [data, setData] = useState<BenchmarkPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .benchmark(voyageId)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [voyageId]);

  const voyages = c.boot?.voyages ?? [];

  if (error) {
    return (
      <div className="doc">
        <div className="doc-inner">
          <h1>Voyage benchmark</h1>
          <p className="note">Benchmark unavailable: {error}</p>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="doc">
        <div className="doc-inner">
          <h1>Voyage benchmark</h1>
          <VoyagePicker voyages={voyages} current={voyageId} onPick={setVoyageId} />
          <p className="note">Scoring the reported track and re-optimising the passage.</p>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------- passage not possible */

  if (!data.feasible || !data.delta || !data.recommended) {
    return (
      <div className="doc fade-in">
        <div className="doc-inner">
          <h1>Voyage benchmark</h1>
          <p className="lede">
            {data.voyage.label}, {data.vessel.name}.
          </p>
          <VoyagePicker voyages={voyages} current={voyageId} onPick={setVoyageId} />

          <div className="card" style={{ borderColor: "rgba(255,107,107,0.3)" }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <span
                className="badge"
                style={{ background: "rgba(255,107,107,0.16)", color: "var(--bad)" }}
              >
                no feasible passage
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                {data.vessel.name} cannot complete this leg in the forecast ice
              </span>
            </div>
            <p className="prose">{data.rule}</p>
            <div className="divider" />
            <div className="grid-3">
              <div>
                <div className="eyebrow">Ice class</div>
                <div className="mono mt-8" style={{ fontSize: 12 }}>
                  {data.vessel.ice_class}
                </div>
              </div>
              <div>
                <div className="eyebrow">Level-ice capability</div>
                <div className="mono mt-8" style={{ fontSize: 12 }}>
                  {nf(data.vessel.max_level_ice_m, 2)} m
                </div>
              </div>
              <div>
                <div className="eyebrow">Heaviest ice on the reported track</div>
                <div className="mono mt-8" style={{ fontSize: 12 }}>
                  {nf(data.reported.max_thickness_m, 2)} m at {nf(data.reported.max_sic, 2)} cover
                </div>
              </div>
            </div>
          </div>

          <div className="card mt-16 prose">
            <p>
              <strong>Why this matters.</strong> A planner that only ever draws a line on a chart
              cannot say this. The passage is refused because every crossing of the corridor demands
              more of the hull than its class allows, which is the answer an operator needs before a
              season is committed to a vessel, not after it is beset.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------- benchmark */

  const recommended =
    data.planned.find((r) => r.label === data.recommended) ?? data.planned[0];
  const saved = data.delta.fuel_t;
  const pick = "var(--accent)";
  const material = saved > 0.5;
  const named = data.planned.filter((r) => !r.label.startsWith("Alternative"));

  return (
    <div className="doc fade-in">
      <div className="doc-inner">
        <h1>Voyage benchmark</h1>
        <p className="lede">
          A completed resupply leg replayed against the forecast that was available at departure.
          The reported track and the optimised route are scored through the same Lindqvist
          resistance model, the same fuel curve and the same ice fields, so the difference between
          them is the routing decision and nothing else.
        </p>

        <VoyagePicker voyages={voyages} current={voyageId} onPick={setVoyageId} />

        <div className="grid-4">
          <div className="card big-stat">
            <div className="k">{material ? "Fuel saved" : "Fuel difference"}</div>
            <div className="v" style={{ color: material ? "var(--good)" : "var(--text-2)" }}>
              {signed(saved, 1)}
              <small>t</small>
            </div>
            <div className="note">
              {material
                ? `${nf(Math.abs(data.delta.fuel_pct), 1)} percent of the reported burn`
                : "the reported track was already close to optimal"}
            </div>
          </div>
          <div className="card big-stat">
            <div className="k">Passage time</div>
            <div
              className="v"
              style={{ color: data.delta.duration_h > 0.5 ? "var(--good)" : "var(--text-2)" }}
            >
              {signed(data.delta.duration_h, 1)}
              <small>h</small>
            </div>
            <div className="note">{nf(Math.abs(data.delta.duration_pct), 1)} percent change</div>
          </div>
          <div className="card big-stat">
            <div className="k">Risk exposure</div>
            <div
              className="v"
              style={{ color: data.delta.risk >= 0 ? "var(--good)" : "var(--warn)" }}
            >
              {signed(data.delta.risk, 3)}
            </div>
            <div className="note">mean along-track risk, held at or below the reported track</div>
          </div>
          <div className="card big-stat">
            <div className="k">Close pack avoided</div>
            <div
              className="v"
              style={{ color: data.delta.close_pack_hours > 0.5 ? "var(--good)" : "var(--text-2)" }}
            >
              {signed(data.delta.close_pack_hours, 0)}
              <small>h</small>
            </div>
            <div className="note">
              hours at or above 70 percent cover · {signed(data.delta.co2_t, 1)} t CO₂
            </div>
          </div>
        </div>

        <div className="card mt-16" style={{ borderColor: "var(--accent-line)" }}>
          <div className="row gap-4" style={{ alignItems: "flex-start" }}>
            <span
              className="badge"
              style={{ background: "var(--accent-soft)", color: "var(--accent)", flex: "none" }}
            >
              comparison rule
            </span>
            <p className="note" style={{ margin: 0, flex: 1 }}>
              {data.rule}. Both tracks are resampled onto the analysis grid and integrated through
              the identical speed, resistance and fuel solution, so nothing in the difference comes
              from the cost model.
            </p>
          </div>
        </div>

        <h2>Reported track against the optimiser</h2>
        <div className="grid-2">
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Fuel against the reported track
            </div>
            <BarCompare
              format={(v) => `${nf(v, 1)} t`}
              baseline={Math.min(data.reported.fuel_t, ...data.planned.map((r) => r.fuel_t)) - 2}
              rows={[
                {
                  label: "Reported track",
                  value: data.reported.fuel_t,
                  colour: routeInk("Reported track"),
                },
                ...named.map((r) => ({
                  label: `${r.label} route`,
                  value: r.fuel_t,
                  colour: r.label === data.recommended ? pick : routeInk(r.label),
                  note: `${signed(data.reported.fuel_t - r.fuel_t, 1)} t`,
                })),
                ...(named.some((r) => r.label === data.recommended)
                  ? []
                  : [
                      {
                        label: `${recommended.label} (selected)`,
                        value: recommended.fuel_t,
                        colour: pick,
                        note: `${signed(data.reported.fuel_t - recommended.fuel_t, 1)} t`,
                      },
                    ]),
              ]}
            />
            <p className="note mt-8">
              Bars start just below the cheapest option so a two percent difference is visible.
              The figures beside them are the full values.
            </p>
            <div className="divider" />
            <table className="table">
              <thead>
                <tr>
                  <th>Option</th>
                  <th className="num">Fuel</th>
                  <th className="num">Time</th>
                  <th className="num">Risk</th>
                  <th className="num">In ice</th>
                  <th className="num">Close pack</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ color: routeInk("Reported track") }}>Reported track</td>
                  <td className="num">{nf(data.reported.fuel_t, 1)} t</td>
                  <td className="num">{duration(data.reported.duration_h)}</td>
                  <td className="num" style={{ color: riskInk(data.reported.mean_risk) }}>
                    {nf(data.reported.mean_risk, 3)}
                  </td>
                  <td className="num">{nf(data.reported.ice_hours, 0)} h</td>
                  <td className="num">{nf(data.reported.close_pack_hours, 0)} h</td>
                </tr>
                {data.planned.map((r) => (
                  <tr key={r.label}>
                    <td style={{ color: r.label === data.recommended ? pick : routeInk(r.label) }}>
                      {r.label}
                      {r.label === data.recommended && (
                        <span className="badge" style={{ marginLeft: 6 }}>
                          selected
                        </span>
                      )}
                    </td>
                    <td className="num">{nf(r.fuel_t, 1)} t</td>
                    <td className="num">{duration(r.duration_h)}</td>
                    <td className="num" style={{ color: riskInk(r.mean_risk) }}>
                      {nf(r.mean_risk, 3)}
                    </td>
                    <td className="num">{nf(r.ice_hours, 0)} h</td>
                    <td className="num">{nf(r.close_pack_hours, 0)} h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <LineChart
              height={210}
              yMin={0}
              xLabel="elapsed"
              xTicks={[0, 48, 96, 144, 192]}
              xFormat={(v) => `${nf(v / 24, 0)}d`}
              yFormat={(v) => `${nf(v, 0)}t`}
              series={[
                {
                  id: "reported",
                  label: "Reported track",
                  colour: routeInk("Reported track"),
                  dashed: true,
                  points: data.reported.profile.map((p) => [p.hour, p.cumulative_fuel_t]),
                },
                {
                  id: "planned",
                  label: "PolarPath recommendation",
                  colour: pick,
                  width: 2.4,
                  area: true,
                  points: recommended.profile.map((p) => [p.hour, p.cumulative_fuel_t]),
                },
              ]}
            />
            <p className="note mt-8">
              Cumulative fuel burn. The curves separate where one track crosses heavier ice than the
              other for the speed it buys.
            </p>
            <div className="divider" />
            <LineChart
              height={190}
              yMin={0}
              yMax={1}
              xLabel="elapsed"
              xTicks={[0, 48, 96, 144, 192]}
              xFormat={(v) => `${nf(v / 24, 0)}d`}
              yFormat={(v) => nf(v, 1)}
              series={[
                {
                  id: "reported-ice",
                  label: "Reported ice cover",
                  colour: routeInk("Reported track"),
                  dashed: true,
                  points: data.reported.profile.map((p) => [p.hour, p.sic]),
                },
                {
                  id: "planned-ice",
                  label: "Optimised ice cover",
                  colour: pick,
                  points: recommended.profile.map((p) => [p.hour, p.sic]),
                },
              ]}
            />
          </div>
        </div>

        <h2>Voyage particulars</h2>
        <div className="grid-3">
          <div className="card">
            <div className="kv">
              <span className="k">Leg</span>
              <span className="v" style={{ fontSize: 11 }}>
                {data.voyage.label}
              </span>
            </div>
            <div className="kv">
              <span className="k">Vessel</span>
              <span className="v" style={{ fontSize: 11 }}>
                {data.vessel.name}
              </span>
            </div>
            <div className="kv">
              <span className="k">Ice class</span>
              <span className="v" style={{ fontSize: 10.5 }}>
                {data.vessel.ice_class}
              </span>
            </div>
            <div className="kv">
              <span className="k">Departure</span>
              <span className="v" style={{ fontSize: 11 }}>
                {longDate(data.voyage.departure)}
              </span>
            </div>
          </div>
          <div className="card">
            <div className="kv">
              <span className="k">Reported waypoints</span>
              <span className="v">{data.voyage.waypoints.length}</span>
            </div>
            <div className="kv">
              <span className="k">Modelled passage</span>
              <span className="v">{duration(data.reported.duration_h)}</span>
            </div>
            <div className="kv">
              <span className="k">Heaviest ice met</span>
              <span className="v">{nf(data.reported.max_sic, 2)}</span>
            </div>
            <div className="kv">
              <span className="k">Optimal routes found</span>
              <span className="v">{data.planned.length}</span>
            </div>
          </div>
          <div className="card prose">
            <p>
              <strong>What this is not.</strong> The comparison does not claim the master made a
              poor decision. The reported track is a sensible passage chosen without a fourteen-day
              ice forecast, and what it measures is the value of having one.
            </p>
            <p>
              {material
                ? "The saving here comes from where the track crosses the ice edge, not from sailing a shorter distance."
                : "On this leg the optimiser could not beat the reported track without accepting more risk. That is a useful answer in its own right: the passage as sailed was close to the best available."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
