import { useCallback, useRef } from "react";
import type { DayEntry } from "../lib/api";

/**
 * Forecast timeline.
 *
 * Day zero is the analysis; everything to its right is model output. The
 * distinction is drawn rather than described, because a master needs to know at
 * a glance whether they are looking at what is there or at what is predicted.
 */

export default function Timeline({
  days, day, onChange, playing, onPlay,
}: {
  days: DayEntry[];
  day: number;
  onChange: (d: number) => void;
  playing: boolean;
  onPlay: (v: boolean) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const last = days.length - 1;
  const active = days[Math.min(day, last)];

  const pick = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onChange(Math.round(f * last));
    },
    [last, onChange],
  );

  return (
    <div className="timeline">
      <button
        className="play"
        onClick={() => onPlay(!playing)}
        aria-label={playing ? "Pause the forecast animation" : "Play the forecast animation"}
        title={playing ? "Pause" : "Play forecast"}
      >
        {playing ? (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
            <rect x="2.5" y="2" width="2.6" height="8" rx="0.7" />
            <rect x="6.9" y="2" width="2.6" height="8" rx="0.7" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
            <path d="M3.4 2.3a.6.6 0 0 1 .92-.5l5.1 3.2a.6.6 0 0 1 0 1l-5.1 3.2a.6.6 0 0 1-.92-.5z" />
          </svg>
        )}
      </button>

      <div
        ref={trackRef}
        className="track"
        role="slider"
        tabIndex={0}
        aria-label="Forecast day"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={day}
        aria-valuetext={active?.label}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          pick(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) pick(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onChange(Math.min(last, day + 1));
          if (e.key === "ArrowLeft") onChange(Math.max(0, day - 1));
        }}
      >
        <div className="track-line" />
        <div className="track-fill" style={{ width: `${(day / last) * 100}%` }} />
        <div className="track-ticks">
          {days.map((d, i) => {
            const state = i === day ? "current" : i < day ? "past" : "future";
            const showLabel = i === 0 || i === last || i % 7 === 0;
            return (
              <div
                key={d.lead}
                className="tick"
                data-state={state}
                style={{ left: `${(i / last) * 100}%` }}
              >
                <span className="knob" />
                {showLabel && (
                  <span className="lbl">{i === 0 ? "Analysis" : `+${i}d`}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="timeline-readout">
        <div className="d">{active?.label ?? "—"}</div>
        <div className="k">
          {day === 0 ? "Analysis" : `Forecast T+${day}d`}
        </div>
      </div>
    </div>
  );
}
