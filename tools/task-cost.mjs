#!/usr/bin/env node
/*
 * task-cost.mjs — what each backlog task cost in Claude Code sessions, and
 * whether the project's recent tasks have grown past a budget.
 *
 * measure-usage.mjs splits spend at every human prompt, which is right for
 * calibrating the simulator and wrong for a project's history: one task spans
 * many prompts, and one prompt can finish several tasks. The unit a project
 * plans in is the commit that ships a task and names it, "fix(x): ... (SH1083)",
 * so this assigns every request to the first commit that lands after it in
 * the same repository, and sums per task id.
 *
 *   node tools/task-cost.mjs --repo D:/Git/viglet/shio/latest
 *   node tools/task-cost.mjs --repo . --since 2026-09-01 --json out.json
 *   node tools/task-cost.mjs --repo . --check budget.json
 *
 * The JSON carries ids, commit hashes and token counts, never a prompt, a
 * subject line or a path inside the project, so it can be committed where a
 * transcript never could.
 *
 * What the attribution cannot see, stated rather than hidden:
 *  - two sessions working in one checkout at once both charge the next commit;
 *  - exploration that never led to a commit is charged to whatever commit
 *    followed it, however much later (the gap is reported per commit);
 *  - a session started in a different directory than the repository (a
 *    junction, a worktree) is found only if --project names it.
 *
 * Exit codes for --check: 0 within budget, 1 over it, 2 too few tasks to judge.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadSessions, resolveRoots } from "./transcripts.mjs";

/* ------------------------------ options ------------------------------ */

const HELP = `task-cost — session cost per backlog task, from transcripts and git history

  --repo <dir>        the repository whose commits define the tasks (required)
  --project <regex>   transcript directories to read (default: derived from --repo)
  --prefix <ID>       task id prefix, e.g. SH (default: roadkeep.toml's prefix)
  --root <dir>        transcript root (repeatable; default: every known profile)
  --since <date>      ignore activity before YYYY-MM-DD
  --until <date>      ignore activity after YYYY-MM-DD
  --json <file>       also write the result as JSON
  --check <file>      compare the recent tasks with a budget file; exit 1 when over
  --top <n>           most expensive tasks to list (default 10)
  --name <name>       what to call the repository (default: its directory)
`;

export function parseArgs(argv) {
  const o = { roots: [], repo: null, project: null, prefix: null, since: null, until: null, json: null, check: null, top: 10, name: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") o.repo = argv[++i];
    else if (a === "--project") o.project = new RegExp(argv[++i], "i");
    else if (a === "--prefix") o.prefix = argv[++i];
    else if (a === "--root") o.roots.push(argv[++i]);
    else if (a === "--since") o.since = Date.parse(argv[++i] + "T00:00:00Z");
    else if (a === "--until") o.until = Date.parse(argv[++i] + "T23:59:59Z");
    else if (a === "--json") o.json = argv[++i];
    else if (a === "--check") o.check = argv[++i];
    else if (a === "--top") o.top = Number(argv[++i]);
    else if (a === "--name") o.name = argv[++i];
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Error(`unknown option: ${a}`);
  }
  return o;
}

/* ------------------------------ the repository ------------------------------ */

/* Claude Code names a project's transcript directory after the path the
   session started in, every character that is not a letter or digit turned
   into a dash: d:\Git\x\y.z becomes d--Git-x-y-z. A junction and its target
   are two names for one checkout, so both are tried. */
export function projectDirName(path) {
  return path.replace(/[^A-Za-z0-9]/g, "-");
}

export function projectPattern(repo) {
  const names = new Set([resolve(repo)]);
  try { names.add(realpathSync.native(resolve(repo))); } catch { /* a missing path is reported by git */ }
  const escaped = [...names].map(p => projectDirName(p).replace(/[-]/g, "\\-"));
  return new RegExp(`^(${escaped.join("|")})$`, "i");
}

/* Every prefix a roadkeep.toml declares; a project with two tracks declares
   one per table. --prefix takes a comma list for a track the file omits. */
