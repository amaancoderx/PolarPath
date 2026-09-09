# PolarPath demonstration brief

Everything below is produced live by the running system. No figure on any screen is typed in.

---

## Before you start

```powershell
.\run.ps1
```

Wait for `Engine ready` in the terminal, then open **http://127.0.0.1:8000**.

That lands on the public page. Click **Sign in** and pick one of the three seeded accounts,
which are listed on the sign-in screen itself:

| Account | Password | Role | Sees |
| --- | --- | --- | --- |
| `admin@ncpor.gov.in` | `PolarPath@2026` | Research Administrator | Everything, including the user register and audit trail |
| `analyst@ncpor.gov.in` | `Analyst@2026` | Forecast Analyst | Everything except administration |
| `master@isea.in` | `Master@2026` | Vessel Master | Overview, Operations and Method only |

`http://127.0.0.1:8000/signin?as=administrator` signs straight in, which is useful when you are
setting up the room. Swap `administrator` for `analyst` or `master`.

The artefacts are already built, so start-up takes a few seconds. If the machine is cold, the
first `run.ps1` trains both models and builds the forecast cycle, which takes a few minutes; do
that once the night before, not in the room.

---

## Five minutes, in order

### 0. Landing page, 30 seconds

Start on the public page rather than inside the console. It states the problem in one sentence,
shows the four stages in plain language, and carries the measured results. The figures on it are
pulled live from the engine, so it cannot quote a number the models no longer produce.

Then sign in as the **Research Administrator** and stop on **Overview** for a moment. The hull
reachability table is worth pointing at: every cell is a real solve, and ORV Sagar Nidhi shows
**no passage** to Halley VI.

### 1. Operations, 60 seconds

Open on **Operations**. It has already planned a Cape Town to Bharati passage for MV Vasiliy
Golovnin.

Say: *the chart is a south polar stereographic view of the Southern Ocean on 5 December 2025, the
real departure window for an Indian Antarctic resupply. The blue band is forecast sea-ice
concentration, the triangles are tracked icebergs, and the coloured lines are the routes.*

**Drag the timeline** from Analysis to +14d. The ice edge moves, the pack changes shape, and the
iceberg triangles drift. Point out that day zero is the analysis and everything to the right is
model output.

**Hover anywhere on the ice.** The read-out gives concentration, thickness, the speed that hull can
actually make there, the fuel burn per kilometre and the risk. That is the whole cost model,
readable at any point on the chart.

### 2. The trade-off, 60 seconds

Point at the right-hand rail: **seven non-dominated routes**, not one answer.

Say: *the optimiser is not asked to guess how much a tonne of fuel is worth against a percentage of
risk. It returns the whole Pareto set, and the master chooses.* Click between **Fuel optimal** and
**Safest** and let the numbers and the highlighted track change together.

Scroll the right rail to **Iceberg watch**: closest point of approach for each berg near the track,
with the hour the vessel gets there. Say: *this is the three models meeting. The berg position
compared against each leg is the one predicted for the hour the ship is there, not where it lies
today.*

### 3. Model skill, 90 seconds

This is the tab a technical judge will care about most.

- Concentration RMSE **0.086 at day 7** against **0.134** for persistence, a **35.5%** skill gain,
  rising to **48.9%** at day 14.
- It is scored against **three** baselines: persistence, climatology and advection alone. Say:
  *beating persistence is the standard claim. Beating advection is the hard one, because advection
  already knows how the ice is moving. We show all three rather than the flattering one.*
- Iceberg position error **44.7 km to 28.4 km at seven days**, a **36%** improvement, on bergs
  **held out of training entirely**.
- If asked why the berg error does not go to zero: *the archive carries an eddy-scale current field
  that is deliberately hidden from both the physics and the correction. It stands in for the
  submesoscale variability no operational product resolves. Without that floor the numbers would be
  an artefact.*

### 4. Voyage benchmark, 60 seconds

Say: *this is the number to argue about.*

A completed resupply leg is replayed against the forecast available at departure. Both the reported
track and the optimised route are priced through the **same** Lindqvist resistance model, the same
fuel curve and the same ice fields.

- **Bharati resupply: 4.1 tonnes of fuel saved, 2.0 percent, 12.8 t CO2, seven fewer hours in close
  pack** — and the comparison rule is stated on the page: *the cheapest optimal route that accepts
  no more risk than the reported track.* The saving is never bought with exposure.
