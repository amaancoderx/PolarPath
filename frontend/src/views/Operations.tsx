import { useCallback, useEffect, useRef, useState } from "react";
import MissionPanel from "../components/MissionPanel";
import PolarChart from "../components/PolarChart";
import RoutePanel from "../components/RoutePanel";
import Timeline from "../components/Timeline";
import { RAMPS, cssRamp, riskColour, routeColour } from "../lib/colormap";
import { api, type Sounding } from "../lib/api";
import { coord, iceStage, nf } from "../lib/format";
import { useConsole } from "../lib/useConsole";

const LAYER_TABS = [
  { id: "sic", short: "Ice" },
  { id: "thickness", short: "Thickness" },
  { id: "risk", short: "Risk" },
  { id: "speed", short: "Speed" },
  { id: "bergs", short: "Bergs" },
];

export default function Operations() {
  const c = useConsole();
  const [sounding, setSounding] = useState<Sounding | null>(null);
  const [tipAt, setTipAt] = useState<{ x: number; y: number } | null>(null);
  const pending = useRef<number | undefined>(undefined);
  const lastKey = useRef("");

  const pick = useCallback(
    (lat: number, lon: number, screen: { x: number; y: number }) => {
      setTipAt(screen);
      const key = `${lat.toFixed(1)}|${lon.toFixed(1)}|${c.day}|${c.vesselId}`;
      if (key === lastKey.current) return;
      lastKey.current = key;
      window.clearTimeout(pending.current);
      pending.current = window.setTimeout(() => {
        api
          .point(lat, lon, c.day, c.vesselId)
          .then(setSounding)
          .catch(() => undefined);
      }, 55);
    },
    [c.day, c.vesselId],
  );

  const leave = useCallback(() => {
    window.clearTimeout(pending.current);
    setTipAt(null);
    setSounding(null);
    lastKey.current = "";
  }, []);

  useEffect(() => () => window.clearTimeout(pending.current), []);

  if (!c.boot) return null;
  const ramp = RAMPS[c.layerId] ?? RAMPS.sic;

  return (
    <div className="workspace">
      <aside className="rail rail-left">
        <MissionPanel />
      </aside>

      <div className="stage">
        <PolarChart
          domain={c.domain}
          rings={c.boot.coastline.rings}
          layer={c.layer}
          layerId={c.layerId}
          routes={c.plan?.routes ?? []}
          selectedRoute={c.selectedRoute}
          hoveredRoute={c.hoveredRoute}
          icebergs={c.toggles.icebergs ? c.icebergs : []}
          tracks={c.toggles.tracks ? c.tracks : []}
          drift={c.drift}
          places={c.places}
          showIcebergs={c.toggles.icebergs}
          showTracks={c.toggles.tracks}
          showDrift={c.toggles.drift}
          showGraticule={c.toggles.graticule}
          showPlaces={c.toggles.places}
          day={c.day}
          onPick={pick}
          onLeave={leave}
          onSelectRoute={c.setSelectedRoute}
        />

        <div className="overlay overlay-tl">
          <div className="segmented" role="group" aria-label="Chart layer">
            {LAYER_TABS.map((l) => (
              <button
                key={l.id}
                aria-pressed={c.layerId === l.id}
                onClick={() => c.setLayerId(l.id)}
                title={RAMPS[l.id]?.label}
              >
                {l.short}
              </button>
            ))}
          </div>
          <div className="toggle-stack">
            <button className="toggle" aria-pressed={c.toggles.icebergs} onClick={() => c.toggle("icebergs")}>
              <span className="box" />
              Icebergs
            </button>
            <button className="toggle" aria-pressed={c.toggles.tracks} onClick={() => c.toggle("tracks")}>
              <span className="box" />
              Berg trajectories
            </button>
            <button className="toggle" aria-pressed={c.toggles.drift} onClick={() => c.toggle("drift")}>
              <span className="box" />
              Ice drift
            </button>
            <button className="toggle" aria-pressed={c.toggles.places} onClick={() => c.toggle("places")}>
              <span className="box" />
              Stations and ports
            </button>
            <button className="toggle" aria-pressed={c.toggles.graticule} onClick={() => c.toggle("graticule")}>
              <span className="box" />
              Graticule
            </button>
          </div>
        </div>

        <div className="overlay overlay-bl">
          <div className="legend">
            <div className="title">{ramp.label}</div>
            <div className="ramp" style={{ background: cssRamp(c.layerId) }} />
            <div className="ticks">
              {ramp.ticks.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            {(c.plan?.routes.length ?? 0) > 0 && (
              <div className="legend-routes">
                {["Safest", "Balanced", "Fuel optimal"].map((label) => {
                  const present = c.plan?.routes.some((r) => r.label === label);
                  if (!present) return null;
                  return (
                    <div className="row" key={label}>
                      <i className="swatch" style={{ color: routeColour(label) }} />
                      <span>{label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="overlay overlay-br">
          <div className="legend" style={{ minWidth: 152 }}>
            <div className="title">Analysis</div>
            <div className="kv" style={{ padding: "3px 0" }}>
              <span className="k">Ice extent</span>
              <span className="v">{nf(c.boot.snapshot.ice_extent_km2 / 1e6, 2)} Mkm²</span>
            </div>
            <div className="kv" style={{ padding: "3px 0" }}>
              <span className="k">Bergs tracked</span>
              <span className="v">{c.boot.snapshot.tracked_bergs}</span>
            </div>
            <div className="kv" style={{ padding: "3px 0" }}>
              <span className="k">Horizon</span>
              <span className="v">{c.boot.snapshot.horizon_days} d</span>
            </div>
          </div>
        </div>

        <div className="overlay overlay-bottom">
          <Timeline
            days={c.boot.days}
            day={c.day}
            onChange={c.setDay}
            playing={c.playing}
            onPlay={c.setPlaying}
          />
        </div>

        {sounding && tipAt && (
          <div
            className="tip"
            style={{
              left: Math.min(tipAt.x + 16, window.innerWidth - 200),
              top: Math.min(tipAt.y + 16, window.innerHeight - 190),
            }}
          >
            <div className="t">
              <span className="mono" style={{ fontSize: 10.5 }}>
                {coord(sounding.lat, sounding.lon)}
              </span>
            </div>
            {sounding.land ? (
              <div className="r">
                <span>Land or ice shelf</span>
              </div>
            ) : (
              <>
                <div className="r">
                  <span>Ice cover</span>
                  <b>{nf(sounding.sic, 2)}</b>
                </div>
                <div className="r">
                  <span>Thickness</span>
                  <b>{nf(sounding.thickness_m, 2)} m</b>
                </div>
                <div className="r">
                  <span>Attainable speed</span>
                  <b>{nf(sounding.speed_kn, 1)} kn</b>
                </div>
                <div className="r">
                  <span>Burn</span>
                  <b>{nf(sounding.fuel_kg_per_km, 1)} kg/km</b>
                </div>
                <div className="r">
                  <span>Risk</span>
                  <b style={{ color: riskColour(sounding.risk) }}>{nf(sounding.risk, 2)}</b>
                </div>
                <div className="r">
                  <span>Wind / current</span>
                  <b>
                    {nf(sounding.wind_ms, 0)} m/s · {nf(sounding.current_ms, 2)} m/s
                  </b>
                </div>
                <div
                  className="r"
                  style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--line)" }}
                >
                  <span style={{ color: sounding.passable ? "var(--text-3)" : "var(--bad)" }}>
                    {sounding.passable ? iceStage(sounding.sic) : "Beyond hull capability"}
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <aside className="rail rail-right">
        <RoutePanel />
      </aside>
    </div>
  );
}
