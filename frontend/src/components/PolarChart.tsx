import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DecodedLayer, IcebergPoint, IcebergTrack, Place, Route } from "../lib/api";
import { lut, riskColour, routeColour } from "../lib/colormap";
import { DEG, GeoLookup, Projection, type Domain, type View } from "../lib/projection";

/**
 * The chart.
 *
 * Raster fields are painted once per layer and forecast day into a fixed
 * offscreen disc, then blitted under the live pan and zoom transform. That
 * keeps the expensive part, inverting the projection for every pixel, off the
 * interaction path entirely: dragging and scrubbing only redraw vectors.
 */

const OFFSCREEN = 1200;
const LABEL_FONT = '600 10px "Geist", "Inter", system-ui, "Segoe UI", sans-serif';
const GRATICULE_LATS = [-40, -50, -60, -70];
const GRATICULE_LABEL_LON = -45;
const GRATICULE_LONS = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180];

export interface ChartProps {
  domain: Domain;
  rings: number[][];
  layer: DecodedLayer | null;
  layerId: string;
  routes: Route[];
  selectedRoute: number;
  hoveredRoute: number | null;
  icebergs: IcebergPoint[];
  tracks: IcebergTrack[];
  places: Place[];
  showIcebergs: boolean;
  showTracks: boolean;
  showGraticule: boolean;
  showPlaces: boolean;
  day: number;
  onPick: (lat: number, lon: number, screen: { x: number; y: number }) => void;
  onLeave: () => void;
  onSelectRoute: (index: number) => void;
}

interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

