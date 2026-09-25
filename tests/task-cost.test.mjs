/* Tests for tools/task-cost.mjs. Run: npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attribute, check, idsOf, median, projectDirName, run } from "../tools/task-cost.mjs";

test("the ids a commit ships are its last parenthesised group, not the ones it mentions", () => {
  assert.deepEqual(idsOf("docs(coverage): name SH1045-SH1050 in the matrix (SH758)", "SH"), ["SH758"]);
  assert.deepEqual(idsOf("feat(spec): benchmark canonical tasks (CCF72)", "CCF"), ["CCF72"]);
  assert.deepEqual(idsOf("docs(backlog): file two (CCF74, CCF75)", "CCF"), ["CCF74", "CCF75"]);
  assert.deepEqual(idsOf("feat(x): the first half (SH1063, part one)", "SH"), ["SH1063"]);
  assert.deepEqual(idsOf("fix(a): the gate (SH1136), with SH1137 filed", "SH"), ["SH1136"]);
  assert.deepEqual(idsOf("chore: bump deps", "SH"), []);
  assert.deepEqual(idsOf("fix(utf8): read UTF8 (SH12)", "SH"), ["SH12"]);
});

test("an id that opens the description is the task when no group names one", () => {
  assert.deepEqual(idsOf("fix(engine): DD279 the relay join takes the teardown budget too", "DD"), ["DD279"]);
  assert.deepEqual(idsOf("docs: add DD279 for the relay join", "DD"), []);
  assert.deepEqual(idsOf("test(WW87): photograph the menu", "DD"), [], "another project's id in the scope is not ours");
  assert.deepEqual(idsOf("fix(x): DD5 first (DD6)", "DD"), ["DD6"], "a group wins over the lead");
});

test("a project with two tracks reads both prefixes", () => {
  assert.deepEqual(idsOf("feat(session): send a reply on Enter (RG304)", "RK,RG"), ["RG304"]);
  assert.deepEqual(idsOf("docs(non-goals): let a reader live under it (RK1696)", "RK,RG"), ["RK1696"]);
  assert.deepEqual(idsOf("docs(roadmap): file two faults (RG303, RG304)", "RK,RG"), ["RG303", "RG304"]);
});

test("a filing range stays one key rather than being spread over the tasks it filed", () => {
  assert.deepEqual(idsOf("docs(backlog): file the corrections (CCF68-CCF73)", "CCF"), ["CCF68-CCF73"]);
  assert.deepEqual(idsOf("docs(roadmap): file Blocks BG and BH (SH1043-SH1069)", "SH"), ["SH1043-SH1069"]);
});

test("a transcript directory is named after the path with every non-alphanumeric a dash", () => {
  assert.equal(projectDirName("d:\\Git\\alegauss\\claude-code-first"), "d--Git-alegauss-claude-code-first");
  assert.equal(projectDirName("D:\\Git\\viglet\\shio\\2026.3"), "D--Git-viglet-shio-2026-3");
});

const req = (ts, cost, out = 100) => ({ ts, fresh: 10, write5m: 0, write1h: 20, read: 1000, out, cost });

test("each request is charged to the first commit at or after it, and a two-id commit splits", () => {
  const commits = [
    { sha: "a", ts: 1000, subject: "feat: one (SH1)" },
    { sha: "b", ts: 2000, subject: "feat: two (SH2, SH3)" },
    { sha: "c", ts: 3000, subject: "chore: no id" }
  ];
  const result = attribute([req(500, 1), req(1000, 1), req(1500, 4), req(2500, 2), req(3500, 8)], commits, "SH");
  const byId = Object.fromEntries(result.tasks.map(t => [t.id, t]));
  assert.equal(byId.SH1.cost, 2);
  assert.equal(byId.SH2.cost, 2);
  assert.equal(byId.SH3.cost, 2);
  assert.equal(result.commits.find(c => c.sha === "c").cost, 2, "a commit with no id keeps its spend");
  assert.equal(result.uncommitted.cost, 8, "work after the last commit is charged to nothing");
});

const tasks = costs => costs.map((cost, i) => ({ id: `SH${i}`, cost, out: cost * 1000, requests: 10 }));

test("the budget judges the median of the window, never one task", () => {
  const spiky = check(tasks([1, 1, 1, 1, 50]), { window: 5, median: { cost: 2 } });
  assert.equal(spiky.verdict, "within");
  const risen = check(tasks([1, 1, 1, 3, 3, 3]), { window: 5, median: { cost: 2 } });
  assert.equal(risen.verdict, "over");
  assert.equal(risen.code, 1);
});

test("growth compares the window with the one before it", () => {
  const grown = check(tasks([1, 1, 1, 2, 2, 2]), { window: 3, growth: { cost: 1.5 } });
  assert.equal(grown.verdict, "over");
  assert.equal(grown.findings[0].value, 2);
  const flat = check(tasks([1, 1, 1, 1, 1, 1]), { window: 3, growth: { cost: 1.5 } });
  assert.equal(flat.verdict, "within");
});

test("too few tasks is a third verdict, not a pass", () => {
  const few = check(tasks([1, 1]), { window: 5, median: { cost: 2 } });
  assert.equal(few.verdict, "inconclusive");
  assert.equal(few.code, 2);
});

test("filing ranges are not judged as tasks", () => {
  const list = [...tasks([1, 1, 1]), { id: "SH10-SH20", cost: 99, out: 0, requests: 1 }];
  assert.equal(check(list, { window: 3, median: { cost: 2 } }).verdict, "within");
});

test("median of an even count is the mean of the middle two", () => {
  assert.equal(median([1, 2, 3, 10]), 2.5);
  assert.equal(median([]), 0);
});

test("end to end: transcripts and a repository give a JSON with no prompt in it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "task-cost-"));
  try {
    const repo = join(dir, "repo");
    mkdirSync(repo);
    const git = (args, date) => execFileSync("git", ["-C", repo, ...args], {
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
        GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }
    });
    git(["init", "-q"], "2026-01-01T00:00:00Z");
    writeFileSync(join(repo, "roadkeep.toml"), 'prefix = "XY"\n');
    git(["add", "."], "2026-01-01T00:00:00Z");
    git(["commit", "-qm", "feat: first (XY1)"], "2026-01-01T10:00:00Z");
    git(["commit", "-q", "--allow-empty", "-m", "feat: second (XY2)"], "2026-01-01T12:00:00Z");

    const root = join(dir, "projects");
    const project = join(root, projectDirName(repo));
    mkdirSync(project, { recursive: true });
    const line = (id, ts, out) => JSON.stringify({
      type: "assistant", requestId: id, timestamp: ts,
      message: { model: "claude-opus-5", usage: { input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: out } }
    });
    const prompt = JSON.stringify({ type: "user", timestamp: "2026-01-01T09:00:00Z", message: { content: "a secret prompt" } });
    writeFileSync(join(project, "s1.jsonl"), [
      prompt,
      line("r1", "2026-01-01T09:30:00Z", 1000),
      line("r1", "2026-01-01T09:30:00Z", 1000),
      line("r2", "2026-01-01T11:00:00Z", 3000)
    ].join("\n") + "\n");

    const json = join(dir, "out.json");
    const log = console.log;
    console.log = () => {};
    let code;
    try { code = await run(["--repo", repo, "--root", root, "--json", json]); } finally { console.log = log; }
    assert.equal(code, 0);
    const text = readFileSync(json, "utf8");
    assert.ok(!text.includes("secret"), "no prompt reaches the output");
    assert.ok(!text.includes("feat:"), "no subject line reaches the output");
    const out = JSON.parse(text);
    const byId = Object.fromEntries(out.tasks.map(t => [t.id, t]));
    assert.equal(byId.XY1.out, 1000, "a request repeated across lines is counted once");
    assert.equal(byId.XY2.out, 3000);
    assert.equal(out.repository.prefix, "XY");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
