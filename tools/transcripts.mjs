/*
 * transcripts.mjs — read Claude Code's JSONL transcripts into sessions of
 * priced requests and human prompts.
 *
 * Shared by measure-usage.mjs, which calibrates the simulator, and
 * task-cost.mjs, which attributes the same requests to backlog work. One
 * reader, so the two can never disagree about what a request cost.
 *
 * Reads only. No dependencies. Nothing leaves the machine.
 */

import { createReadStream, readdirSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join, relative } from "node:path";

/* Claude Code profiles. A profile's projects/ is often a symlink to another
   profile's, so resolve and dedupe — otherwise every session counts twice. */
export const DEFAULT_ROOTS = [".claude", ".claude-pessoal"].map(p => join(homedir(), p, "projects"));

export function resolveRoots(roots) {
  return [...new Set((roots.length ? roots : DEFAULT_ROOTS)
    .map(p => { try { return realpathSync(p); } catch { return null; } })
    .filter(Boolean))];
}

/* ------------------------------ pricing ------------------------------ */

/* List prices per million tokens. Sonnet 5 carries its introductory rate,
   the same figure the page quotes. */
const MODELS = [
  [/fable/, { in: 10, out: 50, name: "Fable 5" }],
  [/opus-5|opus5/, { in: 5, out: 25, name: "Opus 5" }],
  [/opus/, { in: 5, out: 25, name: "Opus 4.x" }],
  [/sonnet-5|sonnet5/, { in: 2, out: 10, name: "Sonnet 5" }],
  [/sonnet/, { in: 3, out: 15, name: "Sonnet 4.x" }],
  [/haiku/, { in: 1, out: 5, name: "Haiku 4.5" }]
];
export function priceOf(model) {
  const id = String(model || "");
  for (const [re, p] of MODELS) if (re.test(id)) return p;
  return { in: 5, out: 25, name: id || "unknown" };
}

/* Cache multipliers against the base input price. The 1-hour write is 2x, not
   1.25x — Claude Code uses the 1h TTL, so this materially changes the blended
   input cost the page calls cache_factor. */
export const MULT = { fresh: 1.0, write5m: 1.25, write1h: 2.0, read: 0.1 };

/* ------------------------------ transcript layout ------------------------------ */

function listSessions(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listSessions(p));
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

/* Which session a transcript belongs to, and what ran in it. A subagent file
   sits under the parent session's directory, so the parent is the first path
   segment either way. */
function locate(projectDir, file) {
  const parts = relative(projectDir, file).split(/[\\/]/);
  const stem = s => s.replace(/\.jsonl$/, "");
  if (parts.length === 1) return { session: stem(parts[0]), kind: "main", workflow: null, agent: null };
  const wf = parts.indexOf("workflows");
  return {
    session: parts[0],
    kind: "subagent",
    workflow: wf >= 0 ? parts[wf + 1] : null,
    agent: stem(parts.at(-1))
  };
}

/* ------------------------------ parsing ------------------------------ */

/* Lines that look like user turns but are nobody asking for anything: command
   output echoed back, injected reminders, interrupt markers. A slash command is
   NOT in this list — /loop or /code-review is a person starting work, and those
   sessions are among the most expensive on record. */
const NOT_A_PROMPT = /^(<local-command-stdout>|<system-reminder>|Caveat:|\[Request interrupted)/;
const SLASH_COMMAND = /<command-name>\s*\/?([\w:-]+)/;

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(b => b?.type === "text").map(b => b.text || "").join("\n");
}

/* A task starts when a human asks for something — typed prose or a slash
   command. Tool results, subagent turns and the meta line that carries a
   command's expanded instructions all arrive as role:user too. */
function humanPrompt(o) {
  if (o.type !== "user" || o.isSidechain || o.isMeta) return null;
  if (o.origin?.kind && o.origin.kind !== "human") return null;
  const content = o.message?.content;
  if (Array.isArray(content) && content.some(b => b?.type === "tool_result" || b?.type === "image")) return null;
  const text = textOf(content).trim();
  if (!text || NOT_A_PROMPT.test(text)) return null;
  const command = SLASH_COMMAND.exec(text);
  return {
    kind: command ? "command" : "prompt",
    command: command ? "/" + command[1] : null,
    promptChars: text.length
  };
}

/* One assistant response can span several lines sharing a requestId, and the
   usage block is repeated on each — dedupe or every total inflates. */
function requestOf(o, where) {
  const u = o.message?.usage;
  if (!u) return null;
  const created = u.cache_creation || {};
  const write1h = created.ephemeral_1h_input_tokens || 0;
  const totalWrites = u.cache_creation_input_tokens || 0;
  const write5m = created.ephemeral_5m_input_tokens ?? Math.max(0, totalWrites - write1h);
  const fresh = u.input_tokens || 0;
  const read = u.cache_read_input_tokens || 0;
  const out = u.output_tokens || 0;
  const price = priceOf(o.message.model);
  const billedInput =
    fresh * MULT.fresh + write5m * MULT.write5m + write1h * MULT.write1h + read * MULT.read;
  return {
    ts: Date.parse(o.timestamp) || 0,
    model: price.name,
    effort: o.effort || "unset",
    subagent: where.kind === "subagent" || !!o.isSidechain,
    workflow: where.workflow,
    agent: where.agent,
    fresh, write5m, write1h, read, out,
    ctx: fresh + write5m + write1h + read,
    cost: billedInput * (price.in / 1e6) + out * (price.out / 1e6)
  };
}

async function readTranscript(file, project, where, state, opts) {
  const key = `${project}\u0000${where.session}`;
  const session = state.sessions.get(key) ||
    state.sessions.set(key, { project, id: where.session, prompts: [], requests: [], files: 0 }).get(key);
  session.files++;

  const seen = new Set();
  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    if (line.length < 10) continue;
    /* cheap pre-filter: JSON.parse dominates runtime and most lines are neither */
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { state.unparsed++; continue; }

    if (o.type === "assistant" && o.requestId) {
      if (seen.has(o.requestId)) continue;
      const r = requestOf(o, where);
      if (!r) continue;
      seen.add(o.requestId);
      if (opts.since && r.ts < opts.since) continue;
      if (opts.until && r.ts > opts.until) continue;
      session.requests.push(r);
    } else if (where.kind === "main") {
      const prompt = humanPrompt(o);
      if (!prompt) continue;
      const ts = Date.parse(o.timestamp) || 0;
      if (opts.since && ts < opts.since) continue;
      if (opts.until && ts > opts.until) continue;
      session.prompts.push({ ts, ...prompt });
    }
  }
}

/* Every session under the given roots whose project directory matches
   opts.project (a RegExp, or null for all). */
export async function loadSessions(roots, opts) {
  const state = { sessions: new Map(), unparsed: 0 };
  for (const root of roots) {
    let dirs;
    try { dirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); }
    catch { continue; }
    for (const dir of dirs) {
      if (opts.project && !opts.project.test(dir.name)) continue;
      const projectDir = join(root, dir.name);
      for (const file of listSessions(projectDir)) {
        await readTranscript(file, dir.name, locate(projectDir, file), state, opts);
      }
    }
  }
  return state;
}
