import type { Place, Route, Vessel } from "./api";
import { coord, duration, iceStage, nf } from "./format";

/**
 * Passage plan export.
 *
 * A route that only exists inside a browser tab is not a plan. This renders the
 * selected route as the document a bridge would keep: the particulars, the
 * decision that was made and why, the leg-by-leg table with forecast ice at the
 * hour of transit, and the iceberg watch. Plain text so it survives a satellite
 * link, an email and a printer.
 */
export function renderPassagePlan(opts: {
  route: Route;
  routes: Route[];
  vessel: Vessel;
  origin: Place;
  destination: Place;
  departure: string;
  analysisDate: string;
  horizonDays: number;
}): string {
  const { route, routes, vessel, origin, destination, departure } = opts;
  const rule = (s: string, ch = "=") => ch.repeat(78) + "\n" + s;
  const row = (k: string, v: string) => `  ${k.padEnd(28)}${v}\n`;

  let out = "";
  out += "=".repeat(78) + "\n";
  out += "  PASSAGE PLAN\n";
  out += "  PolarPath  ·  Antarctic navigation decision support\n";
  out += "  NCPOR, Ministry of Earth Sciences  ·  SIH problem statement 26059\n";
  out += "=".repeat(78) + "\n\n";

  out += "VESSEL\n";
  out += row("Name", vessel.name);
  out += row("Ice class", vessel.ice_class);
  out += row("Length x beam x draft", `${nf(vessel.length_m, 0)} x ${nf(vessel.beam_m, 1)} x ${nf(vessel.draft_m, 2)} m`);
  out += row("Displacement", `${nf(vessel.displacement_t)} t`);
  out += row("Installed power", `${nf(vessel.installed_power_kw)} kW`);
  out += row("Service speed", `${nf(vessel.service_speed_kn, 1)} kn`);
  out += row("Bunker capacity", `${nf(vessel.fuel_capacity_t)} t`);
  out += "\n";

  out += "PASSAGE\n";
  out += row("From", `${origin.name}  ${coord(origin.lat, origin.lon)}`);
  out += row("To", `${destination.name}  ${coord(destination.lat, destination.lon)}`);
  out += row("Departure", new Date(departure).toUTCString());
  out += row("Estimated arrival", new Date(route.eta).toUTCString());
  out += row("Forecast cycle", `${opts.analysisDate} analysis, ${opts.horizonDays} day horizon`);
  out += "\n";

  out += `PLAN SELECTED: ${route.label.toUpperCase()}\n`;
  out += row("Objective weighting", `fuel ${nf(route.weights.fuel * 100)} / safety ${nf(route.weights.safety * 100)}`);
  out += row("Distance", `${nf(route.distance_nm)} nm  (${nf(route.distance_km)} km)`);
  out += row("Passage time", duration(route.duration_h));
  out += row("Estimated fuel", `${nf(route.fuel_t, 1)} t   (${nf(100 * route.fuel_t / vessel.fuel_capacity_t, 0)} percent of bunkers)`);
  out += row("Mean speed made good", `${nf(route.mean_speed_kn, 1)} kn`);
  out += row("Hours in ice", `${nf(route.ice_hours, 0)} h, of which ${nf(route.close_pack_hours, 0)} h in close pack`);
  out += row("Heaviest ice expected", `${nf(route.max_thickness_m, 2)} m at ${nf(route.max_sic, 2)} cover  (${iceStage(route.max_sic)})`);
  out += row("Mean risk index", nf(route.mean_risk, 3));
  out += row("Peak risk index", nf(route.peak_risk, 3));
  out += "\n";

  out += "ALTERNATIVES CONSIDERED\n";
  out += "  " + "Option".padEnd(18) + "Fuel".padStart(9) + "Time".padStart(11) +
    "Risk".padStart(9) + "Close pack".padStart(13) + "\n";
  out += "  " + "-".repeat(58) + "\n";
  for (const r of routes) {
    const mark = r === route ? " <-" : "";
    out += "  " + r.label.padEnd(18) +
      `${nf(r.fuel_t, 1)} t`.padStart(9) +
      duration(r.duration_h).padStart(11) +
      nf(r.mean_risk, 3).padStart(9) +
      `${nf(r.close_pack_hours, 0)} h`.padStart(13) + mark + "\n";
  }
  out += "\n  Every option above is Pareto optimal: none can be improved on fuel,\n";
  out += "  time and risk together. The choice between them is the master's.\n\n";

  out += "LEG TABLE\n";
  out += "  " + "Elapsed".padEnd(10) + "Position".padEnd(24) + "Ice".padStart(6) +
    "Thick".padStart(8) + "Speed".padStart(8) + "Risk".padStart(7) + "Fuel".padStart(9) + "\n";
  out += "  " + "-".repeat(72) + "\n";
  for (const p of route.profile) {
    out += "  " + duration(p.hour).padEnd(10) +
      coord(p.lat, p.lon).padEnd(24) +
      nf(p.sic, 2).padStart(6) +
      `${nf(p.thickness_m, 2)} m`.padStart(8) +
      `${nf(p.speed_kn, 1)} kn`.padStart(8) +
      nf(p.risk, 2).padStart(7) +
      `${nf(p.cumulative_fuel_t, 1)} t`.padStart(9) + "\n";
  }
  out += "\n";

  if (route.encounters && route.encounters.length) {
    out += "ICEBERG WATCH\n";
    out += "  Closest approach to each tracked berg, using its predicted position\n";
    out += "  at the hour the vessel reaches that part of the track.\n\n";
    out += "  " + "Berg".padEnd(10) + "CPA".padStart(10) + "At".padStart(10) +
      "Length".padStart(10) + "Draft".padStart(10) + "  Position\n";
    out += "  " + "-".repeat(66) + "\n";
    for (const b of route.encounters) {
      out += "  " + b.id.padEnd(10) +
        `${nf(b.cpa_km, 1)} km`.padStart(10) +
        duration(b.at_hour).padStart(10) +
        `${nf(b.length_m / 1000, 1)} km`.padStart(10) +
        `${nf(b.draft_m, 0)} m`.padStart(10) +
        "  " + coord(b.lat, b.lon) + "\n";
    }
    out += "\n";
  }

  out += rule("BASIS AND LIMITATIONS\n", "-");
  out += "  Ice resistance follows Lindqvist (1989), decomposed into crushing,\n";
  out += "  bending and submersion. Attainable speed is solved against installed\n";
  out += "  power with a 15 percent sea margin, not assumed. Ice fields are model\n";
  out += "  forecasts and carry the error stated in the skill report; iceberg\n";
  out += "  positions carry a position error that grows with lead time. This plan\n";
  out += "  is decision support. It does not replace the judgement of the master,\n";
  out += "  the ice charts issued for the area, or a visual ice watch.\n";
  out += "-".repeat(78) + "\n";
  out += `  Generated ${new Date().toUTCString()}\n`;

  return out;
}

/** Hand the plan to the browser as a file. */
export function downloadPassagePlan(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