export function prefixOf(repo) {
  const toml = resolve(repo, "roadkeep.toml");
  if (!existsSync(toml)) return null;
  const found = [...readFileSync(toml, "utf8").matchAll(/^\s*prefix\s*=\s*"([^"]+)"/gm)].map(m => m[1]);
  return found.length ? [...new Set(found)].join(",") : null;
}

const alternation = prefix => `(?:${prefix.split(",").map(p => p.trim()).filter(Boolean).join("|")})`;

/* The ids a commit ships are the ones in the last parenthesised group of its
   subject that names any: "docs(coverage): name SH1045-SH1050 in the matrix
   (SH758)" ships SH758 and only mentions the others. A range there, as a
   filing commit writes it, stays one key: spreading a filing over the tasks
   it filed would charge each of them for work none of them has had yet.
   A project that writes the id first instead, "fix(engine): DD279 the relay
   join ...", is read from the start of the description when no group names
   one; an id anywhere else in the prose is a mention, never the task. */
export function idsOf(subject, prefix) {
  const p = alternation(prefix);
  const id = `\\b${p}\\d+\\b`;
  const groups = [...subject.matchAll(/\(([^()]*)\)/g)].map(m => m[1]).filter(g => new RegExp(id).test(g));
  if (!groups.length) {
    const lead = new RegExp(`^[\\w-]+(?:\\([^)]*\\))?!?:\\s*(${p}\\d+)\\b`).exec(subject);
    return lead ? [lead[1]] : [];
  }
  const group = groups.at(-1);
  const out = [];
  for (const m of group.matchAll(new RegExp(`${id}(?:\\s*[-\u2013]\\s*(?:${p})?\\d+)?`, "g"))) {
    out.push(m[0].replace(/\s+/g, "").replace("\u2013", "-"));
  }
  return [...new Set(out)];
}

export function commitsOf(repo) {
  const log = execFileSync("git", ["-C", repo, "log", "--format=%H%x09%ct%x09%s"], { encoding: "utf8", maxBuffer: 1 << 28 });
  return log.split("\n").filter(Boolean).map(line => {
    const [sha, ct, ...rest] = line.split("\t");
    return { sha, ts: Number(ct) * 1000, subject: rest.join("\t") };
  }).sort((a, b) => a.ts - b.ts);
}

function headOf(dir) {
  try { return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
  catch { return null; }
}

/* ------------------------------ attribution ------------------------------ */

const sum = a => a.reduce((x, y) => x + y, 0);
export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function firstAtOrAfter(commits, ts) {
  let lo = 0, hi = commits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (commits[mid].ts < ts) lo = mid + 1; else hi = mid;
  }
  return lo < commits.length ? commits[lo] : null;
}

const METRICS = ["requests", "fresh", "write", "read", "out", "cost"];
const zero = () => Object.fromEntries(METRICS.map(k => [k, 0]));

function charge(into, r, share = 1) {
  into.requests += share;
  into.fresh += r.fresh * share;
  into.write += (r.write5m + r.write1h) * share;
  into.read += r.read * share;
  into.out += r.out * share;
  into.cost += r.cost * share;
}

/* Each request goes to the first commit at or after it. A commit that names
   several ids splits its cost evenly among them; one that names none is kept
   by hash, so no spend disappears from the totals. */
export function attribute(requests, commits, prefix) {
  const byCommit = new Map();
  const uncommitted = zero();
  for (const r of requests) {
    const c = firstAtOrAfter(commits, r.ts);
    if (!c) { charge(uncommitted, r); continue; }
    const row = byCommit.get(c.sha) || byCommit.set(c.sha, { sha: c.sha, ts: c.ts, ids: idsOf(c.subject, prefix), first: r.ts, ...zero() }).get(c.sha);
    row.first = Math.min(row.first, r.ts);
    charge(row, r);
  }
  const commitRows = [...byCommit.values()].sort((a, b) => a.ts - b.ts);

  const tasks = new Map();
  for (const c of commitRows) {
    if (!c.ids.length) continue;
    const share = 1 / c.ids.length;
    for (const id of c.ids) {
      const t = tasks.get(id) || tasks.set(id, { id, commits: 0, first: c.first, last: c.ts, ...zero() }).get(id);
      t.commits++;
      t.first = Math.min(t.first, c.first);
      t.last = Math.max(t.last, c.ts);
      for (const k of METRICS) t[k] += c[k] * share;
    }
  }
  const taskRows = [...tasks.values()].sort((a, b) => a.last - b.last);
  return { commits: commitRows, tasks: taskRows, uncommitted };
}

