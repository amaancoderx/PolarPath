import { nf } from "../lib/format";
import { useConsole } from "../lib/useConsole";

/** How the system works, in the order the data moves through it. */
export default function Method() {
  const c = useConsole();
  const snap = c.boot?.snapshot;

  const stages = [
    {
      n: "1",
      title: "Data layer",
      body:
        "Sea-ice concentration on a 0.5 by 1.0 degree Southern Ocean grid, ten metre winds and " +
        "surface temperature, surface currents, a tracked iceberg catalogue and the vessel " +
        "register. The prototype runs on a deterministic reconstructed archive so it works with " +
        "no network and every demonstration is reproducible; each module exposes the same " +
        "product shape as the operational feed it stands in for.",
      chips: [
        "NSIDC / NOAA sea-ice concentration",
        "ERA5 wind and temperature",
        "Copernicus Marine surface currents",
        "Antarctic Iceberg Tracking Database",
        "Natural Earth coastline",
      ],
    },
    {
      n: "2",
      title: "Sea-ice forecast",
      body:
        "For each lead time the observed field is advected forward by the free-drift ice velocity, " +
        "and a gradient-boosted model predicts the residual that advection misses: thermodynamic " +
        "growth and melt, deformation, damping of anomalies and the response to incoming weather. " +
        "Each lead is trained directly rather than rolled out step by step, so a fourteen day " +
        "field does not inherit fourteen steps of accumulated error.",
      chips: [
        "Direct multi-horizon residual model",
        "35 spatio-temporal features",
        "Scored against persistence, climatology and advection",
        "RMSE and integrated ice edge error",
      ],
    },
    {
      n: "3",
      title: "Iceberg trajectory",
      body:
        "A steady-state free-drift balance of air drag on the sail, water drag on the keel, " +
        "Coriolis and the sea-surface pressure gradient, solved as a fixed point across the whole " +
        "population at once. A gradient-boosted correction trained on the tracking database " +
        "supplies what free drift misses, principally the sheared current the keel actually " +
        "samples, added mass on the largest tabular bergs, and bergs locked into close pack.",
      chips: [
        "Free-drift force balance",
        "XGBoost residual correction",
        "Validated on bergs held out of training",
        "Six-hourly integration to 14 days",
      ],
    },
    {
      n: "4",
      title: "Transit cost",
      body:
        "Ice resistance from the Lindqvist decomposition into crushing, bending and submersion, " +
        "with each component's speed correction. The attainable speed is solved rather than " +
        "assumed: it is the fastest the installed power can sustain against that resistance " +
        "inside a sea margin, and fuel follows from shaft power and specific consumption. Heavy " +
        "ice therefore raises the cost of a cell through a slower transit and a higher burn at " +
        "the same time.",
      chips: [
        "Lindqvist (1989) ship-in-ice resistance",
        "Attainable speed by bisection on power",
        "Fuel from SFOC and hotel load",
        "Besetting and ice class limits",
      ],
    },
    {
      n: "5",
      title: "Route optimisation",
      body:
        "A 16-connected lattice inside an ellipse around the direct track, searched with A star " +
        "on a cost that blends fuel, passage time and a four-part risk index. Labels carry the " +
        "hour of arrival, so the ice field and berg positions used to price the next leg are the " +
        "forecast valid when the vessel actually gets there. The search is repeated across a " +
        "sweep of fuel-versus-safety weightings and dominated outcomes are discarded.",
      chips: [
        "Time-dependent A star",
        "Great-circle edge lengths",
        "Ten-point weight sweep",
        "Pareto filtering on fuel, risk and time",
      ],
    },
    {
      n: "6",
      title: "Decision support",
      body:
        "The master is handed the trade-off, not a single answer: a set of non-dominated routes " +
        "with fuel, time, risk and the ice each one meets, an along-track profile, and a " +
        "benchmark against a completed voyage priced through the identical cost model.",
      chips: [
        "Pareto route set",
        "Along-track ice, speed and burn",
        "Voyage benchmark",
        "Point soundings anywhere on the chart",
      ],
    },
  ];

  return (
    <div className="doc fade-in">
      <div className="doc-inner">
        <h1>How PolarPath works</h1>
        <p className="lede">
          The problem is split into three models that can each be checked on their own, rather than
          one network asked to turn satellite imagery into a course. Ice is forecast, bergs are
          predicted, and the two together price the passage through a published ship-in-ice
          resistance model. Only the last stage optimises.
        </p>

        {snap && (
          <div className="grid-4" style={{ marginBottom: 26 }}>
            <div className="card big-stat">
              <div className="k">Analysis date</div>
              <div className="v" style={{ fontSize: 18 }}>
                {new Date(snap.reference_date).toLocaleDateString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </div>
              <div className="note">{snap.horizon_days} day forecast horizon</div>
            </div>
            <div className="card big-stat">
              <div className="k">Analysis grid</div>
              <div className="v" style={{ fontSize: 18 }}>
                {snap.grid.n_lat} × {snap.grid.n_lon}
              </div>
              <div className="note">
                {nf(snap.grid.lat_step, 1)}° latitude by {nf(snap.grid.lon_step, 1)}° longitude
              </div>
            </div>
            <div className="card big-stat">
              <div className="k">Ice extent</div>
              <div className="v" style={{ fontSize: 18 }}>
                {nf(snap.ice_extent_km2 / 1e6, 2)}
                <small>M km²</small>
              </div>
              <div className="note">area at or above 15 percent cover</div>
            </div>
            <div className="card big-stat">
              <div className="k">Bergs tracked</div>
              <div className="v" style={{ fontSize: 18 }}>
                {snap.tracked_bergs}
              </div>
              <div className="note">each with a 14 day predicted track</div>
            </div>
          </div>
        )}

        <h2>Pipeline</h2>
        <div className="pipeline">
          {stages.map((s) => (
            <article className="stage-card" key={s.n}>
              <div className="n">{s.n}</div>
              <div>
                <h3>{s.title}</h3>
                <p className="prose">{s.body}</p>
                <div className="chips">
                  {s.chips.map((chip) => (
                    <span className="chip" key={chip}>
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>

        <h2>What the risk index contains</h2>
        <div className="grid-4">
          {[
            {
              w: "40%",
              k: "Ice severity",
              v: "Concentration above the 15 percent threshold, scaled by thickness relative to what the hull is classed for.",
            },
            {
              w: "28%",
              k: "Iceberg exposure",
              v: "Distance to predicted berg positions on the day of transit, with a wider berth around larger bergs.",
            },
            {
              w: "18%",
              k: "Power margin",
              v: "How far the attainable speed has fallen below service speed, which is how close the hull is to being stopped.",
            },
            {
              w: "14%",
              k: "Remoteness",
              v: "Besetting in close pack far from open water is a far worse outcome than besetting near the ice edge.",
            },
          ].map((item) => (
            <div className="card" key={item.k}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{item.k}</span>
                <span className="mono" style={{ color: "var(--accent)", fontSize: 12 }}>
                  {item.w}
                </span>
              </div>
              <p className="note">{item.v}</p>
            </div>
          ))}
        </div>

        <h2>Scope of this prototype</h2>
        <div className="grid-2">
          <div className="card prose">
            <p>
              <strong>What is real.</strong> The Lindqvist resistance model, the free-drift force
              balance, the propulsion and fuel chain, the time-dependent search and the Pareto
              filtering are all implemented as specified and run live on every request. Both
              learned models are fitted from data and scored on held-out initialisations; the
              numbers on the skill page are computed at start-up, not written in.
            </p>
          </div>
          <div className="card prose">
            <p>
              <strong>What is reconstructed.</strong> The observational archive is generated from
              published Antarctic climatology rather than downloaded, so the system is offline,
              deterministic and reproducible on any machine. Every data module is a single function
              body away from the live NSIDC, ERA5 and Copernicus Marine feeds, and the models
              consume them through the same interface either way.
            </p>
          </div>
        </div>

        <h2>Problem statement</h2>
        <div className="card prose">
          <p>
            <strong>SIH 2026, problem statement 26059.</strong> AI-enabled Antarctic sea-ice,
            iceberg trajectory and navigation decision support system. Ministry of Earth Sciences,
            National Centre for Polar and Ocean Research. Theme: transportation and logistics.
          </p>
        </div>
      </div>
    </div>
  );
}
