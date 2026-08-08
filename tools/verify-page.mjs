/**
 * Rendering gate for index.html.
 *
 * Walks all 9 slides in both themes and fails on anything that would ship a
 * broken page. The palette is checked separately (tools/check-palette.mjs);
 * this script checks everything the maths cannot tell you about — layout,
 * runtime errors, and whether the interactive layer actually responds.
 *
 *   node tools/verify-page.mjs           run the checks
 *   node tools/verify-page.mjs --shots   also write screenshots to .shots/
 */

import { chromium } from "playwright";
import { pathToFileURL } from "url";
import { mkdirSync } from "fs";
import path from "path";

const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = ".shots";
const PAGE = path.resolve("index.html");
const SLIDES = 9;

const CHARTS = [
  { slide: 4, frame: "frameDays",   tip: "tipDays",   table: "tblDays" },
  { slide: 5, frame: "frameEffort", tip: "tipEffort", table: "tblEffort" },
  { slide: 6, frame: "frameMode",   tip: "tipMode",   table: "tblMode" },
  { slide: 7, frame: "frameCtx",    tip: "tipCtx",    table: "tblCtx" },
];

const failures = [];
function fail(msg) { failures.push(msg); }

async function launch() {
  // Playwright's bundled Chromium in CI; fall back to a local Chrome install.
  try {
    return await chromium.launch();
  } catch {
    return await chromium.launch({ channel: "chrome" });
  }
}

const browser = await launch();
if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true });

for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  page.on("pageerror", (e) => fail(`${theme}: page error — ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") fail(`${theme}: console error — ${m.text()}`);
  });

  await page.goto(pathToFileURL(PAGE).href);
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);

  // --- every slide renders, and the fixed console never buries the nav ---
  for (let s = 0; s < SLIDES; s++) {
    await page.evaluate((i) => document.querySelector(`[data-go="${i}"]`).click(), s);
    await page.waitForTimeout(220);

    const problem = await page.evaluate(() => {
      const active = document.querySelector(".slide.is-active");
      if (!active) return "no active slide";
      const console_ = document.getElementById("console");
      if (getComputedStyle(console_).display === "none") return null;
      const nav = active.querySelector(".nav");
      if (!nav) return null;
      // scroll to the very bottom: the nav must be reachable clear of the console
      window.scrollTo(0, document.body.scrollHeight);
      const n = nav.getBoundingClientRect();
      const c = console_.getBoundingClientRect();
      return n.bottom > c.top && n.top < c.bottom ? "control console covers the slide nav" : null;
    });
    if (problem) fail(`${theme}: slide ${s + 1} — ${problem}`);

    await page.evaluate(() => window.scrollTo(0, 0));
    if (SHOTS) {
      await page.screenshot({ path: `${SHOT_DIR}/${theme}-${String(s + 1).padStart(2, "0")}.png`, fullPage: true });
    }
  }

  // --- every chart answers to hover, and every data table has rows ---
  for (const c of CHARTS) {
    await page.evaluate((i) => document.querySelector(`[data-go="${i}"]`).click(), c.slide);
    await page.waitForTimeout(240);

    const box = await page.locator(`#${c.frame} svg`).boundingBox();
    if (!box) { fail(`${theme}: ${c.frame} — chart did not render`); continue; }

    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.42);
    await page.waitForTimeout(180);
    const shown = await page.evaluate(
      (id) => document.getElementById(id).classList.contains("on"),
      c.tip
    );
    if (!shown) fail(`${theme}: ${c.frame} — tooltip did not open on hover`);

    await page.evaluate((t) => document.querySelector(`[data-table="${t}"]`).click(), c.table);
    const rows = await page.locator(`#${c.table} tbody tr`).count();
    if (rows === 0) fail(`${theme}: ${c.table} — data table is empty`);
    await page.evaluate((t) => document.querySelector(`[data-table="${t}"]`).click(), c.table);
  }

  // --- extremes: every mode, every effort, and the far end of every slider ---
  await page.evaluate(() => document.querySelector('[data-go="6"]').click());
  for (const mode of ["solo", "workflow", "ultracode"]) {
    await page.evaluate((m) => document.querySelector(`[data-mode="${m}"]`).click(), mode);
    await page.waitForTimeout(120);
  }
  for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
    await page.evaluate((e) => document.querySelector(`[data-effort="${e}"]`).click(), effort);
    await page.waitForTimeout(100);
  }
  for (const [id, value] of [["cAgents", 32], ["cCtx", 500], ["cTasks", 80]]) {
    await page.evaluate(([i, v]) => {
      const el = document.getElementById(i);
      el.value = v;
      el.dispatchEvent(new Event("input"));
    }, [id, value]);
  }
  await page.waitForTimeout(260);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  if (overflow) fail(`${theme}: page scrolls horizontally at extreme settings`);

  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/${theme}-extremes.png`, fullPage: true });
  await page.close();
}

await browser.close();

if (failures.length) {
  console.log(`\n→ ${failures.length} PAGE CHECK(S) FAILED\n`);
  for (const f of failures) console.log("  - " + f);
  console.log("");
  process.exit(1);
}

console.log(
  `\n→ ALL PAGE CHECKS PASS — ${SLIDES} slides × 2 themes, 4 charts, extremes\n` +
  (SHOTS ? `  screenshots in ${SHOT_DIR}/\n` : "")
);