/* ------------------------------ the budget ------------------------------ */

/* A budget file:
     { "window": 10,
       "median": { "cost": 4.0, "out": 60000 },
       "growth": { "cost": 1.5 } }
   "median" caps the median of the last `window` tasks; "growth" caps that
   median against the one of the `window` tasks before them. A single task is
   never judged: one expensive task is a task, a rising median is a trend. */
export function check(tasks, budget) {
  const window = budget.window || 10;
  const single = tasks.filter(t => !t.id.includes("-"));
  const recent = single.slice(-window);
  const before = single.slice(-2 * window, -window);
  const findings = [];
  if (recent.length < window) {
    return { verdict: "inconclusive", code: 2, window, tasks: recent.length,
      findings: [`only ${recent.length} task(s) with an id, fewer than the window of ${window}`] };
  }
  for (const [metric, ceiling] of Object.entries(budget.median || {})) {
    const value = median(recent.map(t => t[metric]));
    findings.push({ kind: "median", metric, value, ceiling, over: value > ceiling });
  }
  for (const [metric, factor] of Object.entries(budget.growth || {})) {
    if (before.length < window) {
      findings.push({ kind: "growth", metric, value: null, ceiling: factor, over: false, note: "no earlier window to compare with" });
      continue;
    }
    const was = median(before.map(t => t[metric])) || 1e-9;
    const value = median(recent.map(t => t[metric])) / was;
    findings.push({ kind: "growth", metric, value, ceiling: factor, over: value > factor });
  }
  const over = findings.some(f => f.over);
  return { verdict: over ? "over" : "within", code: over ? 1 : 0, window, tasks: recent.length, findings };
}

/* ------------------------------ report ------------------------------ */

const k = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n)));
const day = ts => new Date(ts).toISOString().slice(0, 10);

function round(row) {
  const out = { ...row };
  for (const key of METRICS) out[key] = key === "cost" ? +row[key].toFixed(4) : Math.round(row[key]);
  for (const key of ["ts", "first", "last"]) if (key in out) out[key] = new Date(out[key]).toISOString();
  return out;
}

export function summarise(result) {
  const all = [...result.commits.map(c => c.cost), result.uncommitted.cost];
  const total = sum(all);
  const withIds = result.commits.filter(c => c.ids.length);
  const single = result.tasks.filter(t => !t.id.includes("-"));
  return {
    cost: +total.toFixed(2),
    requests: Math.round(sum(result.commits.map(c => c.requests)) + result.uncommitted.requests),
    commitsCharged: result.commits.length,
    commitsWithIds: withIds.length,
    costOnIds: +sum(withIds.map(c => c.cost)).toFixed(2),
    costOnIdsPct: total ? +(100 * sum(withIds.map(c => c.cost)) / total).toFixed(1) : 0,
    uncommittedCost: +result.uncommitted.cost.toFixed(2),
    tasks: single.length,
    costPerTaskMedian: +median(single.map(t => t.cost)).toFixed(3),
    outPerTaskMedian: Math.round(median(single.map(t => t.out))),
    requestsPerTaskMedian: Math.round(median(single.map(t => t.requests)))
  };
}

