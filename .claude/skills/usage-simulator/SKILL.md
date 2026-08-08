---
name: usage-simulator
description: Conventions, cost model and verification for the Claude Code usage simulator (index.html). Use when editing the page, the cost model, the palette, the slides, or the GitHub Pages deploy.
---

# Claude Code usage simulator

An interactive 9-slide deck estimating how long each plan's credits (Free, Pro,
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

Constants live in the `/* model */` section of the `<script>` in `index.html`:

```
chain_cost = calls × (context × input_price × 0.2475 + output × output_price)
task_cost  = phases × (chain_cost × 0.45 + agents × chain_cost × 0.70)
days       = monthly_budget ÷ (task_cost × tasks_per_day)
```

- `0.2475` — cache factor: 85% reads (0.1×) + 10% fresh input (1.0×) + 5% writes (1.25×).
- `0.45` — share of a full chain spent by the workflow coordinator.
- `0.70` — share spent by each fanned-out agent (own context, leaner chain).
- `solo` skips the fan-out entirely: `task_cost = chain_cost`.
- `ultracode` = 3 phases **and** an `xhigh` effort floor (`effectiveEffort()`).
  The floor never overrides a higher pick: on `max` you stay on `max`. The console
  renders `high → xhigh` when the floor is what's acting.

Tables: `EFFORT` (5 levels, calls × output), `MODELS` (per-million prices),
`PLANS` (monthly budget), `MODES` (phases + floor).

### The assumptions are contestable — deliberately

Subscription plans do **not** expose a dollar balance; they meter a rolling 5-hour
window plus a weekly cap. The model converts consumption into equivalent API spend
at list prices against estimated monthly budgets ($5 / $120 / $600 / $2,400).

This is stated on the cover and on slide 9, with every coefficient spelled out.
**Never delete those notes to "clean up" the page** — they are what separates an
honest model from an invented number. If you change a coefficient, update slide 9,
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
| 6 | Chart 2 — effort × cost | 1 |
| 7 | Chart 3 — execution mode | 1 |
| 8 | Chart 4 — context × runway | 1 |
| 9 | Levers and assumptions | 0 |

`data-sim="1"` reveals the fixed control console (`body.sim-mode`). Every
simulation slide reads the **same `state`** — moving one control updates all of
them. `renderAll()` only redraws the visible chart (`offsetParent !== null`).

**When inserting or removing a slide**, update: the rail's `data-go` buttons, the
`<b class="cur">NN</b> / 09` counters, the "chart N" eyebrow labels, and the total
in all nine counters.

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
- Logarithmic axes on charts 3 and 4, always labelled as such in the legend.
  Chart 3 uses a **dot plot**, not bars: on a log scale, length from zero means
  nothing; position means something.

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

`tools/verify-page.mjs` walks all 9 slides in both themes and fails on: console or
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
- **Axis caption colliding with the last tick.** On chart 1 the "days to empty"
  caption sits at the far left (x=16), clear of the tick row.
- **Inconsistent decimals.** `money()` switches precision by magnitude; changing it
  affects axis labels and bar labels at the same time.
- **Desynchronised slide counters** when inserting a slide (see above).

## Language

The page, the README and all tooling output are in **English**. Numbers use
`Intl.NumberFormat("en-US")`.
