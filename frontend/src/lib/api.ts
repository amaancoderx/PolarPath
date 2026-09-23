/** Typed client for the PolarPath backend. */

import { invalidate, token } from "./session";

export interface Place {
  id: string;
  name: string;
  kind: string;
  operator: string;
  lat: number;
  lon: number;
  note: string;
}

export interface Vessel {
  id: string;
  name: string;
  role: string;
  operator: string;
  ice_class: string;
  ice_class_short: string;
  length_m: number;
  beam_m: number;
  draft_m: number;
  displacement_t: number;
  installed_power_kw: number;
  service_speed_kn: number;
  service_power_kw: number;
  max_level_ice_m: number;
  fuel_capacity_t: number;
  sfoc_g_per_kwh: number;
  note: string;
}

export interface DayEntry {
  lead: number;
  valid: string;
  label: string;
  kind: "analysis" | "forecast";
}

export interface Snapshot {
  reference_date: string;
  horizon_days: number;
  status: string;
  ready: boolean;
  timings: Record<string, number>;
  grid: Record<string, number>;
  sea_ice_backend: string;
  iceberg_backend: string;
  sea_ice_training: Record<string, unknown>;
  iceberg_training: Record<string, unknown>;
  tracked_bergs: number;
  ice_extent_km2: number;
  mean_concentration: number;
}

export interface Bootstrap {
  snapshot: Snapshot;
  atlas: { grid: Record<string, number>; cells: number; ocean_cells: number; coastline_rings: number };
  coastline: { source: string; rings: number[][] };
  days: DayEntry[];
  fleet: Vessel[];
  ports: Place[];
  stations: Place[];
  offloads: Place[];
  voyages: Voyage[];
  layers: { id: string; label: string; unit: string; source: string }[];
}

export interface Voyage {
  id: string;
  label: string;
  short_label: string;
  vessel_id: string;
  origin_id: string;
  destination_id: string;
  departure: string;
  reported_days: number;
  waypoints: [number, number][];
  note: string;
}

export interface RasterLayer {
  layer: string;
  day: number;
  valid: string;
  width: number;
  height: number;
  min: number;
  max: number;
  land_value: number;
  data: string;
}

export interface DecodedLayer extends Omit<RasterLayer, "data"> {
  bytes: Uint8Array;
}

/** Free-drift ice velocity on a decimated grid, for the drift overlay. */
export interface DriftMeta {
  day: number;
  valid: string;
  stride: number;
  n_lat: number;
  n_lon: number;
  lat_min: number;
  lon_min: number;
  lat_step: number;
  lon_step: number;
}

interface DriftPayload extends DriftMeta {
  u: number[];
  v: number[];
  sic: number[];
}

export interface DriftField extends DriftMeta {
  u: Float32Array;
  v: Float32Array;
  sic: Float32Array;
}

export interface ProfilePoint {
  hour: number;
  lat: number;
  lon: number;
  sic: number;
  thickness_m: number;
  speed_kn: number;
  risk: number;
  cumulative_fuel_t: number;
  cumulative_km: number;
}

export interface BergEncounter {
  id: string;
  cpa_km: number;
  at_hour: number;
  lat: number;
  lon: number;
  length_m: number;
  draft_m: number;
}

export interface Route {
  label: string;
  weights: { fuel: number; safety: number };
  path: [number, number][];
  fuel_t: number;
  duration_h: number;
  duration_days: number;
  distance_km: number;
  distance_nm: number;
  mean_risk: number;
  peak_risk: number;
  mean_speed_kn: number;
  max_sic: number;
  max_thickness_m: number;
  ice_hours: number;
  close_pack_hours: number;
  eta: string;
  profile: ProfilePoint[];
  encounters?: BergEncounter[];
}

export interface RoutePlan {
  vessel: Vessel;
  origin: Place;
  destination: Place;
  departure: string;
  direct_km: number;
  corridor_cells: number;
  solve_seconds: number;
  routes: Route[];
  reference_fuel_t: number;
}

export interface IcebergPoint {
  id: string;
  lat: number;
  lon: number;
  length_m: number;
  draft_m: number;
  area_km2: number;
  size_class: string;
  named: boolean;
  first_seen: string;
}

export interface IcebergTrack {
  id: string;
  named: boolean;
  length_m: number;
  draft_m: number;
  area_km2: number | null;
  size_class: string | null;
  track: [number, number][];
}

