// Exercises the canonical CAS boundary and ref observation classification.
// Uses the built dist modules against a real bare git repo under mkdtemp.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createCanonicalObserver, compareAndSwapCanonicalRef, createCanonicalRef } from "../../../../dist/src/git/canonical-command.js";

const root = mkdtempSync(join(tmpdir(), "oma-adv-G06-"));
const repo = join(root, "r.git");
function git(args) { return execFileSync("/usr/bin/git", ["--git-dir", repo, ...args], { encoding: "utf8" }); }
try {
  execFileSync("/usr/bin/git", ["init", "-q", "--bare", "--object-format=sha1", repo]);
  // Make two commits on a temp worktree to get two real OIDs.
  const wt = mkdtempSync(join(tmpdir(), "oma-adv-G06-wt-"));
  execFileSync("/usr/bin/git", ["-C", wt, "init", "-q"]);
  execFileSync("/usr/bin/git", ["-C", wt, "config", "user.email", "a@b.c"]);
  execFileSync("/usr/bin/git", ["-C", wt, "config", "user.name", "a"]);
  writeFileSync(join(wt, "f"), "1"); execFileSync("/usr/bin/git", ["-C", wt, "add", "."]); execFileSync("/usr/bin/git", ["-C", wt, "commit", "-q", "-m", "1"]);
  const c1 = execFileSync("/usr/bin/git", ["-C", wt, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  writeFileSync(join(wt, "f"), "2"); execFileSync("/usr/bin/git", ["-C", wt, "add", "."]); execFileSync("/usr/bin/git", ["-C", wt, "commit", "-q", "-m", "2"]);
  const c2 = execFileSync("/usr/bin/git", ["-C", wt, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  execFileSync("/usr/bin/git", ["-C", wt, "push", "-q", repo, "HEAD:refs/heads/src"]);

  const obs = createCanonicalObserver();

  // (A) create-only via empty expected on a nonexistent ref -> candidate
  const a = compareAndSwapCanonicalRef(obs, repo, "refs/heads/main", c1, null);
  console.log("A create null-expected:", a.kind, git(["rev-parse", "refs/heads/main"]).trim() === c1);

  // (B) CAS with WRONG expected (stale). main is c1, we claim expected=c2, candidate=... we try to move.
  const b = compareAndSwapCanonicalRef(obs, repo, "refs/heads/main", c2, c2 /*wrong expected*/);
  console.log("B stale-expected kind:", b.kind, "oid:", b.oid, "(main still c1:", git(["rev-parse", "refs/heads/main"]).trim() === c1, ")");

  // (C) proper CAS c1->c2 with correct expected
  const c = compareAndSwapCanonicalRef(obs, repo, "refs/heads/main", c2, c1);
  console.log("C valid CAS kind:", c.kind, "main==c2:", git(["rev-parse", "refs/heads/main"]).trim() === c2);

  // (D) "already applied" replay: candidate already IS the value, expected is the OLD c1.
  const d = compareAndSwapCanonicalRef(obs, repo, "refs/heads/main", c2, c1);
  console.log("D replay (candidate already present, stale expected) kind:", d.kind, "oid==c2:", d.oid === c2);

  // (E) create-only when ref already exists (empty expected) -> should NOT overwrite
  const e = compareAndSwapCanonicalRef(obs, repo, "refs/heads/main", c1, null);
  console.log("E create-only on existing kind:", e.kind, "main unchanged c2:", git(["rev-parse", "refs/heads/main"]).trim() === c2);

  // (F) argument injection: candidate that starts with '-' (would be validated OID upstream, here raw)
  let fKind = "no-throw";
  try {
    const f = compareAndSwapCanonicalRef(obs, repo, "refs/heads/inj", "--stdin", null);
    fKind = "returned:" + f.kind;
  } catch (err) { fKind = "threw:" + (err && err.message ? err.message.slice(0,40) : err); }
  console.log("F candidate='--stdin' outcome:", fKind, "inj exists:", (()=>{try{git(["rev-parse","--verify","--quiet","refs/heads/inj"]);return true;}catch{return false;}})());

  // (G) ref name starting with '-'
  let gKind = "no-throw";
  try { const g = compareAndSwapCanonicalRef(obs, repo, "--bad", c1, null); gKind = "returned:" + g.kind; }
  catch (err) { gKind = "threw:" + (err && err.message ? err.message.slice(0,40) : err); }
  console.log("G ref='--bad' outcome:", gKind);

  rmSync(wt, { recursive: true, force: true });
} finally {
  rmSync(root, { recursive: true, force: true });
}
