/**
 * Palette gate for index.html.
 *
 * The plan colours are an ORDINAL ramp: one hue, stepping monotonically in
 * lightness so that "bigger plan" reads as "further along the ramp". Direction
 * flips per theme, because magnitude has to grow in the direction of contrast:
 * darker = bigger on the light surface, lighter = bigger on the dark one.
 *
 * Checks, per theme:
 *   1. lightness is monotonic across the four steps
 *   2. adjacent steps differ by at least MIN_DL in OKLab L
 *   3. the step nearest the surface still clears MIN_CONTRAST against it
 *   4. all four steps share one hue (spread under MAX_HUE_SPREAD degrees)
 *   5. body/secondary ink clears WCAG AA against the surface
 *
 * No dependencies. Exits non-zero on failure so CI can gate the deploy.
 */

const MIN_DL = 0.06;
const MIN_CONTRAST = 2.0;   // ordinal ramps: the step nearest the surface must stay visible
const MAX_HUE_SPREAD = 12;  // degrees
const AA_BODY = 4.5;
const AA_LARGE = 3.0;

const THEMES = [
  {
    name: "light",
    surface: "#ffffff",
    // Free -> Max 20x, i.e. light -> dark on a light surface
    ramp: ["#86b6ef", "#3987e5", "#256abf", "#104281"],
    ink: { primary: "#0d1117", secondary: "#58616f", muted: "#858e9d" },
  },
  {
    name: "dark",
    surface: "#171b22",
    // Free -> Max 20x, i.e. dark -> light on a dark surface
    ramp: ["#1c5cab", "#2a78d6", "#5598e7", "#9ec5f4"],
    ink: { primary: "#eef1f6", secondary: "#a4adbd", muted: "#79828f" },
  },
];

/* ---------- colour maths ---------- */

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function toLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function oklab(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

function hueOf(hex) {
  const { a, b } = oklab(hex);
  const deg = (Math.atan2(b, a) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

function relLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = relLuminance(a), lb = relLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------- reporting ---------- */

let failures = 0;

function check(ok, label, detail) {
  const tag = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`  [${tag}] ${label.padEnd(30)} ${detail}`);
}

for (const theme of THEMES) {
  console.log(`\nPalette (${theme.name}, surface ${theme.surface}) — ${theme.ramp.length} plan steps`);

  const Ls = theme.ramp.map((h) => oklab(h).L);

  // 1. monotonic lightness (either direction — depends on the surface)
  const ascending = Ls.every((L, i) => i === 0 || L > Ls[i - 1]);
  const descending = Ls.every((L, i) => i === 0 || L < Ls[i - 1]);
  check(
    ascending || descending,
    "Lightness monotone",
    ascending ? "steps read dark→light" : descending ? "steps read light→dark" : "NOT monotone"
  );

  // 2. adjacent lightness gaps
  let minGap = Infinity;
  for (let i = 1; i < Ls.length; i++) minGap = Math.min(minGap, Math.abs(Ls[i] - Ls[i - 1]));
  check(minGap >= MIN_DL, "Adjacent ΔL", `smallest gap ${minGap.toFixed(3)} (min ${MIN_DL})`);

  // 3. the step nearest the surface must stay visible against it
  const surfaceL = oklab(theme.surface).L;
  let nearest = theme.ramp[0], nearestDist = Infinity;
  for (const hex of theme.ramp) {
    const d = Math.abs(oklab(hex).L - surfaceL);
    if (d < nearestDist) { nearestDist = d; nearest = hex; }
  }
  const nearestContrast = contrast(nearest, theme.surface);
  check(
    nearestContrast >= MIN_CONTRAST,
    "Nearest-step contrast",
    `${nearest} at ${nearestContrast.toFixed(2)}:1 (min ${MIN_CONTRAST}:1)`
  );

  // 4. single hue
  const hues = theme.ramp.map(hueOf);
  const spread = Math.max(...hues) - Math.min(...hues);
  check(spread <= MAX_HUE_SPREAD, "Single hue", `spread ${spread.toFixed(1)}° (max ${MAX_HUE_SPREAD}°)`);

  // 5. ink against the surface
  const cPrimary = contrast(theme.ink.primary, theme.surface);
  const cSecondary = contrast(theme.ink.secondary, theme.surface);
  const cMuted = contrast(theme.ink.muted, theme.surface);
  check(cPrimary >= AA_BODY, "Primary ink contrast", `${cPrimary.toFixed(2)}:1 (min ${AA_BODY}:1)`);
  check(cSecondary >= AA_BODY, "Secondary ink contrast", `${cSecondary.toFixed(2)}:1 (min ${AA_BODY}:1)`);
  check(cMuted >= AA_LARGE, "Muted ink contrast", `${cMuted.toFixed(2)}:1 (min ${AA_LARGE}:1, axis labels only)`);
}

console.log(
  failures === 0
    ? "\n→ ALL PALETTE CHECKS PASS\n"
    : `\n→ ${failures} PALETTE CHECK(S) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
