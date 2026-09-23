import { createContext, useContext } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setPalette, type Palette } from "./colormap";
import {
  api,
  type Bootstrap,
  type DecodedLayer,
  type DriftField,
  type IcebergPoint,
  type IcebergTrack,
  type Place,
  type RoutePlan,
} from "./api";

/**
 * Console state.
 *
 * One hook owns the session so the chart, the rails and the report views can
 * never disagree about which vessel, day or plan is on screen. Raster tiles are
 * memoised by layer, day and hull, and the whole forecast window is prefetched
 * in the background once the first frame is up, so scrubbing the timeline never
 * waits on the network.
 */

export type Tab = "overview" | "operations" | "skill" | "benchmark" | "method" | "admin";

/*
 * Deep-link parameters are read once, when the bundle first executes, rather
 * than when the console mounts. Signing in redirects through two screens before
 * the console exists, and reading the address bar at mount time would only ever
 * see whatever survived that journey.
 */
const INITIAL_PARAMS = new URLSearchParams(window.location.search);

export interface Toggles {
  icebergs: boolean;
  tracks: boolean;
  drift: boolean;
  graticule: boolean;
  places: boolean;
}

export function useConsoleState() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [status, setStatus] = useState("connecting");

  // Query parameters make any console state directly linkable, which is how the
  // screenshot capture reaches each view and how a briefing can point at one
  // specific passage.
  const params = INITIAL_PARAMS;
  const [tab, setTab] = useState<Tab>(() => {
    const requested = params.get("view");
    const known: Tab[] = ["overview", "operations", "skill", "benchmark", "method", "admin"];
    return known.includes(requested as Tab) ? (requested as Tab) : "overview";
  });
  const [vesselId, setVesselId] = useState(params.get("vessel") ?? "golovnin");
  const [originId, setOriginId] = useState(params.get("from") ?? "cpt");
  const [destinationId, setDestinationId] = useState(params.get("to") ?? "bharati_anchorage");

  const [palette, setPalette_] = useState<Palette>(() => {
    const requested = params.get("palette");
    if (requested === "day" || requested === "night") return requested;
    try {
      const stored = window.localStorage.getItem("polarpath.palette");
      if (stored === "day" || stored === "night") return stored;
    } catch {
      /* private browsing or blocked storage, fall through to the default */
    }
    return "night";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", palette);
    setPalette(palette);
    try {
      window.localStorage.setItem("polarpath.palette", palette);
    } catch {
      /* not worth failing the session over */
    }
  }, [palette]);

  const [layerId, setLayerId] = useState(params.get("layer") ?? "sic");
  const [day, setDay] = useState(Number(params.get("day") ?? 0) || 0);
  const [playing, setPlaying] = useState(false);

  const [layer, setLayer] = useState<DecodedLayer | null>(null);
  const [icebergs, setIcebergs] = useState<IcebergPoint[]>([]);
  const [tracks, setTracks] = useState<IcebergTrack[]>([]);

  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [hoveredRoute, setHoveredRoute] = useState<number | null>(null);

  const [toggles, setToggles] = useState<Toggles>({
    icebergs: true,
    // Trajectories are the point of the iceberg model, so they are on from the
    // first frame rather than hidden behind a checkbox.
    tracks: true,
    drift: true,
    graticule: true,
    places: true,
  });

  const [drift, setDrift] = useState<DriftField | null>(null);
  const driftCache = useRef(new Map<number, DriftField>());

  const layerCache = useRef(new Map<string, DecodedLayer>());
  const bergCache = useRef(new Map<number, IcebergPoint[]>());

  /* --------------------------------------------------------- connection */

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const attempt = async () => {
      try {
        const health = await api.health();
        if (cancelled) return;
        setStatus(health.status);
        if (!health.ready) {
          timer = window.setTimeout(attempt, 900);
          return;
        }
        const data = await api.bootstrap();
        if (cancelled) return;
        setBoot(data);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setStatus("waiting for the engine");
        setBootError(err instanceof Error ? err.message : String(err));
        timer = window.setTimeout(attempt, 1400);
      }
    };
    attempt();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  /* ------------------------------------------------------------- layers */

  const layerKey = useCallback(
    (name: string, d: number) => `${name}|${d}|${name === "sic" || name === "thickness" ? "-" : vesselId}`,
    [vesselId],
  );

  useEffect(() => {
    if (!boot) return;
    let cancelled = false;
    const key = layerKey(layerId, day);
    const cached = layerCache.current.get(key);
    if (cached) {
      setLayer(cached);
      return;
    }
    api
      .layer(layerId, day, vesselId)
      .then((data) => {
        if (cancelled) return;
        layerCache.current.set(key, data);
        setLayer(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [boot, layerId, day, vesselId, layerKey]);

  // Warm the rest of the window once the visible frame has landed.
  useEffect(() => {
    if (!boot || !layer) return;
    let cancelled = false;
    const run = async () => {
      for (let d = 0; d <= boot.snapshot.horizon_days; d++) {
        if (cancelled) return;
        const key = layerKey(layerId, d);
        if (layerCache.current.has(key)) continue;
        try {
          const data = await api.layer(layerId, d, vesselId);
          if (cancelled) return;
          layerCache.current.set(key, data);
        } catch {
          return;
        }
      }
    };
    const id = window.setTimeout(run, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [boot, layer, layerId, vesselId, layerKey]);

  // Invalidate hull-dependent tiles when the vessel changes.
  useEffect(() => {
    for (const key of [...layerCache.current.keys()]) {
      if (!key.endsWith("|-")) layerCache.current.delete(key);
    }
  }, [vesselId]);

  /* ----------------------------------------------------------- icebergs */

  useEffect(() => {
    if (!boot) return;
    let cancelled = false;
    const cached = bergCache.current.get(day);
    if (cached) {
      setIcebergs(cached);
      return;
    }
    api
      .icebergs(day)
      .then((r) => {
        if (cancelled) return;
        bergCache.current.set(day, r.icebergs);
        setIcebergs(r.icebergs);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [boot, day]);

  useEffect(() => {
    if (!boot || !toggles.tracks || tracks.length) return;
    api.icebergTracks(30).then((r) => setTracks(r.tracks)).catch(() => undefined);
  }, [boot, toggles.tracks, tracks.length]);

  // The drift field drives the animated streamlines. One request per forecast
  // day, then it is cached, because scrubbing the timeline must stay instant.
  useEffect(() => {
    if (!boot || !toggles.drift) return;
    let cancelled = false;
    const cached = driftCache.current.get(day);
    if (cached) {
      setDrift(cached);
      return;
    }
    api
      .drift(day)
      .then((field) => {
        if (cancelled) return;
        driftCache.current.set(day, field);
        setDrift(field);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [boot, day, toggles.drift]);

  /* ------------------------------------------------------------ routing */

  const runPlan = useCallback(async () => {
    if (!boot) return;
    setPlanning(true);
    setPlanError(null);
    try {
      const result = await api.route({
        vessel_id: vesselId,
        origin_id: originId,
        destination_id: destinationId,
      });
      setPlan(result);
      const balanced = result.routes.findIndex((r) => r.label === "Balanced");
      setSelectedRoute(balanced >= 0 ? balanced : Math.floor(result.routes.length / 2));
    } catch (err) {
      setPlan(null);
      setPlanError(err instanceof Error ? err.message.replace(/^\d+\s*/, "") : String(err));
    } finally {
      setPlanning(false);
    }
  }, [boot, vesselId, originId, destinationId]);

  // Plan as soon as the engine is up, and again whenever the passage changes, so
  // the chart is never showing a route that belongs to a different hull. The
  // short delay coalesces a run of selections into one solve.
  useEffect(() => {
    if (!boot) return;
    const id = window.setTimeout(() => void runPlan(), 120);
    return () => window.clearTimeout(id);
  }, [boot, runPlan]);

  /* ---------------------------------------------------------- animation */

  useEffect(() => {
    if (!playing || !boot) return;
    const id = window.setInterval(() => {
      setDay((d) => (d >= boot.snapshot.horizon_days ? 0 : d + 1));
    }, 780);
    return () => window.clearInterval(id);
  }, [playing, boot]);

  /* -------------------------------------------------------------- derive */

  const places = useMemo<Place[]>(() => {
    if (!boot) return [];
    return [...boot.ports, ...boot.stations, ...boot.offloads];
  }, [boot]);

  const destinations = useMemo<Place[]>(() => {
    if (!boot) return [];
    return [...boot.offloads, ...boot.stations.filter((s) => s.id !== "dg")];
  }, [boot]);

  const vessel = useMemo(
    () => boot?.fleet.find((v) => v.id === vesselId) ?? null,
    [boot, vesselId],
  );

  const activeDay = boot?.days[Math.min(day, boot.days.length - 1)] ?? null;
  const route = plan?.routes[selectedRoute] ?? null;

  const domain = useMemo(() => {
    const g = boot?.snapshot.grid;
    return {
      latMin: g?.lat_min ?? -78,
      latMax: g?.lat_max ?? -32,
      lonMin: g?.lon_min ?? -180,
      lonMax: g?.lon_max ?? 180,
      latStep: g?.lat_step ?? 0.5,
      lonStep: g?.lon_step ?? 1,
      nLat: g?.n_lat ?? 93,
      nLon: g?.n_lon ?? 360,
    };
  }, [boot]);

  const toggle = useCallback((key: keyof Toggles) => {
    setToggles((t) => ({ ...t, [key]: !t[key] }));
  }, []);

  return {
    boot, bootError, status,
    palette, setPalette: setPalette_,
    tab, setTab,
    vesselId, setVesselId, vessel,
    originId, setOriginId, destinationId, setDestinationId,
    layerId, setLayerId, layer,
    day, setDay, activeDay, playing, setPlaying,
    icebergs, tracks, drift,
    plan, planning, planError, runPlan,
    selectedRoute, setSelectedRoute, hoveredRoute, setHoveredRoute, route,
    toggles, toggle,
    places, destinations, domain,
  };
}

export type ConsoleState = ReturnType<typeof useConsoleState>;

export const ConsoleContext = createContext<ConsoleState | null>(null);

export function useConsole(): ConsoleState {
  const value = useContext(ConsoleContext);
  if (!value) throw new Error("ConsoleContext is missing");
  return value;
}