- Switch to **Maitri resupply**. The saving is slightly negative. Say this out loud: *on this leg
  the master's track was already close to optimal and the system says so. A tool that only ever
  tells you that you were wrong is not a tool anyone trusts.*

### 5. Method, 30 seconds

Six stages, each independently checkable. Close on the **Scope of this prototype** card, which
states plainly what is implemented and what is reconstructed.

---

## The one demonstration that lands hardest

On **Operations**, select **ORV Sagar Nidhi** (India's own ICE-1A research vessel) and set the
destination to **Halley VI**.

The system refuses the passage: *no feasible passage. ORV Sagar Nidhi is classed for 0.40 m of level
ice. Every crossing of this corridor demands more than that.*

Say: *a planner that only draws lines on a chart cannot say this. That is the answer an operator
needs before a season is committed to a hull, not after the ship is beset.*

Then switch back to **Bharati anchorage** and the same hull plans a route immediately. The limit is
real, not a blanket refusal.

---

## Numbers worth having in your head

| | |
| --- | --- |
| Analysis grid | 93 × 360 cells, 0.5° latitude by 1.0° longitude |
| Forecast horizon | 14 days, daily |
| Sea-ice extent, 5 Dec 2025 | 10.9 million km² |
| Tracked icebergs | 168, each with a 14-day predicted track |
| Concentration RMSE, day 7 | 0.086 against 0.134 for persistence |
| Skill over persistence | +35.5% at day 7, +48.9% at day 14 |
| Ice edge agreement, day 7 | 97.8% at the 15% contour |
| Berg position error, day 7 | 28.4 km, from 44.7 km for free drift alone |
| Route solve time | 0.1 to 2.2 seconds for a full ten-weighting Pareto sweep |
| Search graph | up to 14,000 cells, 16-connected, time dependent |
| Fuel saved, Bharati leg | 4.1 t, 2.0%, at no additional risk |

---

## Questions you should expect

**"Is the data real?"**
The coastline is Natural Earth 1:50m, unmodified. The observational archive is reconstructed from
published Antarctic climatology rather than downloaded, so the prototype is offline, deterministic
and reproducible on any machine. Every data module exposes the same product shape as the
operational feed it stands in for, and swapping in live NSIDC, ERA5 and Copernicus Marine is a
change of one function body. The Method tab says exactly this.

**"Why not a single deep network?"**
Because a single network cannot be checked. Splitting the problem into a forecast, a drift model and
a physics-based cost lets each be validated on its own, and it means the routing cost comes from a
published ship-in-ice resistance model rather than from something the network invented.

**"Is 2 percent fuel saving worth it?"**
On one leg it is 4.1 tonnes and 12.8 tonnes of CO2. Across a season of resupply legs it compounds,
and the fuel figure is the conservative part of the case: the seven fewer hours in close pack and
the refusal to send an under-classed hull into the Weddell are the parts that matter to an
operator.

**"What is the ice concentration model, really?"**
A direct multi-horizon residual model. For each lead time the observed field is advected forward by
the free-drift ice velocity, and a gradient-boosted regressor over 35 spatio-temporal features
predicts the correction advection misses. Each lead is trained directly rather than rolled out, so
a 14-day field does not inherit 14 steps of accumulated error.

**"Is there a login, or is it just screens?"**
Real one. Passwords are PBKDF2-SHA256 with a per-user salt, sessions are signed tokens carrying
their own expiry, and the three roles genuinely gate the API, not just the menu. Sign in as the
Vessel Master and the Model skill, Benchmark and Administration tabs are gone; the API refuses
them too. The Administration tab shows the audit trail of every sign-in and every passage planned
or refused.

**"Does it work on a phone?"**
Yes. Below 1000px the console stacks: chart first, then the passage controls, then the routes. The
navigation collapses into a menu below 860px. Try it on your own phone against the laptop's IP.

**"Where would this go next?"**
Live feed ingestion, assimilation of vessel-reported ice observations, an ensemble to give the
routes confidence bounds, and an on-board client that works from a low-bandwidth satellite link.

---

## If something goes wrong

- **Blank screen or "Engine warming"**: the backend is still loading. Wait, it resolves itself.
- **Port 8000 in use**: `python -m uvicorn polarpath.main:app --app-dir backend --port 8010` and
  open that port instead.
- **You want a clean rebuild**: delete `backend/data/cache` and `backend/data/artefacts`, then run
  `python backend/scripts/train.py`. Allow several minutes. Do not do this in the room.
