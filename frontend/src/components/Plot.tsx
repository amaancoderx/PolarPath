import { useId, useMemo, useState } from "react";
import { nf } from "../lib/format";

/**
 * A small SVG plotting kit.
 *
 * Deliberately hand-rolled rather than pulled from a charting library: the
 * charts here are all the same shape, they have to inherit the interface's own
 * tokens, and a library would add more weight than the four primitives below.
 */

export interface Series {
  id: string;
  label: string;
  colour: string;
  points: [number, number][];
  dashed?: boolean;
  width?: number;
  area?: boolean;
}

interface LineChartProps {
  series: Series[];
  height?: number;
  xLabel?: string;
  yLabel?: string;
  xTicks?: number[];
  yTicks?: number[];
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  yMin?: number;
  yMax?: number;
  legend?: boolean;
}

const PAD = { top: 12, right: 12, bottom: 26, left: 44 };

export function LineChart({
  series, height = 200, xTicks, yTicks, yFormat = (v) => nf(v, 2),
  xFormat = (v) => nf(v, 0), yMin, yMax, legend = true, xLabel, yLabel,
}: LineChartProps) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;

  const bounds = useMemo(() => {
    const xs = series.flatMap((s) => s.points.map((p) => p[0]));
    const ys = series.flatMap((s) => s.points.map((p) => p[1]));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = yMin ?? Math.min(...ys, 0);
    const y1 = yMax ?? Math.max(...ys);
    const pad = (y1 - y0) * 0.08 || 1;
    return { x0, x1, y0: yMin ?? y0, y1: yMax ?? y1 + pad };
  }, [series, yMin, yMax]);

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const sx = (v: number) =>
    PAD.left + ((v - bounds.x0) / (bounds.x1 - bounds.x0 || 1)) * plotW;
  const sy = (v: number) =>
    PAD.top + plotH - ((v - bounds.y0) / (bounds.y1 - bounds.y0 || 1)) * plotH;

  const yGrid = yTicks ?? niceTicks(bounds.y0, bounds.y1, 4);
  const xGrid = xTicks ?? niceTicks(bounds.x0, bounds.x1, 5);

  return (
    <div>
      <svg
        className="plot"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const rel = ((e.clientX - rect.left) / rect.width) * width;
          const v = bounds.x0 + ((rel - PAD.left) / plotW) * (bounds.x1 - bounds.x0);
          setHover(Math.min(bounds.x1, Math.max(bounds.x0, v)));
        }}
      >
        <defs>
          {series.filter((s) => s.area).map((s) => (
            <linearGradient key={s.id} id={`${uid}-${s.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.colour} stopOpacity="0.24" />
              <stop offset="100%" stopColor={s.colour} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {yGrid.map((v) => (
          <g key={`y${v}`}>
            <line
              x1={PAD.left} x2={width - PAD.right} y1={sy(v)} y2={sy(v)}
              stroke="rgba(255,255,255,0.055)" strokeWidth="1"
            />
            <text
              x={PAD.left - 7} y={sy(v) + 3} textAnchor="end"
              fill="rgba(233,236,242,0.4)" fontSize="9.5"
              fontFamily="ui-monospace, monospace"
            >
              {yFormat(v)}
            </text>
          </g>
        ))}

        {xGrid.map((v) => (
          <text
            key={`x${v}`} x={sx(v)} y={height - 8} textAnchor="middle"
            fill="rgba(233,236,242,0.4)" fontSize="9.5"
            fontFamily="ui-monospace, monospace"
          >
            {xFormat(v)}
          </text>
        ))}

        {series.map((s) => {
          const d = s.points.map((p, i) => `${i ? "L" : "M"}${sx(p[0])},${sy(p[1])}`).join(" ");
          return (
            <g key={s.id}>
              {s.area && (
                <path
                  d={`${d} L${sx(s.points[s.points.length - 1][0])},${sy(bounds.y0)} L${sx(s.points[0][0])},${sy(bounds.y0)} Z`}
                  fill={`url(#${uid}-${s.id})`}
                />
              )}
              <path
                d={d} fill="none" stroke={s.colour}
                strokeWidth={s.width ?? 1.75}
                strokeDasharray={s.dashed ? "4 3" : undefined}
                strokeLinejoin="round" strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {hover !== null && (
          <>
            <line
              x1={sx(hover)} x2={sx(hover)} y1={PAD.top} y2={PAD.top + plotH}
              stroke="rgba(255,255,255,0.22)" strokeWidth="1"
            />
            {series.map((s) => {
              const p = nearest(s.points, hover);
              if (!p) return null;
              return <circle key={s.id} cx={sx(p[0])} cy={sy(p[1])} r="3" fill={s.colour} />;
            })}
          </>
        )}
      </svg>

      {hover !== null && (
        <div className="row" style={{ gap: 14, flexWrap: "wrap", marginTop: 6, fontSize: 11 }}>
          <span className="mono muted">
            {xLabel ? `${xLabel} ` : ""}
            {xFormat(hover)}
          </span>
          {series.map((s) => {
            const p = nearest(s.points, hover);
            return (
              <span key={s.id} className="row gap-4" style={{ color: "var(--text-3)" }}>
                <i
                  style={{
                    width: 8, height: 2, borderRadius: 9, background: s.colour, display: "inline-block",
                  }}
                />
                {s.label}
                <b className="mono" style={{ color: "var(--text)", fontWeight: 500 }}>
                  {p ? yFormat(p[1]) : "—"}
                </b>
              </span>
            );
          })}
        </div>
      )}

      {legend && hover === null && (
        <div className="plot-legend">
          {series.map((s) => (
            <span key={s.id} className="item" style={{ color: s.colour }}>
              <i />
              <span style={{ color: "var(--text-3)" }}>{s.label}</span>
            </span>
          ))}
          {yLabel && <span className="item" style={{ color: "var(--text-4)" }}>{yLabel}</span>}
        </div>
      )}
    </div>
  );
}

function nearest(points: [number, number][], x: number): [number, number] | null {
  if (!points.length) return null;
  let best = points[0];
  let bd = Infinity;
  for (const p of points) {
    const d = Math.abs(p[0] - x);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    out.push(Number(v.toFixed(6)));
  }
  return out;
}

/** Horizontal comparison bars, used where two figures need to be compared. */
export function BarCompare({
  rows, format = (v: number) => nf(v, 1), max, baseline = 0,
}: {
  rows: { label: string; value: number; colour: string; note?: string }[];
  format?: (v: number) => string;
  max?: number;
  /** Zero point of the bar. Use it when every value sits in a narrow band and a
   *  bar from zero would render them all as the same full-width block. */
  baseline?: number;
}) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => (
        <div key={r.label}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>{r.label}</span>
            <span className="mono" style={{ fontSize: 12 }}>
              {format(r.value)}
              {r.note && <span className="muted" style={{ marginLeft: 6 }}>{r.note}</span>}
            </span>
          </div>
          <div className="meter">
            <i
              style={{
                width: `${Math.max(0, ((r.value - baseline) / (top - baseline || 1)) * 100)}%`,
                background: r.colour,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Scatter of the objective trade-off, with the chosen point marked. */
export function ParetoPlot({
  points, selected, onSelect, height = 210,
}: {
  points: { label: string; fuel: number; risk: number; colour: string }[];
  selected: number;
  onSelect: (i: number) => void;
  height?: number;
}) {
  const width = 640;
  const pad = { top: 14, right: 16, bottom: 30, left: 50 };
  const fuels = points.map((p) => p.fuel);
  const risks = points.map((p) => p.risk);
  const f0 = Math.min(...fuels) * 0.995;
  const f1 = Math.max(...fuels) * 1.005;
  const r0 = Math.min(...risks) * 0.9;
  const r1 = Math.max(...risks) * 1.08;
  const sx = (v: number) => pad.left + ((v - f0) / (f1 - f0 || 1)) * (width - pad.left - pad.right);
  const sy = (v: number) => pad.top + (height - pad.top - pad.bottom) * (1 - (v - r0) / (r1 - r0 || 1));

  const ordered = [...points].map((p, i) => ({ ...p, i })).sort((a, b) => a.fuel - b.fuel);

  return (
    <div>
      <svg className="plot" viewBox={`0 0 ${width} ${height}`} style={{ height }} preserveAspectRatio="none">
        <line
          x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom}
          stroke="rgba(255,255,255,0.09)"
        />
        <line
          x1={pad.left} x2={pad.left} y1={pad.top} y2={height - pad.bottom}
          stroke="rgba(255,255,255,0.09)"
        />
        <path
          d={ordered.map((p, i) => `${i ? "L" : "M"}${sx(p.fuel)},${sy(p.risk)}`).join(" ")}
          fill="none" stroke="rgba(125,166,255,0.3)" strokeWidth="1.4" strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) => (
          <g key={p.label + i} onClick={() => onSelect(i)} style={{ cursor: "pointer" }}>
            {i === selected && (
              <circle cx={sx(p.fuel)} cy={sy(p.risk)} r="10" fill={p.colour} opacity="0.18" />
            )}
            <circle
              cx={sx(p.fuel)} cy={sy(p.risk)} r={i === selected ? 5.5 : 4}
              fill={p.colour} stroke="#08090d" strokeWidth="1.4"
            />
          </g>
        ))}
        <text
          x={width / 2} y={height - 8} textAnchor="middle"
          fill="rgba(233,236,242,0.4)" fontSize="9.5" fontFamily="ui-monospace, monospace"
        >
          fuel burn, tonnes
        </text>
        <text
          x={12} y={height / 2} textAnchor="middle" transform={`rotate(-90 12 ${height / 2})`}
          fill="rgba(233,236,242,0.4)" fontSize="9.5" fontFamily="ui-monospace, monospace"
        >
          mean risk
        </text>
      </svg>
    </div>
  );
}
