# Claude Code usage simulator

An interactive 10-slide deck that estimates how long the credits on each Claude Code
subscription plan — Free, Pro, Max 5x, Max 20x — last under a working pace you set:
tasks per day, effort level, context size per call, model, and whether the work fans
out across agents.

**→ [alegauss.github.io/claude-code-usage](https://alegauss.github.io/claude-code-usage/)**

---

## There is no build step

`index.html` **is** the artifact: one self-contained file, CSS and JavaScript inline,
no runtime dependencies, no CDN, no bundler. Open it from disk and it works; GitHub
Pages serves it directly.

`package.json` exists **only** for the verification tooling in `tools/`. Nothing from
`node_modules` reaches the browser, and the deploy job copies `index.html` without
running a build.

## The cost model

```
chain_cost = calls × (context × input_price × cache_factor + output × output_price)
task_cost  = phases × (chain_cost × coord_share + agents × chain_cost × agent_share)
days       = monthly_budget ÷ (task_cost × tasks_per_day)
minutes    = window_allowance ÷ (task_cost × tasks_in_window) × 300
```

| Constant | Value | Meaning |
|---|---|---|
| `cache_factor` | 0.1335 | **measured**: 98.2% cache reads (0.1×) and 1.7% one-hour writes (2.0×) |
| coordinator share | 1.37 | **measured**: the coordinator runs *longer* than a solo chain, not shorter |
| agent share | 0.52 | **measured** share each fanned-out agent spends, with its own context |
| `WINDOW_BURST` | 0.63 | **measured**: share of a day's tasks landing in its busiest 5 hours |
| `solo` | 1 chain | no fan-out; `task_cost = chain_cost` |
| `workflow` | 1 phase | coordinator + N agents |
| `ultracode` | 3 phases | chained phases **and** an `xhigh` effort floor |

The measured constants live in a generated `MEASURED` snapshot inside the page —
see [Measuring instead of assuming](#measuring-instead-of-assuming). Editing them
by hand means the next `npm run apply` reverts you.

The `ultracode` floor never overrides a higher choice: pick `max` and you stay on
`max`. When the floor is doing something, the console shows it as `high → xhigh`.

### Assumptions, stated so you can disagree with them

Subscription plans do **not** expose a dollar balance. They meter usage in a rolling
5-hour window plus a weekly cap. This model converts consumption into equivalent API
spend at list prices and compares it against two allowances per plan:

| Plan | Sticker | Monthly budget | 5-hour window |
|---|---|---|---|
| Free | $0 | $5 — *illustrative; Claude Code is not included* | $16 |
| Pro | $20 | $120 | $160 |
| Max 5x | $100 | $600 | $800 |
| Max 20x | $200 | $2,400 | $3,200 |

**The two columns do not multiply into each other, and are not meant to.** A plan
meters a rolling window *and* a weekly cap: the window governs your afternoon, the
weekly cap governs your month. The window figures are anchored on measurement — the
most expensive five-hour window on record cost $777 at list prices with work
uninterrupted, so Max 5x grants at least that; the rest scale by the ratios the plan
names imply. The monthly figures are the weakest thing on the page: nothing measures
them, and real usage on a $100 plan reached **$455/day** at list prices.

Model prices used: Opus 5 `$5/$25`, Sonnet 5 `$2/$10` (introductory, through
2026-08-31), Haiku 4.5 `$1/$5` per million tokens. A month is 30 days.

**None of these allowances is published as official consumption policy.** They are
the model's stated basis. The page repeats this on the cover and on the final slide
— do not strip those notes to tidy the page up; they are what separates a model from
a made-up number.

## Measuring instead of assuming

The coefficients are not guesses. Claude Code writes a JSONL transcript for
every session, with per-request token counts, model, effort and subagent
provenance. `tools/measure-usage.mjs` reads them and reports the same quantities
the page models, so the model can be checked against reality:

```bash
npm run measure                              # console report
npm run measure:json                         # writes .usage/facts.json
npm run apply                                # folds it into index.html
npm run recalibrate                          # measure, apply, verify

node tools/measure-usage.mjs --project shio --since 2026-07-01
```

Read-only, no dependencies, nothing leaves the machine. **`.usage/` is
gitignored** — it carries real project names and spend. Only anonymised
aggregates are written into the page, as one inline snapshot object: the page
stays a single self-contained file with no build and no runtime fetch.

The current snapshot covers 1,864 tasks and 79,377 requests over 32 active days.
It moved six coefficients, two of them badly wrong in opposite directions —
context per call was 2.7× higher than assumed while output per call was 7× lower,
so the headline cost looked plausible for the wrong reasons. With the measured
constants the formula reproduces a real project's median task within 6%.

## Sharing a view

Every slide has its own address, and the simulation slides carry the console
settings with them. Picking a use case collapses the link to its name:

```
index.html#slide=6&case=heavy
index.html#slide=6&case=heavy&tasks=60&mode=ultracode
index.html#slide=6&case=custom&ctx=410&effort=xhigh
```

A use case pins context and effort only, so pace, model and mode still travel
whenever they differ from the defaults. Values are clamped to the control ranges
on the way in, and a link that carries any simulation parameter resets the rest
to defaults — so the same link shows two people the same numbers.

## Verifying

```bash
npm install                        # first time only (Playwright)
npx playwright install chromium

npm run check                      # palette + rendered page
npm run check:palette              # colour ramps and ink contrast
npm run check:page                 # 10 slides × 2 themes, charts, extremes
npm run shots                      # same, plus screenshots in .shots/
npm run serve                      # static preview on http://localhost:4173
```

`check:palette` gates the plan colour ramps: monotone lightness, a minimum gap
between adjacent steps, single hue, the step nearest the surface still visible
against it, and WCAG contrast on the ink tokens. The ramps differ per theme by
design — darker means bigger on the light surface, lighter means bigger on the dark
one — so each is validated against the surface it actually renders on.

`check:page` drives the real page in Chromium and fails on: any console or page
error, the fixed control console burying the slide navigation, a chart tooltip that
does not open, an empty data table, or horizontal overflow at extreme settings
(80 tasks/day, 500k context, `max` effort, 32 agents).

Both run in CI and **block the Pages deploy**.

## Layout

```
index.html                     the page — the whole product
tools/measure-usage.mjs        reads local transcripts, reports what a task really costs
tools/apply-measurements.mjs   folds a measurement back into index.html
tools/check-palette.mjs        colour gate (no dependencies)
tools/verify-page.mjs          rendering gate (Playwright)
tools/serve.mjs                local static server (no dependencies)
.usage/                        measurement output — gitignored, never published
.github/workflows/pages.yml    verify, then deploy to Pages
.claude/skills/                project conventions for Claude Code
```

## License

[Apache License 2.0](LICENSE)
