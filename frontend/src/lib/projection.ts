/**
 * South polar stereographic projection.
 *
 * The chart is the view a polar navigator actually reads: the pole at the
 * centre, the Greenwich meridian running down the page, 90 E to the right and
 * the dateline at the top. Latitude maps through
 *
 *     rho = tan(pi/4 + phi/2)
 *
 * which is zero at the pole and grows towards the equator, normalised so the
 * northern edge of the analysis domain sits on the unit circle.
 */

export const DEG = Math.PI / 180;

export interface Domain {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  latStep: number;
  lonStep: number;
  nLat: number;
  nLon: number;
}

export interface View {
  /** Centre of the projection disc in device pixels. */
  cx: number;
  cy: number;
  /** Radius in device pixels that corresponds to the domain's northern edge. */
  radius: number;
}

export class Projection {
  readonly rhoMax: number;

  constructor(private readonly latMax: number) {
    this.rhoMax = Math.tan(Math.PI / 4 + (latMax * DEG) / 2);
  }

  /** Unit-disc coordinates. The origin is the south pole, |p| = 1 at latMax. */
  unit(lat: number, lon: number): [number, number] {
    const k = Math.tan(Math.PI / 4 + (lat * DEG) / 2) / this.rhoMax;
    const l = lon * DEG;
    return [k * Math.sin(l), k * Math.cos(l)];
  }

  toScreen(lat: number, lon: number, view: View): [number, number] {
    const [x, y] = this.unit(lat, lon);
    return [view.cx + x * view.radius, view.cy + y * view.radius];
  }

  /** Inverse of {@link toScreen}. Returns null outside the projected disc. */
  toGeo(px: number, py: number, view: View): [number, number] | null {
    const x = (px - view.cx) / view.radius;
    const y = (py - view.cy) / view.radius;
    const k = Math.hypot(x, y);
    if (k > 1.0001) return null;
    const rho = k * this.rhoMax;
    const lat = (2 * Math.atan(rho) - Math.PI / 2) / DEG;
    let lon = Math.atan2(x, y) / DEG;
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;
    return [lat, lon];
  }
}

/**
 * Per-pixel geographic lookup for the current view.
 *
 * Inverting the projection for every pixel of a full-screen canvas costs a few
 * tens of milliseconds. It only depends on the view transform, so it is built
 * once per pan or zoom and reused for every layer and every forecast day, which
 * is what keeps the timeline scrubbing smooth.
 */
export class GeoLookup {
  readonly latIndex: Float32Array;
  readonly lonIndex: Float32Array;
  readonly inside: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    projection: Projection,
    view: View,
    domain: Domain,
  ) {
    const n = width * height;
    this.latIndex = new Float32Array(n);
    this.lonIndex = new Float32Array(n);
    this.inside = new Uint8Array(n);

    const { cx, cy, radius } = view;
    const rhoMax = projection.rhoMax;
    const invRadius = 1 / radius;

    for (let py = 0; py < height; py++) {
      const dy = (py + 0.5 - cy) * invRadius;
      const rowBase = py * width;
      for (let px = 0; px < width; px++) {
        const dx = (px + 0.5 - cx) * invRadius;
        const k = Math.sqrt(dx * dx + dy * dy);
        const i = rowBase + px;
        if (k > 1) continue;
        const rho = k * rhoMax;
        const lat = (2 * Math.atan(rho) - Math.PI / 2) / DEG;
        if (lat < domain.latMin || lat > domain.latMax) continue;
        let lon = Math.atan2(dx, dy) / DEG;
        if (lon < domain.lonMin) lon += 360;
        this.inside[i] = 1;
        this.latIndex[i] = (lat - domain.latMin) / domain.latStep;
        this.lonIndex[i] = (lon - domain.lonMin) / domain.lonStep;
      }
    }
  }
}

/** Great-circle interpolation, used to draw route legs as true tracks. */
export function greatCircle(
  a: [number, number],
  b: [number, number],
  steps = 12,
): [number, number][] {
  const [lat1, lon1] = [a[0] * DEG, a[1] * DEG];
  const [lat2, lon2] = [b[0] * DEG, b[1] * DEG];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    );
  if (!isFinite(d) || d < 1e-9) return [a, b];
  const out: [number, number][] = [];
  for (let s = 0; s <= steps; s++) {
    const f = s / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    out.push([
      Math.atan2(z, Math.hypot(x, y)) / DEG,
      Math.atan2(y, x) / DEG,
    ]);
  }
  return out;
}
