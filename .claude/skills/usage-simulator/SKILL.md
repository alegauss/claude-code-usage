---
name: usage-simulator
description: Conventions, cost model and verification for the Claude Code usage simulator (index.html). Use when editing the page, the cost model, the palette, the slides, or the GitHub Pages deploy.
---

# Claude Code usage simulator

An interactive 10-slide deck estimating how long each plan's credits (Free, Pro,
Max 5x, Max 20x) last under a configurable working pace.

## The constraint that governs everything

**`index.html` is the artifact. There is no build.** One self-contained file:
inline CSS and JS, zero runtime dependencies, zero CDN. Opening the file in a
browser has to work — that is exactly what GitHub Pages serves, with no bundler.

Do not introduce Vite, React, TypeScript or any bundler unless the user asks for
it explicitly. If the page ever needs componentising, that is their call, not a
maintenance step. `package.json` exists **only** for the tooling in `tools/` —
none of it reaches the browser, and the deploy job copies `index.html` as-is.

## The cost model

The coefficients are **measured**, not assumed — see the `usage-benchmark`
skill. `CACHE_FACTOR`, `COORD_SHARE`, `AGENT_SHARE` and the `high`/`xhigh` rows
of `EFFORT` read from the generated `MEASURED` snapshot; changing them by hand
means the next `npm run apply` silently reverts you. Change the measurement, or
change the code that derives from it.

Constants live in the `/* model */` section of the `<script>` in `index.html`:

```
chain_cost = calls × (context × input_price × CACHE_FACTOR + output × output_price)
task_cost  = phases × (chain_cost × COORD_SHARE + agents × chain_cost × AGENT_SHARE)
days       = monthly_budget ÷ (task_cost × tasks_per_day)
minutes    = window_allowance ÷ (task_cost × tasks × WINDOW_BURST) × 300
```

- `CACHE_FACTOR` — measured blend of cache reads (0.1×), 1-hour writes (**2.0×**,
  not the 1.25× a 5-minute write costs) and fresh input.
- `COORD_SHARE` — measured; the coordinator runs **longer** than a solo chain,
  not shorter, so this is above 1.0.
- `AGENT_SHARE` — measured share spent by each fanned-out agent.
- `solo` skips the fan-out entirely: `task_cost = chain_cost`.
- `ultracode` = 3 phases **and** an `xhigh` effort floor (`effectiveEffort()`).
  The floor never overrides a higher pick: on `max` you stay on `max`. The console
  renders `high → xhigh` when the floor is what's acting.

Tables: `EFFORT` (5 levels, calls × output), `MODELS` (per-million prices),
`PLANS` (monthly budget **and** 5-hour window allowance), `MODES` (phases + floor).

### The assumptions are contestable — deliberately

Subscription plans do **not** expose a dollar balance; they meter a rolling 5-hour
window plus a weekly cap. The model converts consumption into equivalent API spend
at list prices against two allowances per plan: an estimated monthly budget
($5 / $120 / $600 / $2,400) and a 5-hour window allowance ($16 / $160 / $800 /
$3,200). Only the window figures are anchored on measurement.

**The four budgets are the weakest link and are not measured.** Real usage on a
$100 plan reached $455/day at list prices, so the $600 Max 5x figure is a
placeholder, not a finding. Slide 10 says so; keep it saying so.

This is stated on the cover and on slide 10, with every coefficient spelled out.
**Never delete those notes to "clean up" the page** — they are what separates an
honest model from an invented number. If you change a coefficient, update slide 10,
which lists them one by one.

Free is carried at an illustrative value because it does not include Claude Code.
It is labelled as such in two places; keep the label.

## Slide structure

| # | Slide | `data-sim` |
|---|---|---|
| 1 | Cover | 0 |
| 2 | The model (formulas) | 0 |
| 3 | The plans | 0 |
| 4 | Simulator panel | 1 |
| 5 | Chart 1 — days to empty | 1 |
| 6 | Chart 2 — the 5-hour window | 1 |
| 7 | Chart 3 — effort × cost | 1 |
| 8 | Chart 4 — execution mode | 1 |
| 9 | Chart 5 — context × runway | 1 |
| 10 | Levers and assumptions | 0 |

`tools/verify-page.mjs` hardcodes `SLIDES` and a `CHARTS` array of **0-based**
slide indices — update both when the deck changes, or the new slide ships
unverified.

### Two clocks, and they do not reconcile

Chart 1 divides a **monthly** budget; chart 2 divides a **5-hour window**
allowance. `PLANS[]` carries both (`budget`, `window`) and they deliberately do
not multiply into each other — a subscription meters a rolling window *and* a
weekly cap, so the window governs an afternoon while the weekly cap governs a
month. Do not "fix" the inconsistency by deriving one from the other.

Chart 2 also applies `WINDOW_BURST` (0.63, measured): the busiest five hours of a
day hold about two thirds of that day's tasks, so spreading the daily pace evenly
would model a burst that never happens and every plan would survive.

