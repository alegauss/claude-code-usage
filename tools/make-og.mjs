#!/usr/bin/env node
/*
 * make-og.mjs — render the social preview image.
 *
 * LinkedIn, Slack and the rest fetch og:image over HTTP and will not render an
 * SVG or a data URI, so the one thing on this site that cannot be inlined is
 * this banner. It is generated rather than hand-drawn so it stays in step with
 * the page: same dark palette, same type stack, same plan ramp, and the headline
 * figures come from the measured snapshot in index.html.
 *
 *   npm run og            write og.png
 *   npm run og -- --open  ...and print the path
 *
 * 1200x630 is the size every major platform crops from cleanly.
 */

import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = "og.png";
const W = 1200, H = 630;

/* Pull the live numbers out of the page's generated snapshot so the banner can
   never advertise a figure the page no longer shows. */
function snapshot() {
  const page = readFileSync("index.html", "utf8");
  const block = page.match(/var MEASURED = (\{[\s\S]*?\n  \});/);
  if (!block) throw new Error("measured snapshot not found in index.html");
  // eslint-disable-next-line no-new-func
  return Function("return (" + block[1] + ")")();
}

const m = snapshot();
const nf = new Intl.NumberFormat("en-US");

/* Dark-theme tokens, copied from index.html — the banner reads against a feed,
   and the dark surface separates it from the white page around it. */
const T = {
  ground: "#0d1014", surface: "#171b22", line: "#272e39",
  ink: "#eef1f6", ink2: "#a4adbd", ink3: "#79828f",
  ramp: ["#1c5cab", "#2a78d6", "#5598e7", "#9ec5f4"],
  display: '"Segoe UI Variable Display","Segoe UI",system-ui,-apple-system,sans-serif',
  mono: 'ui-monospace,"Cascadia Mono","Cascadia Code",Consolas,"SF Mono",Menlo,monospace'
};

/* Four bars in the plan ramp: the shape a reader meets again on slide 5.
   Relative lengths, not a claim about any particular scenario. */
const BARS = [
  { label: "Free", pct: 7 },
  { label: "Pro", pct: 25 },
  { label: "Max 5x", pct: 61 },
  { label: "Max 20x", pct: 100 }
];

/* A feed thumbnail is read at roughly half this width, so everything is sized
   to survive that: short headline, few words, nothing under ~20px. */
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${W}px; height: ${H}px; background: ${T.ground}; color: ${T.ink};
    font-family: ${T.display}; overflow: hidden;
  }
  .wrap {
    height: 100%; padding: 64px 68px; display: grid;
    grid-template-columns: 1fr 400px; grid-template-rows: 1fr auto;
    column-gap: 56px; align-items: center;
  }
  .kicker {
    font-family: ${T.mono}; font-size: 16px; letter-spacing: .18em;
    text-transform: uppercase; color: ${T.ramp[2]};
  }
  h1 {
    font-size: 72px; font-weight: 700; letter-spacing: -.035em; line-height: 1.03;
    margin-top: 20px;
  }
  h1 em { font-style: normal; color: ${T.ramp[3]}; }
  .lede { font-size: 25px; line-height: 1.4; color: ${T.ink2}; margin-top: 24px; }
  .lede b { color: ${T.ink}; font-weight: 600; }

  .panel {
    background: ${T.surface}; border: 1px solid ${T.line}; border-radius: 12px;
    padding: 28px 30px;
  }
  .panel-t {
    font-family: ${T.mono}; font-size: 13px; letter-spacing: .12em;
    text-transform: uppercase; color: ${T.ink3}; margin-bottom: 20px;
  }
  .row { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
  .row:last-child { margin-bottom: 0; }
  .name {
    font-family: ${T.mono}; font-size: 14px; color: ${T.ink2};
    width: 76px; text-align: right; flex: none;
  }
  .track { flex: 1; height: 20px; background: ${T.ground}; border-radius: 4px; display: block; }
  .fill { height: 100%; border-radius: 4px; display: block; }

  .foot {
    grid-column: 1 / -1; display: flex; align-items: baseline; gap: 18px;
    border-top: 1px solid ${T.line}; padding-top: 26px;
  }
  .url { font-family: ${T.mono}; font-size: 19px; color: ${T.ink}; }
  .tag { font-family: ${T.mono}; font-size: 15px; color: ${T.ink3}; margin-left: auto; }
</style></head><body>
  <div class="wrap">
    <div>
      <p class="kicker">Measured, not assumed</p>
      <h1>What a Claude Code task <em>really costs</em></h1>
      <p class="lede">
        Calibrated against <b>${nf.format(m.requests)} real requests</b> read
        straight from local session transcripts.
      </p>
    </div>

    <div class="panel">
      <p class="panel-t">Runway per plan</p>
      ${BARS.map((b, i) => `<div class="row">
        <span class="name">${b.label}</span>
        <span class="track"><span class="fill" style="width:${b.pct}%;background:${T.ramp[i]}"></span></span>
      </div>`).join("")}
    </div>

    <div class="foot">
      <span class="url">alegauss.github.io/claude-code-usage</span>
      <span class="tag">open source · no tracking · runs from one HTML file</span>
    </div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "load" });
await page.waitForTimeout(250);
const png = await page.screenshot({ type: "png" });
await browser.close();

writeFileSync(OUT, png);
console.log(`wrote ${OUT} — ${W}x${H} at 2x, ${(png.length / 1024).toFixed(0)} KB`);
console.log(`  headline figures: ${nf.format(m.requests)} requests, ${nf.format(m.tasks)} tasks`);
console.log("");
console.log("og:image is fetched over HTTP by every social crawler, so this file");
console.log("ships alongside index.html — see the assemble step in pages.yml.");
