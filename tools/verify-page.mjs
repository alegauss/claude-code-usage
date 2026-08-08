/**
 * Rendering gate for index.html.
 *
 * Walks every slide in both themes and fails on anything that would ship a
 * broken page. The palette is checked separately (tools/check-palette.mjs);
 * this script checks everything the maths cannot tell you about — layout,
 * runtime errors, and whether the interactive layer actually responds.
 *
 *   node tools/verify-page.mjs           run the checks
 *   node tools/verify-page.mjs --shots   also write screenshots to .shots/
 */

import { chromium } from "playwright";
import { pathToFileURL } from "url";
import { existsSync, mkdirSync } from "fs";
import path from "path";

const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = ".shots";
const PAGE = path.resolve("index.html");
const SLIDES = 10;

const CHARTS = [
  { slide: 4, frame: "frameDays",   tip: "tipDays",   table: "tblDays" },
  { slide: 5, frame: "frameWindow", tip: "tipWindow", table: "tblWindow" },
  { slide: 6, frame: "frameEffort", tip: "tipEffort", table: "tblEffort" },
  { slide: 7, frame: "frameMode",   tip: "tipMode",   table: "tblMode" },
  { slide: 8, frame: "frameCtx",    tip: "tipCtx",    table: "tblCtx" },
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

/* Files that must ship beside index.html, and are therefore listed in the
   assemble step of .github/workflows/pages.yml. A social crawler fetches
   og:image by URL, so it is the one asset that cannot be inlined. */
const SIDECARS = ["og.png", "robots.txt", "sitemap.xml", "llms.txt"];

const browser = await launch();
if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true });

// --- the head: what a link preview and a crawler see before anything renders ---
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  await page.goto(pathToFileURL(PAGE).href);

  if (await page.evaluate(() => document.compatMode) !== "CSS1Compat") {
    fail("head: no doctype — the page renders in quirks mode");
  }
  if (!await page.evaluate(() => document.documentElement.lang)) {
    fail("head: <html> has no lang attribute");
  }
  if (!await page.evaluate(() => document.querySelector('meta[name="viewport"]'))) {
    fail("head: no viewport meta — mobile renders at desktop width and ignores the breakpoint");
  }

  // absolute: true where a crawler will not resolve a relative path for us
  const REQUIRED = [
    { sel: "meta[charset]" },
    { sel: 'meta[name="description"]', attr: "content" },
    { sel: 'link[rel="icon"]', attr: "href" },
    { sel: 'meta[name="twitter:card"]', attr: "content" },
    { sel: 'meta[property="og:title"]', attr: "content" },
    { sel: 'meta[property="og:description"]', attr: "content" },
    { sel: 'link[rel="canonical"]', attr: "href", absolute: true },
    { sel: 'meta[property="og:url"]', attr: "content", absolute: true },
    { sel: 'meta[property="og:image"]', attr: "content", absolute: true },
    { sel: 'meta[name="twitter:image"]', attr: "content", absolute: true }
  ];
  for (const { sel, attr, absolute } of REQUIRED) {
    const value = await page.evaluate(
      ([s, a]) => {
        const el = document.querySelector(s);
        if (!el) return null;
        return a ? el.getAttribute(a) : "present";
      },
      [sel, attr]
    );
    if (!value) fail(`head: missing ${sel}`);
    else if (absolute && !value.startsWith("https://")) {
      fail(`head: ${sel} must be an absolute URL — a crawler cannot resolve "${value}"`);
    }
  }

  const ld = await page.evaluate(() => document.querySelector('script[type="application/ld+json"]')?.textContent);
  if (!ld) fail("head: no JSON-LD block");
  else { try { JSON.parse(ld); } catch (e) { fail(`head: JSON-LD does not parse — ${e.message}`); } }

  // the inline favicon has to actually decode, not just be present
  const icon = await page.evaluate(() => new Promise((r) => {
    const el = document.querySelector('link[rel="icon"]');
    if (!el) return r("missing");
    const img = new Image();
    img.onload = () => r("ok");
    img.onerror = () => r("failed to decode");
    img.src = el.href;
  }));
  if (icon !== "ok") fail(`head: favicon ${icon}`);

  for (const f of SIDECARS) {
    if (!existsSync(f)) fail(`sidecar: ${f} is referenced or deployed but missing from the repo`);
  }

  await page.close();
}

// --- mobile: the viewport meta is what makes the 860px breakpoint reachable ---
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await page.goto(pathToFileURL(PAGE).href);
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => ({
    width: window.innerWidth,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1
  }));
  if (m.width > 500) fail(`mobile: viewport reports ${m.width}px — the viewport meta is not taking effect`);
  if (m.overflow) fail("mobile: page scrolls horizontally at 390px");
  await page.close();
}

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
  // parked on the execution-mode chart, the one most sensitive to these settings
  await page.evaluate(() => document.querySelector('[data-go="7"]').click());
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
  `\n→ ALL PAGE CHECKS PASS — ${SLIDES} slides × 2 themes, ${CHARTS.length} charts, extremes\n` +
  (SHOTS ? `  screenshots in ${SHOT_DIR}/\n` : "")
);