`data-sim="1"` reveals the fixed control console (`body.sim-mode`). Every
simulation slide reads the **same `state`** — moving one control updates all of
them. `renderAll()` only redraws the visible chart (`offsetParent !== null`).

The console's first control is a **use-case dropdown** built from
`MEASURED.profiles`. Selecting one sets context and effort; the label is
**derived** from the state (`matchUseCase()`), never stored — so a restored link
or a nudged slider always shows the truthful label. Any new control that changes
`ctxK` or `effort` must call `refreshUseCase()`, or the dropdown will keep
claiming a profile the state has already left.

Slides are addressable and shareable. A matched use case collapses the link to
`#slide=6&case=heavy`; off-profile it spells out `case=custom&ctx=…&effort=…`.
Either way `tasks`, `model`, `mode` and `agents` ride along **only when they
differ from the defaults** — a use case pins context and effort and says nothing
about the rest, so dropping them would silently lose state.

`readUrl()` clamps every value to its control range and, when a link carries any
simulation parameter, **resets the others to defaults first** — otherwise an
omitted parameter inherits whatever the current viewer happened to have set, and
the same link shows two people different numbers. A bare `#slide=3` carries none,
so it leaves the console alone; a bare `#3` from an older link still works.
`writeUrl()` uses `replaceState`, coalesced through `requestAnimationFrame`, so
dragging a slider does not flood the back button.

**When inserting or removing a slide**, update: the rail's `data-go` buttons, the
`<b class="cur">NN</b> / 10` counters, the "chart N" eyebrow labels, the total in
every counter, and `SLIDES` + `CHARTS` in `tools/verify-page.mjs`.

## Colour — never pick by eye

The plan ramp is **single-hue ordinal** (blue), validated against both surfaces.
Direction flips per theme, because magnitude has to grow toward contrast:

| Slot | Light (`#ffffff`) | Dark (`#171b22`) |
|---|---|---|
| Free | `#86b6ef` | `#1c5cab` |
| Pro | `#3987e5` | `#2a78d6` |
| Max 5x | `#256abf` | `#5598e7` |
| Max 20x | `#104281` | `#9ec5f4` |

Light: darker = bigger. Dark: lighter = bigger. **Do not "auto-invert" the theme** —
each ramp was chosen for its own surface.

Touch any colour and run `npm run check:palette` before committing. It fails if the
ramp stops being monotone in lightness, if adjacent steps get too close
(ΔL < 0.06), if the hue spread opens up, or if the step nearest the surface drops
below 2:1.

Rules already in force, keep them:
- Direct labels on every mark (the light ramp has steps under 3:1 — the label is
  what guarantees legibility).
- Text always uses ink tokens, never the series colour.
- Logarithmic axes on charts 4 and 5, always labelled as such in the legend.
  Chart 4 uses a **dot plot**, not bars: on a log scale, length from zero means
  nothing; position means something. Charts 1 and 2 are linear, so bars are right
  there — days and minutes both read as duration from zero.

## Themes

Three states, not two: `:root` (light), `@media (prefers-color-scheme: dark)`
guarded with `:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`.
Every colour comes from a token — **no colour may be defined only inside a media
or `[data-theme]` block**, or the unstamped state renders one theme's text on the
other theme's ground.

## Verification

```bash
npm install                        # first time only (Playwright)
npx playwright install chromium
npm run check                      # palette + page
npm run shots                      # screenshots into .shots/
npm run serve                      # dependency-free static server
```

`tools/verify-page.mjs` walks every slide in both themes and fails on: console or
page errors, the fixed console burying the slide nav, a tooltip that will not open
on any of the 4 charts, an empty data table, or horizontal overflow. It also
exercises the extremes (80 tasks/day, 500k context, `max` effort, 32 agents).

The same `npm run check` runs in CI and **blocks the Pages deploy**.

## Traps already fixed — do not reintroduce

- **Fixed console covering the nav.** `--console-h` must track the console's real
  height; it wraps to two rows once there are six controls. The `.stage`
  `padding-bottom` derives from that token. The verifier tests this.
- **Small hover targets on the dot plot.** Each row has a full-width hover band
  added *before* the dots; the dots sit on top and take precedence.
- **Axis caption colliding with the first tick.** The caption sits at x=16 while
  ticks start at x=148, so a caption longer than roughly 15 characters runs into
  the zero tick — "minutes into the window" rendered as `minutes into the win0mow`.
  Chart 2 skips the zero tick for this reason; an axis starting at zero does not
  need to announce it.
- **Prose narrower than the chart it describes.** `.lede` is held to a 62ch
  reading measure, which reads as broken above a full-width chart. The simulation
  slides override it with `.slide[data-sim="1"] .lede { max-width: none }`.
- **Inconsistent decimals.** `money()` switches precision by magnitude; changing it
  affects axis labels and bar labels at the same time.
- **Desynchronised slide counters** when inserting a slide (see above).

## Language

The page, the README and all tooling output are in **English**. Numbers use
`Intl.NumberFormat("en-US")`.
