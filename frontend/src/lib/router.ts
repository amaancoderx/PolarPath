import { useEffect, useState } from "react";

/**
 * A router the size of the problem.
 *
 * Three destinations, no nested routes, no route parameters. Pulling in a
 * routing library for that would add more to the bundle than the whole
 * navigation layer weighs.
 */

export type Path = "/" | "/signin" | "/console";

function normalise(raw: string): Path {
  if (raw.startsWith("/signin")) return "/signin";
  if (raw.startsWith("/console") || raw.startsWith("/app")) return "/console";
  return "/";
}

export function navigate(path: Path, search = ""): void {
  const url = path + (search ? (search.startsWith("?") ? search : `?${search}`) : "");
  if (window.location.pathname + window.location.search !== url) {
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

export function useRoute(): Path {
  const [path, setPath] = useState<Path>(() => normalise(window.location.pathname));
  useEffect(() => {
    const onChange = () => setPath(normalise(window.location.pathname));
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return path;
}
