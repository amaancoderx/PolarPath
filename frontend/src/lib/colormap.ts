/**
 * Layer colour ramps.
 *
 * Each ramp is defined by a handful of anchors and expanded once into a 256
 * entry lookup table, so painting a field is a table read per pixel rather than
 * an interpolation. Alpha is part of the ramp: open water has to stay
 * transparent so the chart underneath still reads.
 */

export type Stop = [number, number, number, number, number]; // t, r, g, b, a

export interface Ramp {
  id: string;
  label: string;
  unit: string;
  stops: Stop[];
  ticks: string[];
}

export const RAMPS: Record<string, Ramp> = {
  sic: {
    id: "sic",
    label: "Sea-ice concentration",
    unit: "fraction",
    ticks: ["0", "0.5", "1.0"],
    stops: [
      [0.0, 8, 24, 42, 0],
      [0.08, 14, 34, 56, 90],
      [0.15, 18, 44, 70, 190],
      [0.3, 26, 62, 96, 226],
      [0.5, 44, 90, 128, 240],
      [0.7, 84, 134, 172, 248],
      [0.85, 148, 186, 212, 252],
      [0.95, 208, 227, 240, 254],
      [1.0, 244, 250, 254, 255],
    ],
  },
  thickness: {
    id: "thickness",
    label: "Ice thickness",
    unit: "m",
    ticks: ["0", "1.75", "3.5"],
    stops: [
      [0.0, 10, 26, 43, 0],
      [0.05, 14, 44, 62, 150],
      [0.2, 20, 82, 104, 218],
      [0.42, 56, 146, 148, 238],
      [0.64, 148, 182, 128, 246],
      [0.82, 216, 200, 142, 251],
      [1.0, 252, 246, 232, 255],
    ],
  },
  risk: {
    id: "risk",
    label: "Navigational risk",
    unit: "index",
    ticks: ["low", "moderate", "severe"],
    stops: [
      [0.0, 20, 60, 48, 0],
      [0.1, 34, 104, 78, 110],
      [0.3, 96, 158, 82, 180],
      [0.5, 214, 168, 60, 215],
      [0.7, 226, 112, 62, 235],
      [0.88, 214, 62, 62, 248],
      [1.0, 176, 34, 44, 255],
    ],
  },
  speed: {
    id: "speed",
    label: "Attainable speed",
    unit: "of service speed",
    ticks: ["beset", "50%", "full"],
    stops: [
      [0.0, 168, 34, 44, 250],
      [0.18, 214, 84, 62, 235],
      [0.42, 226, 168, 60, 215],
      [0.68, 130, 190, 108, 190],
      [0.88, 79, 209, 165, 140],
      [1.0, 79, 209, 165, 0],
    ],
  },
  bergs: {
    id: "bergs",
    label: "Iceberg exposure",
    unit: "index",
    ticks: ["none", "moderate", "dense"],
    stops: [
      [0.0, 60, 40, 96, 0],
      [0.12, 96, 66, 158, 120],
      [0.4, 140, 104, 224, 195],
      [0.7, 180, 140, 255, 230],
      [1.0, 226, 206, 255, 250],
    ],
  },
};

const CACHE = new Map<string, Uint8ClampedArray>();

/** 256-entry RGBA lookup table for a ramp. */
export function lut(id: string): Uint8ClampedArray {
  const cached = CACHE.get(id);
  if (cached) return cached;
  const ramp = RAMPS[id] ?? RAMPS.sic;
  const table = new Uint8ClampedArray(256 * 4);
  let seg = 0;
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    while (seg < ramp.stops.length - 2 && t > ramp.stops[seg + 1][0]) seg++;
    const a = ramp.stops[seg];
    const b = ramp.stops[Math.min(seg + 1, ramp.stops.length - 1)];
    const span = b[0] - a[0] || 1;
    const f = Math.min(Math.max((t - a[0]) / span, 0), 1);
    table[i * 4 + 0] = a[1] + (b[1] - a[1]) * f;
    table[i * 4 + 1] = a[2] + (b[2] - a[2]) * f;
    table[i * 4 + 2] = a[3] + (b[3] - a[3]) * f;
    table[i * 4 + 3] = a[4] + (b[4] - a[4]) * f;
  }
  CACHE.set(id, table);
  return table;
}

/** CSS gradient for the legend swatch. */
export function cssRamp(id: string): string {
  const ramp = RAMPS[id] ?? RAMPS.sic;
  const parts = ramp.stops.map(
    ([t, r, g, b, a]) => `rgba(${r},${g},${b},${(a / 255).toFixed(3)}) ${(t * 100).toFixed(1)}%`,
  );
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

/*
 * Route identity comes in two weights.
 *
 * The chart always has a dark ocean under it, so `routeColour` is fixed and
 * bright. Panels sit on the page and follow the palette, so `routeInk` darkens
 * the same identities enough to stay legible on white. Both agree on hue, which
 * is what lets the eye follow one route from a card onto the chart.
 */
export const ROUTE_COLOURS: Record<string, string> = {
  Safest: "#4fd1a5",
  Balanced: "#f0b429",
  "Fuel optimal": "#ff7a66",
  Alternative: "rgba(233,236,242,0.34)",
  "Reported track": "#8892a6",
};

const ROUTE_INK_DAY: Record<string, string> = {
  Safest: "#0f7a52",
  Balanced: "#a16207",
  "Fuel optimal": "#c2410c",
  Alternative: "rgba(16,24,40,0.45)",
  "Reported track": "#667085",
};

export type Palette = "night" | "day";
let ACTIVE: Palette = "night";

export function setPalette(p: Palette): void {
  ACTIVE = p;
}

function lookup(table: Record<string, string>, label: string): string {
  if (label.startsWith("Alternative")) return table.Alternative;
  return table[label] ?? table.Alternative;
}

/** Route colour for the chart, which is dark in both palettes. */
export function routeColour(label: string): string {
  return lookup(ROUTE_COLOURS, label);
}

/** Route colour for panel text and swatches, which follow the palette. */
export function routeInk(label: string): string {
  return lookup(ACTIVE === "day" ? ROUTE_INK_DAY : ROUTE_COLOURS, label);
}

const RISK_NIGHT = ["#4fd1a5", "#9ecb63", "#f0b429", "#f08c3c", "#ff6b6b"];
const RISK_DAY = ["#0f7a52", "#4d7c0f", "#a16207", "#c2410c", "#b42318"];

function riskBand(v: number): number {
  if (v < 0.18) return 0;
  if (v < 0.36) return 1;
  if (v < 0.55) return 2;
  if (v < 0.74) return 3;
  return 4;
}

/** Traffic-light colour for a risk value in [0, 1], for the chart. */
export function riskColour(v: number): string {
  return RISK_NIGHT[riskBand(v)];
}

/** The same scale, darkened for panel text when the day palette is active. */
export function riskInk(v: number): string {
  return (ACTIVE === "day" ? RISK_DAY : RISK_NIGHT)[riskBand(v)];
}
