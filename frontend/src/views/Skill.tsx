import { useEffect, useState } from "react";
import { api, type SkillReport } from "../lib/api";
import { LineChart } from "../components/Plot";
import { nf, pct, shortDate } from "../lib/format";

/**
 * Model skill.
 *
 * The honest version of a results slide: every forecast is scored against the
 * baselines an operational centre would demand, on initialisations the models
 * were not fitted to, and the numbers are computed on load rather than typed in.
 */
export default function Skill() {
  const [report, setReport] = useState<SkillReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.skill().then(setReport).catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="doc">
        <div className="doc-inner">
          <p className="note">Skill report unavailable: {error}</p>
        </div>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="doc">
        <div className="doc-inner">
          <p className="note">Loading validation report.</p>
        </div>
      </div>
    );
  }

  const ice = report.sea_ice;
  const drift = report.drift;
  const day7 = ice.by_lead.find((r) => r.lead_days === 7) ?? ice.by_lead[ice.by_lead.length - 1];
  const drift7 = drift.by_horizon.find((r) => r.horizon_days === 7) ?? drift.by_horizon[0];
  const training = report.sea_ice_training as Record<string, number | string>;
  const bergTraining = report.iceberg_training as Record<string, number | string>;

  return (
    <div className="doc fade-in">
      <div className="doc-inner">
        <h1>Model skill</h1>
        <p className="lede">
          Both models are scored on initialisations held out of fitting, against the baselines an
          operational forecast centre would insist on. Every figure on this page is recomputed from
          the archive when the engine starts, so it moves if the model does.
        </p>

        <div className="grid-4">
          <div className="card big-stat">
            <div className="k">Concentration RMSE, day 7</div>
            <div className="v">{nf(day7.rmse, 3)}</div>
            <div className="note">against {nf(day7.rmse_persistence, 3)} for persistence</div>
          </div>
          <div className="card big-stat">
            <div className="k">Skill over persistence, day 7</div>
            <div className="v" style={{ color: "var(--good)" }}>
              {pct(day7.skill_vs_persistence, 1)}
            </div>
            <div className="note">1 − RMSE ratio, higher is better</div>
          </div>
          <div className="card big-stat">
            <div className="k">Ice edge agreement, day 7</div>
            <div className="v">{pct(day7.ice_edge_accuracy, 1)}</div>
            <div className="note">at the 15 percent contour</div>
          </div>
          <div className="card big-stat">
            <div className="k">Berg position error, day 7</div>
            <div className="v">
              {nf(drift7.corrected_mean_km, 1)}
              <small>km</small>
            </div>
            <div className="note">
              {nf(drift7.physics_mean_km, 1)} km from free drift alone
            </div>
          </div>
        </div>

        <h2>Sea-ice concentration forecast</h2>
        <div className="grid-2">
          <div className="card">
            <LineChart
              height={236}
              yMin={0}
              xLabel="lead"
              xTicks={[1, 3, 5, 7, 10, 14]}
              xFormat={(v) => `${nf(v, 0)}d`}
              yFormat={(v) => nf(v, 2)}
              series={[
                {
                  id: "model",
                  label: "PolarPath",
                  colour: "#7da6ff",
                  width: 2.4,
                  area: true,
                  points: ice.by_lead.map((r) => [r.lead_days, r.rmse]),
                },
                {
                  id: "persistence",
                  label: "Persistence",
                  colour: "#ff7a66",
                  dashed: true,
                  points: ice.by_lead.map((r) => [r.lead_days, r.rmse_persistence]),
                },
                {
                  id: "climatology",
                  label: "Climatology",
                  colour: "#f0b429",
                  dashed: true,
                  points: ice.by_lead.map((r) => [r.lead_days, r.rmse_climatology]),
                },
                {
                  id: "advection",
                  label: "Advection only",
                  colour: "#b48cff",
                  dashed: true,
                  points: ice.by_lead.map((r) => [r.lead_days, r.rmse_advection]),
                },
              ]}
            />
            <p className="note mt-8">
              Root mean square error in concentration by lead time. Persistence is the standard
              operational baseline; climatology is what you get from the calendar alone; advection
              is the physical baseline the model corrects.
            </p>
          </div>

          <div className="card card-tight">
            <table className="table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th className="num">RMSE</th>
                  <th className="num">Persist.</th>
                  <th className="num">Clim.</th>
                  <th className="num">Skill</th>
                  <th className="num">IIEE Mkm²</th>
                </tr>
              </thead>
              <tbody>
                {ice.by_lead.map((r) => (
                  <tr key={r.lead_days}>
                    <td className="mono">{r.lead_days} d</td>
                    <td className="num">{nf(r.rmse, 4)}</td>
                    <td className="num muted">{nf(r.rmse_persistence, 4)}</td>
                    <td className="num muted">{nf(r.rmse_climatology, 4)}</td>
                    <td className="num" style={{ color: "var(--good)" }}>
                      {pct(r.skill_vs_persistence, 1)}
                    </td>
                    <td className="num">{nf(r.iiee_km2 / 1e6, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: 14 }}>
              <p className="note">
                The integrated ice edge error is the total area where the forecast and the
                verifying analysis disagree about whether ice is present. {ice.note}
              </p>
            </div>
          </div>
        </div>

        <h2>Iceberg trajectory</h2>
        <div className="grid-2">
          <div className="card">
            <LineChart
              height={222}
              yMin={0}
              xLabel="horizon"
              xTicks={[1, 3, 7, 14]}
              xFormat={(v) => `${nf(v, 0)}d`}
              yFormat={(v) => `${nf(v, 0)}`}
              series={[
                {
                  id: "physics",
                  label: "Free drift physics",
                  colour: "#ff7a66",
                  dashed: true,
                  points: drift.by_horizon.map((r) => [r.horizon_days, r.physics_mean_km]),
                },
                {
                  id: "corrected",
                  label: "Physics with learned correction",
                  colour: "#4fd1a5",
                  width: 2.4,
                  area: true,
                  points: drift.by_horizon.map((r) => [r.horizon_days, r.corrected_mean_km]),
                },
              ]}
            />
            <p className="note mt-8">
              Mean great-circle position error, kilometres. {drift.note}
            </p>
          </div>

          <div className="card card-tight">
            <table className="table">
              <thead>
                <tr>
                  <th>Horizon</th>
                  <th className="num">Free drift</th>
                  <th className="num">Corrected</th>
                  <th className="num">Median</th>
                  <th className="num">Gain</th>
                </tr>
              </thead>
              <tbody>
                {drift.by_horizon.map((r) => (
                  <tr key={r.horizon_days}>
                    <td className="mono">{r.horizon_days} d</td>
                    <td className="num muted">{nf(r.physics_mean_km, 1)} km</td>
                    <td className="num">{nf(r.corrected_mean_km, 1)} km</td>
                    <td className="num muted">{nf(r.corrected_median_km, 1)} km</td>
                    <td className="num" style={{ color: "var(--good)" }}>
                      {nf(r.improvement_pct, 1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: 14 }}>
              <p className="note">
                Scored on {drift.holdout_bergs} bergs withheld from training entirely, so the
                correction cannot be memorising individual tracks. The residual error is dominated
                by eddy-scale ocean variability that no operational current product resolves, which
                is why the curve does not go to zero.
              </p>
            </div>
          </div>
        </div>

        <h2>How the models were fitted</h2>
        <div className="grid-2">
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="badge">Sea ice</span>
              <span style={{ fontSize: 12.5, fontWeight: 550 }}>{report.sea_ice_backend}</span>
            </div>
            <div className="kv">
              <span className="k">Training samples</span>
              <span className="v">{nf(Number(training.samples))}</span>
            </div>
            <div className="kv">
              <span className="k">Features</span>
              <span className="v">{String(training.features)}</span>
            </div>
            <div className="kv">
              <span className="k">Initialisations</span>
              <span className="v">{String(training.initialisations)}</span>
            </div>
            <div className="kv">
              <span className="k">Boosting rounds</span>
              <span className="v">{String(training.iterations)}</span>
            </div>
            <div className="kv">
              <span className="k">Archive</span>
              <span className="v" style={{ fontSize: 11 }}>
                {shortDate(String(training.archive_start))} to {shortDate(String(training.archive_end))}
              </span>
            </div>
            <div className="kv">
              <span className="k">Verification window</span>
              <span className="v" style={{ fontSize: 11 }}>
                {shortDate(ice.window[0])} to {shortDate(ice.window[1])}
              </span>
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="badge">Icebergs</span>
              <span style={{ fontSize: 12.5, fontWeight: 550 }}>{report.iceberg_backend}</span>
            </div>
            <div className="kv">
              <span className="k">Displacement samples</span>
              <span className="v">{nf(Number(bergTraining.samples))}</span>
            </div>
            <div className="kv">
              <span className="k">Features</span>
              <span className="v">{String(bergTraining.features)}</span>
            </div>
            <div className="kv">
              <span className="k">Bergs in training</span>
              <span className="v">{String(bergTraining.training_bergs)}</span>
            </div>
            <div className="kv">
              <span className="k">Bergs held out</span>
              <span className="v">{String(bergTraining.holdout_bergs)}</span>
            </div>
            <div className="kv">
              <span className="k">Track length</span>
              <span className="v">
                {String(bergTraining.track_days)} d at {String(bergTraining.step_hours)} h steps
              </span>
            </div>
            <div className="kv">
              <span className="k">Source</span>
              <span className="v" style={{ fontSize: 10.5 }}>
                {String(bergTraining.source)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
