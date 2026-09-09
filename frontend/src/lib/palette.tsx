import { useCallback, useEffect, useState } from "react";
import { setPalette as applyPalette, type Palette } from "./colormap";

/**
 * Palette, outside the console.
 *
 * The landing and sign-in screens are seen before anyone has a session, so they
 * cannot reach into the console's state. They share the stored preference
 * instead, which means a visitor who chooses the day palette on the public page
 * is still in it after signing in.
 */
const KEY = "polarpath.palette";

function read(): Palette {
  const requested = new URLSearchParams(window.location.search).get("palette");
  if (requested === "day" || requested === "night") return requested;
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored === "day" || stored === "night") return stored;
  } catch {
    /* storage can be blocked; the default is still correct */
  }
  return "night";
}

export function usePalette(): [Palette, () => void] {
  const [palette, setPalette] = useState<Palette>(read);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", palette);
    applyPalette(palette);
    try {
      window.localStorage.setItem(KEY, palette);
    } catch {
      /* not worth failing over */
    }
  }, [palette]);

  const toggle = useCallback(
    () => setPalette((p) => (p === "night" ? "day" : "night")),
    [],
  );
  return [palette, toggle];
}

export function PaletteIcon({ palette }: { palette: Palette }) {
  return palette === "night" ? (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="2.9" />
      <path d="M7 1.2v1.4M7 11.4v1.4M1.2 7h1.4M11.4 7h1.4M2.9 2.9l1 1M10.1 10.1l1 1M11.1 2.9l-1 1M3.9 10.1l-1 1" />
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 8.6A5.6 5.6 0 1 1 5.4 2a4.4 4.4 0 0 0 6.6 6.6z" />
    </svg>
  );
}