function report(repoName, summary, result, verdict, top) {
  const L = [];
  L.push(`task cost — ${repoName}`);
  L.push(`  ${summary.tasks} task(s), ${summary.commitsCharged} commit(s) charged, $${summary.cost} in all; ${summary.costOnIdsPct}% of it lands on a commit that names a task`);
  L.push(`  per task: median $${summary.costPerTaskMedian}, ${k(summary.outPerTaskMedian)} output tokens, ${summary.requestsPerTaskMedian} requests`);
  if (summary.uncommittedCost) L.push(`  after the last commit: $${summary.uncommittedCost}, charged to nothing yet`);
  L.push("");
  L.push(`  most expensive`);
  for (const t of [...result.tasks].sort((a, b) => b.cost - a.cost).slice(0, top)) {
    L.push(`    ${t.id.padEnd(16)} $${t.cost.toFixed(2).padStart(8)}  ${k(t.out).padStart(7)} out  ${String(Math.round(t.requests)).padStart(5)} req  ${day(t.last)}`);
  }
  if (verdict) {
    L.push("");
    L.push(`  budget: ${verdict.verdict} (last ${verdict.tasks} of window ${verdict.window})`);
    for (const f of verdict.findings) {
      if (typeof f === "string") { L.push(`    ${f}`); continue; }
      const v = f.value === null ? "n/a" : f.kind === "growth" ? f.value.toFixed(2) + "x" : f.metric === "cost" ? "$" + f.value.toFixed(3) : k(f.value);
      const c = f.kind === "growth" ? f.ceiling + "x" : f.metric === "cost" ? "$" + f.ceiling : k(f.ceiling);
      L.push(`    ${f.over ? "OVER " : "ok   "} ${f.kind} ${f.metric}: ${v} against ${c}${f.note ? " (" + f.note + ")" : ""}`);
    }
  }
  return L.join("\n");
}

/* ------------------------------ main ------------------------------ */

export async function run(argv) {
  const opts = parseArgs(argv);
  if (opts.help || !opts.repo) { console.log(HELP); return opts.help ? 0 : 1; }
  const repo = resolve(opts.repo);
  const prefix = opts.prefix || prefixOf(repo);
  if (!prefix) { console.error("no task id prefix: pass --prefix, or run against a repository with roadkeep.toml"); return 1; }
  const roots = resolveRoots(opts.roots);
  const project = opts.project || projectPattern(repo);

  const state = await loadSessions(roots, { project, since: opts.since, until: opts.until });
  const requests = [...state.sessions.values()].flatMap(s => s.requests).sort((a, b) => a.ts - b.ts);
  if (!requests.length) { console.error(`no transcript matches ${project} under ${roots.join(", ")}`); return 1; }

  const result = attribute(requests, commitsOf(repo), prefix);
  const summary = summarise(result);
  const verdict = opts.check ? check(result.tasks, JSON.parse(readFileSync(opts.check, "utf8"))) : null;
  const repoName = opts.name || basename(realpathSync.native(repo));
  console.log(report(repoName, summary, result, verdict, opts.top));

  if (opts.json) {
    const tool = dirname(fileURLToPath(import.meta.url));
    const out = {
      generated: new Date().toISOString(),
      tool: { name: "claude-code-usage/tools/task-cost.mjs", commit: headOf(tool) },
      repository: { name: repoName, head: headOf(repo), prefix },
      range: { since: opts.since ? day(opts.since) : null, until: opts.until ? day(opts.until) : null,
        first: day(requests[0].ts), last: day(requests.at(-1).ts) },
      attribution: "each request to the first commit at or after it; a commit naming n ids gives each 1/n",
      summary,
      verdict,
      tasks: result.tasks.map(round),
      commits: result.commits.map(c => round({ ...c, gapHours: +((c.ts - c.first) / 3.6e6).toFixed(1) })),
      uncommitted: round(result.uncommitted)
    };
    mkdirSync(dirname(resolve(opts.json)), { recursive: true });
    writeFileSync(opts.json, JSON.stringify(out, null, 2) + "\n");
    console.log(`wrote ${opts.json}`);
  }
  return verdict ? verdict.code : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  process.exitCode = await run(process.argv.slice(2));
}
