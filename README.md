# Claude Code usage simulator

An interactive 9-slide deck that estimates how long the credits on each Claude Code
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
task_cost  = phases × (chain_cost × 0.45 + agents × chain_cost × 0.70)
days       = monthly_budget ÷ (task_cost × tasks_per_day)
```

| Constant | Value | Meaning |
|---|---|---|
| `cache_factor` | 0.2475 | 85% cache reads (0.1×) + 10% fresh input (1.0×) + 5% cache writes (1.25×) |
| coordinator share | 0.45 | fraction of a full chain the workflow coordinator spends |
| agent share | 0.70 | fraction each fanned-out agent spends, with its own context |
| `solo` | 1 chain | no fan-out; `task_cost = chain_cost` |
| `workflow` | 1 phase | coordinator + N agents |
| `ultracode` | 3 phases | chained phases **and** an `xhigh` effort floor |

The `ultracode` floor never overrides a higher choice: pick `max` and you stay on
`max`. When the floor is doing something, the console shows it as `high → xhigh`.

### Assumptions, stated so you can disagree with them

Subscription plans do **not** expose a dollar balance. They meter usage in a rolling
5-hour window plus a weekly cap. This model converts consumption into equivalent API
spend at list prices and compares it against an estimated monthly budget per plan:

| Plan | Sticker | Modelled monthly budget |
|---|---|---|
| Free | $0 | $5 — *illustrative; Claude Code is not included* |
| Pro | $20 | $120 |
| Max 5x | $100 | $600 |
| Max 20x | $200 | $2,400 |

Model prices used: Opus 5 `$5/$25`, Sonnet 5 `$2/$10` (introductory, through
2026-08-31), Haiku 4.5 `$1/$5` per million tokens. A month is 30 days.

**None of these budgets is published as official consumption policy.** They are the
model's stated basis. The page repeats this on the cover and on the final slide — do
not strip those notes to tidy the page up; they are what separates a model from a
made-up number.

## Verifying

```bash
npm install                        # first time only (Playwright)
npx playwright install chromium

npm run check                      # palette + rendered page
npm run check:palette              # colour ramps and ink contrast
npm run check:page                 # 9 slides × 2 themes, charts, extremes
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
tools/check-palette.mjs        colour gate (no dependencies)
tools/verify-page.mjs          rendering gate (Playwright)
tools/serve.mjs                local static server (no dependencies)
.github/workflows/pages.yml    verify, then deploy to Pages
.claude/skills/                project conventions for Claude Code
```

## License

[Apache License 2.0](LICENSE)
