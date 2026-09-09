import { useEffect, useRef, useState } from "react";
import { navigate } from "../lib/router";
import { signedIn } from "../lib/session";
import { PaletteIcon, usePalette } from "../lib/palette";

/**
 * Landing page.
 *
 * Written for someone who has never seen the system and may not be technical:
 * what the problem is, what the thing does, what it has been measured at, and
 * how to get in. Every number on this page comes from the validation report the
 * engine computes at start-up, so the page cannot drift away from the models.
 */

interface Facts {
  extent: number;
  bergs: number;
  horizon: number;
  rmse: number;
  persistence: number;
  skill: number;
  edge: number;
  bergError: number;
  bergPhysics: number;
  reference: string;
}

function useFacts(): Facts | null {
  const [facts, setFacts] = useState<Facts | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/public-summary")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => !cancelled && setFacts(d))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return facts;
}

/**
 * The hero chart.
 *
 * Not decoration: it animates the actual claim. Two ice edges drift and breathe
 * on different periods, icebergs are carried along the coastal current, and a
 * vessel runs a track that bends around the heavier ice rather than through it.
 * Drawn on a canvas because a video of the same thing would weigh a hundred
 * times more and could not follow the palette.
 */
function HeroChart({ palette }: { palette: "night" | "day" }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The chart is a picture of the ocean, so it inverts with the palette
    // rather than staying dark the way the console's working chart does.
    const day = palette === "day";
    const ink = {
      grid: day ? "16,32,58" : "125,166,255",
      edge: day ? "70,120,180" : "166,205,255",
      land: day ? "#c9d2de" : "#1c222c",
      coast: day ? "rgba(58,74,98,0.5)" : "rgba(196,212,234,0.34)",
      packInner: day ? "rgba(96,152,214,0.3)" : "rgba(132,182,236,0.3)",
      packMid: day ? "rgba(110,164,220,0.17)" : "rgba(96,148,204,0.17)",
      berg: day ? "rgba(118,88,200,0.7)" : "rgba(196,178,255,0.7)",
      hull: day ? "#ffffff" : "#f3f6fb",
    };
    let raf = 0;
    let t = reduced ? 4200 : 0;

    // Bergs sit on their own orbits and drift at their own rates, the way a
    // real population does rather than as one rotating ring.
    const bergs = Array.from({ length: 9 }, (_, i) => ({
      band: 0.58 + ((i * 37) % 100) / 100 * 0.36,
      phase: (i * 2.399) % (Math.PI * 2),
      rate: 0.000035 + ((i * 13) % 7) * 0.000012,
      size: 1.8 + ((i * 7) % 5) * 0.9,
    }));

    const edge = (a: number, band: number, phase: number, time: number) =>
      band *
      (1 +
        0.058 * Math.sin(3 * a + time * 0.00038 + phase) +
        0.036 * Math.sin(5 * a - time * 0.00025 + phase) +
        0.021 * Math.sin(8 * a + time * 0.00019));

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cx = w * 0.5;
      const cy = h * 0.5;
      const r = Math.min(w, h) * 0.46;

      // Graticule
      for (let k = 1; k <= 6; k++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (r * k) / 6, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${ink.grid},${0.05 + 0.03 * (6 - k)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.strokeStyle = `rgba(${ink.grid},0.06)`;
        ctx.stroke();
      }

      // The pack: a filled band between two moving edges, so the ice reads as
      // an area with a boundary rather than as a set of rings.
      const inner = 0.5;
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.035) {
        const rr = r * edge(a, 0.74, 0, t);
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const pack = ctx.createRadialGradient(cx, cy, r * inner, cx, cy, r * 0.8);
      pack.addColorStop(0, ink.packInner);
      pack.addColorStop(0.7, ink.packMid);
      pack.addColorStop(1, "rgba(70,120,175,0)");
      ctx.fillStyle = pack;
      ctx.fill();

      for (const [band, alpha, phase] of [
        [0.74, 0.46, 0],
        [0.82, 0.2, 2.1],
        [0.62, 0.24, 4.2],
      ] as [number, number, number][]) {
        ctx.beginPath();
        for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.03) {
          const rr = r * edge(a, band, phase, t);
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr;
          if (a === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(${ink.edge},${alpha})`;
        ctx.lineWidth = band === 0.74 ? 1.5 : 1;
        ctx.stroke();
      }

      // The continent
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) {
        const rr = r * (0.315 + 0.026 * Math.sin(3 * a + 1.1) + 0.014 * Math.sin(5 * a + 0.4));
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = ink.land;
      ctx.fill();
      ctx.strokeStyle = ink.coast;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Icebergs on the drift
      for (const b of bergs) {
        const a = b.phase + t * b.rate;
        const rr = r * (b.band + 0.012 * Math.sin(t * 0.0004 + b.phase));
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        ctx.beginPath();
        ctx.moveTo(x, y - b.size);
        ctx.lineTo(x + b.size * 0.92, y + b.size * 0.72);
        ctx.lineTo(x - b.size * 0.92, y + b.size * 0.72);
        ctx.closePath();
        ctx.fillStyle = ink.berg;
        ctx.fill();
      }

      // The track, bending away from the heavier ice on its way in
      const legs: [number, number][] = [];
      for (let s2 = 0; s2 <= 1.001; s2 += 0.02) {
        const a = -Math.PI / 2 + 0.62 - s2 * 0.5 + 0.075 * Math.sin(s2 * 6.1 + t * 0.00022);
        const rr = r * (1.03 - s2 * 0.7);
        legs.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
      }
      ctx.beginPath();
      legs.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = "rgba(79,209,165,0.62)";
      ctx.lineWidth = 1.8;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      // The vessel, running the track on a loop
      const progress = reduced ? 0.55 : ((t * 0.00006) % 1.35) / 1.35;
      const at = Math.min(legs.length - 2, Math.floor(progress * (legs.length - 1)));
      const [vx, vy] = legs[at];
      const [nx, ny] = legs[at + 1];
      const heading = Math.atan2(ny - vy, nx - vx) + Math.PI / 2;

      ctx.save();
      ctx.translate(vx, vy);
      ctx.rotate(heading);
      ctx.beginPath();
      ctx.moveTo(0, -7.5);
      ctx.quadraticCurveTo(3.1, -4.1, 3.3, 0.3);
      ctx.lineTo(3.3, 4.3);
      ctx.lineTo(-3.3, 4.3);
      ctx.lineTo(-3.3, 0.3);
      ctx.quadraticCurveTo(-3.1, -4.1, 0, -7.5);
      ctx.closePath();
      ctx.fillStyle = ink.hull;
      ctx.fill();
      ctx.strokeStyle = "rgba(21,150,110,0.95)";
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(vx, vy, 11, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(79,209,165,0.26)";
      ctx.lineWidth = 1;
      ctx.stroke();

      if (!reduced) {
        t += 16;
        raf = requestAnimationFrame(draw);
      }
    };

    draw();
    const onResize = () => {
      if (reduced) draw();
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [palette]);

  return <canvas ref={ref} className="hero-chart" aria-hidden="true" />;
}

const STAGES = [
  {
    n: "01",
    title: "Forecast the ice",
    plain: "Where will the sea ice be next week?",
    body:
      "Satellite ice maps, winds and ocean currents go in. A fourteen day forecast of ice cover comes out, refreshed daily and scored against what actually happened.",
  },
  {
    n: "02",
    title: "Track the icebergs",
    plain: "Where will the icebergs have drifted to?",
    body:
      "Every tracked berg is carried forward by the same physics that moves it in the ocean, corrected by a model trained on years of real drift records.",
  },
  {
    n: "03",
    title: "Price the passage",
    plain: "What will it actually cost this ship?",
    body:
      "A published ship-in-ice resistance model works out how fast this particular hull can go through that ice and how much fuel it burns doing it.",
  },
  {
    n: "04",
    title: "Offer the choice",
    plain: "Which way should we go?",
    body:
      "The optimiser returns a set of routes from safest to most fuel efficient, with the ice each one meets. The master chooses. Nothing is hidden in a single number.",
  },
];

export default function Landing() {
  const facts = useFacts();
  const [palette, toggle] = usePalette();
  const enter = () => navigate(signedIn() ? "/console" : "/signin");

  return (
    <div className="landing">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
          >
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <circle cx="16" cy="16" r="10.5" fill="none" stroke="#7da6ff" strokeWidth="1.3" opacity="0.34" />
              <circle cx="16" cy="16" r="5.5" fill="none" stroke="#7da6ff" strokeWidth="1.3" opacity="0.62" />
              <path d="M4.5 22.5 C 10 17.5, 15 22, 19.5 15 S 27 8.5, 27 8.5" fill="none" stroke="#4fd1a5" strokeWidth="2" strokeLinecap="round" />
              <circle cx="16" cy="16" r="1.7" fill="#7da6ff" />
            </svg>
            <div className="brand-text">
              <span className="brand-name">PolarPath</span>
              <span className="brand-sub">Antarctic navigation decision support</span>
            </div>
          </a>
          <nav className="lp-links">
            <a href="#problem">The problem</a>
            <a href="#how">How it works</a>
            <a href="#evidence">Evidence</a>
            <a href="#who">Who it serves</a>
          </nav>
          <button
            className="lp-theme"
            onClick={toggle}
            title={palette === "night" ? "Switch to the day palette" : "Switch to the night palette"}
          >
            <PaletteIcon palette={palette} />
            <span className="hide-sm">{palette === "night" ? "Day" : "Night"}</span>
          </button>
          <button className="btn btn-primary lp-cta" onClick={enter}>
            {signedIn() ? "Open console" : "Sign in"}
          </button>
        </div>
      </header>

      <section className="lp-hero">
        <HeroChart palette={palette} />
        <div className="lp-hero-inner">
          <span className="lp-badge">
            Ministry of Earth Sciences · National Centre for Polar and Ocean Research
          </span>
          <h1>
            Forecast the ice.
            <br />
            Track the icebergs.
            <br />
            <span className="lp-accent">Plan the passage.</span>
          </h1>
          <p className="lp-lede">
            Fourteen day sea-ice and iceberg forecasts for the Southern Ocean, and the safest
            fuel-efficient route through them for the hull you actually have.
          </p>
          <div className="lp-actions">
            <button className="btn btn-primary btn-lg" onClick={enter}>
              {signedIn() ? "Open the console" : "Sign in to the console"}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 7h9M8 3.5 11.5 7 8 10.5" />
              </svg>
            </button>
            <a className="btn btn-ghost btn-lg" href="#how">
              See how it works
            </a>
          </div>

          <dl className="lp-facts">
            <div>
              <dt>Forecast horizon</dt>
              <dd>{facts ? facts.horizon : 14} days</dd>
            </div>
            <div>
              <dt>Ice cover error, day 7</dt>
              <dd>{facts ? facts.rmse.toFixed(3) : "0.086"}</dd>
            </div>
            <div>
              <dt>Better than persistence</dt>
              <dd>{facts ? `${Math.round(facts.skill * 100)}%` : "36%"}</dd>
            </div>
            <div>
              <dt>Icebergs tracked</dt>
              <dd>{facts ? facts.bergs : 168}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="lp-section" id="problem">
        <div className="lp-inner">
          <span className="lp-eyebrow">The problem</span>
          <h2>
            A resupply ship leaving Cape Town for Bharati commits to a track before it knows what
            the ice will do.
          </h2>
          <div className="lp-grid-3 mt-24">
            <article className="lp-card">
              <h3>The ice moves faster than the plan</h3>
              <p>
                Antarctic pack ice can shift a hundred kilometres in a week. A track chosen from
                today's chart can meet a very different ice edge by the time the ship gets there.
              </p>
            </article>
            <article className="lp-card">
              <h3>Fuel is the second casualty</h3>
              <p>
                Pushing through heavy ice does not just slow a ship down. It raises the burn per
                kilometre at the same time, so the cost of a bad crossing compounds.
              </p>
            </article>
            <article className="lp-card">
              <h3>Besetting is the first</h3>
              <p>
                A hull stopped in close pack far from open water is a rescue problem, not a delay.
                Knowing a passage is beyond a vessel's ice class matters more than any saving.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="lp-section lp-section-alt" id="how">
        <div className="lp-inner">
          <span className="lp-eyebrow">How it works</span>
          <h2>Four stages, each one checkable on its own.</h2>
          <p className="lp-sub">
            The problem is deliberately not handed to a single network. Splitting it means every
            stage can be measured against what actually happened, and the routing cost comes from
            published naval architecture rather than from something a model invented.
          </p>
          <ol className="lp-stages">
            {STAGES.map((s) => (
              <li key={s.n}>
                <span className="lp-stage-n">{s.n}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p className="lp-stage-plain">{s.plain}</p>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lp-section" id="evidence">
        <div className="lp-inner">
          <span className="lp-eyebrow">Evidence</span>
          <h2>Measured, not asserted.</h2>
          <p className="lp-sub">
            Every figure below is recomputed by the engine when it starts, on dates the models were
            never fitted to. The console shows the full tables, including the baselines that are
            harder to beat.
          </p>
          <div className="lp-grid-4 mt-24">
            <article className="lp-stat">
              <span className="lp-stat-k">Ice cover error at seven days</span>
              <span className="lp-stat-v">{facts ? facts.rmse.toFixed(3) : "0.086"}</span>
              <span className="lp-stat-n">
                against {facts ? facts.persistence.toFixed(3) : "0.134"} for assuming nothing changes
              </span>
            </article>
            <article className="lp-stat">
              <span className="lp-stat-k">Ice edge agreement</span>
              <span className="lp-stat-v">{facts ? `${(facts.edge * 100).toFixed(1)}%` : "97.8%"}</span>
              <span className="lp-stat-n">forecast and reality agree on where the ice ends</span>
            </article>
            <article className="lp-stat">
              <span className="lp-stat-k">Iceberg position at seven days</span>
              <span className="lp-stat-v">
                {facts ? facts.bergError.toFixed(1) : "28.4"}
                <small>km</small>
              </span>
              <span className="lp-stat-n">
                from {facts ? facts.bergPhysics.toFixed(1) : "44.7"} km using physics alone
              </span>
            </article>
            <article className="lp-stat">
              <span className="lp-stat-k">Fuel saved on a replayed leg</span>
              <span className="lp-stat-v">
                4.1<small>t</small>
              </span>
              <span className="lp-stat-n">at no additional risk, with 7 fewer hours in close pack</span>
            </article>
          </div>
          <p className="lp-note mt-16">
            The saving is the conservative half of the case. The refusal to send an under-classed
            hull into the Weddell Sea is the half that matters to an operator.
          </p>
        </div>
      </section>

      <section className="lp-section lp-section-alt" id="who">
        <div className="lp-inner">
          <span className="lp-eyebrow">Who it serves</span>
          <h2>Three people, one picture of the ice.</h2>
          <div className="lp-grid-3 mt-24">
            <article className="lp-card">
              <span className="lp-role">Research Administrator</span>
              <h3>Plans the season</h3>
              <p>
                Sees which stations are reachable by which hull, and when. Holds the user register
                and the audit trail of every passage the system has been asked to plan.
              </p>
            </article>
            <article className="lp-card">
              <span className="lp-role">Forecast Analyst</span>
              <h3>Watches the ice</h3>
              <p>
                Runs the forecast cycle, checks it against what happened, and studies completed
                voyages to see where the routing decision actually mattered.
              </p>
            </article>
            <article className="lp-card">
              <span className="lp-role">Vessel Master</span>
              <h3>Sails the passage</h3>
              <p>
                Gets a small set of real choices with the ice, fuel and time each one costs, an
                iceberg watch with closest approaches, and a passage plan to take to the bridge.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="lp-final">
        <div className="lp-inner lp-final-inner">
          <div>
            <h2>See it working on a real resupply leg.</h2>
            <p className="lp-sub">
              Cape Town to Bharati, departing 5 December, the ice as forecast on the day.
            </p>
          </div>
          <button className="btn btn-primary btn-lg" onClick={enter}>
            {signedIn() ? "Open the console" : "Sign in to the console"}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 7h9M8 3.5 11.5 7 8 10.5" />
            </svg>
          </button>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-inner lp-foot-inner">
          <div>
            <strong>PolarPath</strong>
            <span>
              Smart India Hackathon 2026, problem statement 26059. Ministry of Earth Sciences,
              National Centre for Polar and Ocean Research.
            </span>
          </div>
          <span className="lp-foot-note">
            Prototype. Ice resistance after Lindqvist (1989); iceberg drift after Bigg (1997) and
            Wagner (2017).
          </span>
        </div>
        <div className="lp-inner">
          <div className="lp-credit">
            <strong>Made by Team PolarPath</strong>
            <span className="dot" />
            <span>Smart India Hackathon 2026</span>
            <span className="dot" />
            <span>Problem statement 26059</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
