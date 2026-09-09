/** Display formatting. One place, so the same quantity never appears two ways. */

export const nf = (v: number, digits = 0) =>
  v.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function tonnes(v: number): string {
  if (v >= 1000) return `${nf(v / 1000, 2)}k`;
  return nf(v, v < 100 ? 1 : 0);
}

export function duration(hours: number): string {
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  if (d === 0) return `${h}h`;
  return `${d}d ${h}h`;
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function longDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${d
    .toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export function coord(lat: number, lon: number): string {
  const la = `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"}`;
  const lo = `${Math.abs(lon).toFixed(2)}°${lon < 0 ? "W" : "E"}`;
  return `${la}  ${lo}`;
}

export function pct(v: number, digits = 0): string {
  return `${nf(v * 100, digits)}%`;
}

export function signed(v: number, digits = 1): string {
  return `${v > 0 ? "+" : ""}${nf(v, digits)}`;
}

export function riskLabel(v: number): string {
  if (v < 0.18) return "Low";
  if (v < 0.36) return "Guarded";
  if (v < 0.55) return "Elevated";
  if (v < 0.74) return "High";
  return "Severe";
}

/** WMO ice-cover description for a concentration in tenths. */
export function iceStage(sic: number): string {
  const tenths = sic * 10;
  if (tenths < 0.5) return "Open water";
  if (tenths < 1.5) return "Open water, trace ice";
  if (tenths < 4) return "Very open drift ice";
  if (tenths < 7) return "Open drift ice";
  if (tenths < 9) return "Close drift ice";
  if (tenths < 9.8) return "Very close drift ice";
  return "Compact ice";
}