export default function PolarChart(props: ChartProps) {
  const {
    domain, rings, layer, layerId, routes, selectedRoute, hoveredRoute,
    icebergs, tracks, places, showIcebergs, showTracks, showGraticule, showPlaces,
    day, onPick, onLeave, onSelectRoute,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const lookupRef = useRef<GeoLookup | null>(null);
  const [size, setSize] = useState({ w: 900, h: 700, dpr: 1 });
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const projection = useMemo(() => new Projection(domain.latMax), [domain.latMax]);

  /* ------------------------------------------------------------ sizing */

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({
        w: Math.max(320, Math.round(r.width)),
        h: Math.max(320, Math.round(r.height)),
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const baseRadius = Math.min(size.w, size.h) * 0.47;

  const view: View = useMemo(
    () => ({
      cx: size.w / 2 + transform.tx,
      cy: size.h / 2 + transform.ty,
      radius: baseRadius * transform.scale,
    }),
    [size.w, size.h, transform, baseRadius],
  );

  /* -------------------------------------------------- offscreen raster */

  // The lookup only depends on the fixed offscreen geometry, so it is built
  // exactly once for the life of the component.
  const lookup = useMemo(() => {
    const refView: View = { cx: OFFSCREEN / 2, cy: OFFSCREEN / 2, radius: OFFSCREEN / 2 };
    return new GeoLookup(OFFSCREEN, OFFSCREEN, projection, refView, domain);
  }, [projection, domain]);
  lookupRef.current = lookup;

  useEffect(() => {
    if (!offscreenRef.current) {
      const c = document.createElement("canvas");
      c.width = OFFSCREEN;
      c.height = OFFSCREEN;
      offscreenRef.current = c;
    }
    const canvas = offscreenRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, OFFSCREEN, OFFSCREEN);
    if (!layer) return;

    const table = lut(layerId);
    const image = ctx.createImageData(OFFSCREEN, OFFSCREEN);
    const out = image.data;
    const { bytes, width: gw, height: gh, land_value: land } = layer;
    const { latIndex, lonIndex, inside } = lookup;

    for (let i = 0; i < inside.length; i++) {
      if (!inside[i]) continue;
      const fy = latIndex[i];
      const fx = lonIndex[i];
      const i0 = Math.min(Math.max(Math.floor(fy), 0), gh - 1);
      const i1 = Math.min(i0 + 1, gh - 1);
      const j0 = ((Math.floor(fx) % gw) + gw) % gw;
      const j1 = (j0 + 1) % gw;
      const wy = fy - Math.floor(fy);
      const wx = fx - Math.floor(fx);

      let a = bytes[i0 * gw + j0];
      let b = bytes[i0 * gw + j1];
      let c = bytes[i1 * gw + j0];
      let d = bytes[i1 * gw + j1];

      // Land cells carry the reserved value. Rather than smearing the coast
      // into the water, borrow a neighbouring water value; if the whole stencil
      // is land the pixel stays clear and the coastline polygon covers it.
      if (a === land || b === land || c === land || d === land) {
        const pool = [a, b, c, d].filter((v) => v !== land);
        if (pool.length === 0) continue;
        const fill = pool[0];
        if (a === land) a = fill;
        if (b === land) b = fill;
        if (c === land) c = fill;
        if (d === land) d = fill;
      }

      const value =
        a * (1 - wy) * (1 - wx) + b * (1 - wy) * wx + c * wy * (1 - wx) + d * wy * wx;
      const t = Math.min(254, Math.max(0, Math.round(value)));
      const p = i * 4;
      const q = t * 4;
      out[p] = table[q];
      out[p + 1] = table[q + 1];
      out[p + 2] = table[q + 2];
      out[p + 3] = table[q + 3];
    }
    ctx.putImageData(image, 0, 0);
  }, [layer, layerId, lookup]);

  /* --------------------------------------------------------- main draw */

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h, dpr } = size;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { cx, cy, radius } = view;
    const toXY = (lat: number, lon: number) => projection.toScreen(lat, lon, view);

    // Ocean disc
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    const ocean = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    ocean.addColorStop(0, "#0a1526");
    ocean.addColorStop(0.55, "#08111f");
    ocean.addColorStop(1, "#060c17");
    ctx.fillStyle = ocean;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    // Raster layer
    const off = offscreenRef.current;
    if (off && layer) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(off, cx - radius, cy - radius, radius * 2, radius * 2);
    }

    // Graticule
    if (showGraticule) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.075)";
      for (const lat of GRATICULE_LATS) {
        const [, y] = projection.unit(lat, 0);
        ctx.beginPath();
        ctx.arc(cx, cy, Math.abs(y) * radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const lon of GRATICULE_LONS) {
        ctx.beginPath();
        const [x0, y0] = toXY(domain.latMin, lon);
        const [x1, y1] = toXY(domain.latMax, lon);
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      // Labels ride a single quiet meridian so they never stack on each other.
      ctx.fillStyle = "rgba(233,236,242,0.34)";
      ctx.font = "500 9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const lat of GRATICULE_LATS) {
        const [lx, ly] = toXY(lat, GRATICULE_LABEL_LON);
        ctx.save();
        ctx.fillStyle = "rgba(8,9,13,0.72)";
        const text = `${Math.abs(lat)}°S`;
        const w = ctx.measureText(text).width;
        ctx.fillRect(lx - w / 2 - 3, ly - 6, w + 6, 12);
        ctx.restore();
        ctx.fillStyle = "rgba(233,236,242,0.42)";
        ctx.fillText(text, lx, ly);
      }
      ctx.textBaseline = "alphabetic";
    }

    // Land
    ctx.fillStyle = "#1c222c";
    ctx.strokeStyle = "rgba(196,212,234,0.5)";
    ctx.lineWidth = 0.8;
    for (const ring of rings) {
      if (ring.length < 8) continue;
      ctx.beginPath();
      for (let k = 0; k < ring.length; k += 2) {
        const [x, y] = toXY(ring[k + 1], ring[k]);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Iceberg trajectories
    if (showTracks) {
      ctx.lineWidth = 1;
      for (const berg of tracks) {
        ctx.strokeStyle = berg.named ? "rgba(180,140,255,0.55)" : "rgba(180,140,255,0.26)";
        ctx.beginPath();
        berg.track.forEach(([la, lo], k) => {
          const [x, y] = toXY(la, lo);
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        const head = berg.track[Math.min(day, berg.track.length - 1)];
        const [hx, hy] = toXY(head[0], head[1]);
        ctx.fillStyle = "rgba(200,172,255,0.9)";
        ctx.beginPath();
        ctx.arc(hx, hy, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Icebergs
    if (showIcebergs) {
      for (const berg of icebergs) {
        const [x, y] = toXY(berg.lat, berg.lon);
        if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
        const r = Math.min(6.5, 1.3 + Math.sqrt(berg.area_km2) * 0.17);
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r * 0.92, y + r * 0.72);
        ctx.lineTo(x - r * 0.92, y + r * 0.72);
        ctx.closePath();
        ctx.fillStyle = berg.named ? "rgba(214,196,255,0.95)" : "rgba(160,142,216,0.5)";
        ctx.fill();
        if (berg.named && r > 3) {
          ctx.strokeStyle = "rgba(255,255,255,0.6)";
          ctx.lineWidth = 0.8;
          ctx.stroke();
          ctx.fillStyle = "rgba(233,236,242,0.82)";
          ctx.font = "600 9px ui-monospace, monospace";
          ctx.textAlign = "left";
          ctx.fillText(berg.id, x + r + 3, y + 3);
        }
      }
    }

    // Routes, unselected first so the active one always sits on top
    const order = routes
      .map((_, i) => i)
      .sort((a, b) => (a === selectedRoute ? 1 : 0) - (b === selectedRoute ? 1 : 0));

    for (const idx of order) {
      const route = routes[idx];
      const active = idx === selectedRoute;
      const hovered = idx === hoveredRoute;
      const colour = routeColour(route.label);

      ctx.beginPath();
      route.path.forEach(([la, lo], k) => {
        const [x, y] = toXY(la, lo);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      if (active) {
        ctx.save();
        ctx.strokeStyle = colour;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = 7;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.restore();
      }

      ctx.strokeStyle = colour;
      ctx.globalAlpha = active ? 1 : hovered ? 0.85 : 0.5;
      ctx.lineWidth = active ? 2.4 : 1.6;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.setLineDash(active ? [] : [5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // The vessel, at the position the selected route puts it on the displayed
    // forecast day, drawn as a hull pointing along its own course.
    const active = routes[selectedRoute];
    if (active && active.profile.length > 1) {
      const targetHour = day * 24;
      const pts = active.profile;
      let k = pts.length - 1;
      for (let i = 0; i < pts.length; i++) {
        if (pts[i].hour >= targetHour) {
          k = i;
          break;
        }
      }
      const here = pts[k];
      const ahead = pts[Math.min(k + 1, pts.length - 1)];
      const behind = pts[Math.max(k - 1, 0)];
      const [x, y] = toXY(here.lat, here.lon);
      const [ax, ay] = toXY(ahead.lat, ahead.lon);
      const [bx, by] = toXY(behind.lat, behind.lon);
      // Heading from the leg the vessel is on, in screen space, so the hull
      // stays aligned with the track under any pan, zoom or projection point.
      const heading = Math.atan2(ay - by, ax - bx) + Math.PI / 2;
      const colour = routeColour(active.label);
      const scale = Math.min(1.6, Math.max(0.85, view.radius / (Math.min(size.w, size.h) * 0.47)));

      // Position ring, so the vessel is findable before it is legible.
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.globalAlpha = 0.32;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, 13 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(heading);
      ctx.scale(scale, scale);

      // Wake trailing astern
      const wake = ctx.createLinearGradient(0, 4, 0, 22);
      wake.addColorStop(0, "rgba(255,255,255,0.34)");
      wake.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = wake;
      ctx.beginPath();
      ctx.moveTo(-2.2, 5);
      ctx.lineTo(2.2, 5);
      ctx.lineTo(5.2, 22);
      ctx.lineTo(-5.2, 22);
      ctx.closePath();
      ctx.fill();

      // Hull: a raked bow, parallel midbody, square transom
      ctx.beginPath();
      ctx.moveTo(0, -9.5);
      ctx.quadraticCurveTo(3.9, -5.2, 4.1, 0.4);
      ctx.lineTo(4.1, 5.4);
      ctx.lineTo(-4.1, 5.4);
      ctx.lineTo(-4.1, 0.4);
      ctx.quadraticCurveTo(-3.9, -5.2, 0, -9.5);
      ctx.closePath();
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 6;
      ctx.fillStyle = "#f3f6fb";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Superstructure block, which is what makes the shape read as a ship
      ctx.fillStyle = colour;
      ctx.fillRect(-2.5, -1.8, 5, 4.6);
      ctx.restore();
    }

    ctx.restore();

    // Ports, stations and offload points
    if (showPlaces) {
      for (const place of places) {
        const [x, y] = toXY(place.lat, place.lon);
        if (x < -60 || y < -60 || x > w + 60 || y > h + 60) continue;
        const primary = place.kind === "port" || place.kind === "offload";
        const indian = place.operator.includes("NCPOR");

        if (place.kind === "port") {
          ctx.fillStyle = "#e9ecf2";
          ctx.fillRect(x - 3, y - 3, 6, 6);
        } else if (place.kind === "offload") {
          ctx.strokeStyle = "#7da6ff";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(x, y, 4.2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = "#7da6ff";
          ctx.beginPath();
          ctx.arc(x, y, 1.7, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = indian ? "rgba(125,166,255,0.95)" : "rgba(233,236,242,0.42)";
          ctx.beginPath();
          ctx.arc(x, y, indian ? 2.8 : 1.9, 0, Math.PI * 2);
          ctx.fill();
        }

        if (primary) {
          ctx.font = LABEL_FONT;
          ctx.textAlign = "left";
          const w = ctx.measureText(place.name).width;
          ctx.fillStyle = "rgba(8,9,13,0.66)";
          ctx.fillRect(x + 5, y - 5.5, w + 5, 12);
          ctx.fillStyle = "rgba(233,236,242,0.94)";
          ctx.fillText(place.name, x + 7.5, y + 3.5);
        }
      }
    }

    // Disc rim
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [
    size, view, projection, rings, layer, routes, selectedRoute, hoveredRoute,
    icebergs, tracks, places, showIcebergs, showTracks, showGraticule, showPlaces, day,
  ]);

  useEffect(() => {
    const id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [draw]);

  /* ------------------------------------------------------ interaction */

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    setTransform((t) => {
      const next = Math.min(9, Math.max(0.85, t.scale * (e.deltaY < 0 ? 1.14 : 1 / 1.14)));
      const cx = size.w / 2 + t.tx;
      const cy = size.h / 2 + t.ty;
      const k = next / t.scale;
      return {
        scale: next,
        tx: t.tx + (mx - cx) * (1 - k),
        ty: t.ty + (my - cy) * (1 - k),
      };
    });
  }, [size.w, size.h]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, tx: transform.tx, ty: transform.ty };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag) {
      setTransform((t) => ({
        ...t,
        tx: drag.tx + (e.clientX - drag.x),
        ty: drag.ty + (e.clientY - drag.y),
      }));
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const geo = projection.toGeo(px, py, view);
    if (!geo) {
      onLeave();
      return;
    }
    onPick(geo[0], geo[1], { x: e.clientX, y: e.clientY });
  };

  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current) {
      const moved =
        Math.abs(e.clientX - dragRef.current.x) + Math.abs(e.clientY - dragRef.current.y);
      dragRef.current = null;
      setDragging(false);
      if (moved < 4) pickRoute(e);
    }
  };

  const pickRoute = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || routes.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let best = -1;
    let bestDist = 14;
    routes.forEach((route, idx) => {
      for (const [la, lo] of route.path) {
        const [x, y] = projection.toScreen(la, lo, view);
        const d = Math.hypot(x - px, y - py);
        if (d < bestDist) {
          bestDist = d;
          best = idx;
        }
      }
    });
    if (best >= 0) onSelectRoute(best);
  };

  const reset = () => setTransform({ scale: 1, tx: 0, ty: 0 });
  const zoom = (factor: number) =>
    setTransform((t) => ({ ...t, scale: Math.min(9, Math.max(0.85, t.scale * factor)) }));

  return (
    <div ref={wrapRef} className="chart-wrap">
      <canvas
        ref={canvasRef}
        className={`chart-canvas${dragging ? " dragging" : ""}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={onLeave}
      />
      <div className="overlay overlay-tr">
        <button className="icon-btn" onClick={() => zoom(1.3)} title="Zoom in" aria-label="Zoom in">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M7 3v8M3 7h8" />
          </svg>
        </button>
        <button className="icon-btn" onClick={() => zoom(1 / 1.3)} title="Zoom out" aria-label="Zoom out">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M3 7h8" />
          </svg>
        </button>
        <button className="icon-btn" onClick={reset} title="Reset view" aria-label="Reset view">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.6 5.6A4.7 4.7 0 1 1 2.3 8" />
            <path d="M1.4 2.6v3h3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