export interface SkillReport {
  sea_ice: {
    initialisations: number;
    window: [string, string];
    threshold: number;
    note: string;
    by_lead: {
      lead_days: number;
      rmse: number;
      rmse_persistence: number;
      rmse_climatology: number;
      rmse_advection: number;
      skill_vs_persistence: number;
      iiee_km2: number;
      ice_edge_accuracy: number;
    }[];
  };
  drift: {
    holdout_bergs: number;
    window: [string, string];
    note: string;
    by_horizon: {
      horizon_days: number;
      physics_mean_km: number;
      physics_median_km: number;
      corrected_mean_km: number;
      corrected_median_km: number;
      improvement_pct: number;
    }[];
  };
  sea_ice_backend: string;
  iceberg_backend: string;
  sea_ice_training: Record<string, unknown>;
  iceberg_training: Record<string, unknown>;
}

export interface Benchmark {
  voyage: Voyage;
  vessel: Vessel;
  feasible: boolean;
  reported: Route;
  planned: Route[];
  recommended: string | null;
  rule: string;
  risk_constrained?: boolean;
  delta: {
    fuel_t: number;
    fuel_pct: number;
    duration_h: number;
    duration_pct: number;
    risk: number;
    distance_km: number;
    co2_t: number;
    close_pack_hours: number;
  } | null;
}

export interface Sounding {
  lat: number;
  lon: number;
  day: number;
  valid: string;
  land: boolean;
  sic: number;
  thickness_m: number;
  risk: number;
  berg_exposure: number;
  speed_kn: number;
  fuel_kg_per_km: number;
  passable: boolean;
  wind_ms: number;
  current_ms: number;
  service_speed_kn: number;
}

export interface CapabilityReport {
  vessel: Vessel;
  curve: {
    thickness_m: number;
    speed_kn: number;
    power_kw: number;
    fuel_kg_per_h: number;
    ice_resistance_kn: number;
  }[];
}

const BASE = "/api";

function authorised(extra?: HeadersInit): HeadersInit {
  const bearer = token();
  return { ...(extra ?? {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) };
}

async function unwrap<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    // The token is gone or expired. Drop it so the shell falls back to the
    // sign-in screen rather than showing an empty dashboard.
    invalidate();
    throw new Error("Session expired. Please sign in again.");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.detail ?? JSON.stringify(body);
    } catch {
      detail = (await res.text().catch(() => res.statusText)) || res.statusText;
    }
    throw new Error(`${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  return unwrap<T>(await fetch(`${BASE}${path}`, { signal, headers: authorised() }));
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: authorised({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    }),
  );
}

function decodeBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export const api = {
  health: () => get<{ ready: boolean; status: string; timings: Record<string, number> }>("/health"),
  bootstrap: () => get<Bootstrap>("/bootstrap"),

  async layer(name: string, day: number, vessel: string, signal?: AbortSignal): Promise<DecodedLayer> {
    const raw = await get<RasterLayer>(`/layer/${name}?day=${day}&vessel=${vessel}`, signal);
    const { data, ...rest } = raw;
    return { ...rest, bytes: decodeBytes(data) };
  },

  async drift(day: number, stride = 3): Promise<DriftField> {
    const raw = await get<DriftPayload>(`/drift?day=${day}&stride=${stride}`);
    const { u, v, sic, ...meta } = raw;
    return { ...meta, u: Float32Array.from(u), v: Float32Array.from(v), sic: Float32Array.from(sic) };
  },

  icebergs: (day: number) => get<{ day: number; count: number; icebergs: IcebergPoint[] }>(`/icebergs?day=${day}`),
  icebergTracks: (limit = 28) => get<{ count: number; tracks: IcebergTrack[] }>(`/icebergs/tracks?limit=${limit}`),
  route: (body: { vessel_id: string; origin_id: string; destination_id: string; departure?: string }) =>
    post<RoutePlan>("/route", body),
  point: (lat: number, lon: number, day: number, vessel: string) =>
    get<Sounding>(`/point?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&day=${day}&vessel=${vessel}`),
  skill: () => get<SkillReport>("/skill"),
  capability: (vesselId: string) => get<CapabilityReport>(`/capability/${vesselId}`),
  benchmark: (voyageId: string) => get<Benchmark>(`/benchmark/${voyageId}`),
  users: () => get<{ users: AdminUser[]; roles: AdminRole[] }>("/admin/users"),
  audit: (limit = 120) => get<{ entries: AuditEntry[] }>(`/admin/audit?limit=${limit}`),
};

export interface AdminUser {
  email: string;
  name: string;
  role: string;
  role_label: string;
  organisation: string;
  views: string[];
}

export interface AdminRole {
  id: string;
  label: string;
  description: string;
  views: string[];
}

export interface AuditEntry {
  at: string;
  action: string;
  actor: string;
  detail: string;
  outcome: string;
}
