// Exercises the guest RequestLedger (MAC-240/241) crash windows and retry.
// Imports the built dist module by relative path.
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
const require_hash = (key) => createHash("sha256").update(key).digest("hex");

const { RequestLedger } = await import("../../../../dist/src/platform/guest/requests.js");

const dir = mkdtempSync(join(tmpdir(), "oma-adv-G13-ledger-"));
try {
  const ledger = new RequestLedger(join(dir, "requests"));
  const KEY = "k".repeat(32);

  // 1) Effect runs once; retry with SAME content returns recorded outcome without re-running.
  let runs = 0;
  const eff = async () => { runs++; return { n: runs }; };
  const a = await ledger.run(KEY, "project.import", { p: 1 }, eff);
  const b = await ledger.run(KEY, "project.import", { p: 1 }, eff);
  console.log("1) same-key retry: first=", JSON.stringify(a), "second=", JSON.stringify(b), "runs=", runs,
    runs === 1 && b.n === 1 ? "OK idempotent" : "PROBLEM re-ran");

  // 2) Crash between intent and outcome: delete outcome file, retry re-runs (MAC-241 intent-only => unknown, re-run).
  const base = join(dir, "requests");
  const files = (await import("node:fs")).readdirSync(base);
  const outcome = files.find(f => f.endsWith(".outcome.json"));
  rmSync(join(base, outcome));
  runs = 0;
  const c = await ledger.run(KEY, "project.import", { p: 1 }, eff);
  console.log("2) outcome lost, retry: re-ran?", runs === 1 ? "yes (re-runs to outcome)" : "no", "result=", JSON.stringify(c));

  // 3) Same key, DIFFERENT content => REQUEST_KEY_REUSED.
  try { await ledger.run(KEY, "project.import", { p: 2 }, eff); console.log("3) different content: PROBLEM accepted"); }
  catch (e) { console.log("3) different content refused:", e.message); }

  // 4) A transient (INTERNAL_ERROR) effect must NOT record an outcome (leaves request to run again).
  const K2 = "m".repeat(32);
  const { StoreError } = await import("../../../../dist/src/domain/errors.js");
  try { await ledger.run(K2, "project.import", { p: 9 }, async () => { throw new StoreError("INTERNAL_ERROR", "boom"); }); }
  catch { /* expected */ }
  const f2 = readdirSync(base).filter(f => f.startsWith(require_hash(K2)));
  console.log("4) transient failure files:", f2, "(should have intent, NO outcome)");

  // 5) intent partial-write: truncate the intent JSON, then status() -> STORE_CORRUPT.
  const K3 = "z".repeat(32);
  await ledger.run(K3, "project.import", { p: 5 }, eff).catch(()=>{});
  const files3 = readdirSync(base);
  const intent3 = files3.find(f => f.endsWith(".intent.json") && f.startsWith(require_hash(K3)));
  writeFileSync(join(base, intent3), "{ truncated");
  try { ledger.status(K3); console.log("5) truncated intent: PROBLEM read ok"); }
  catch (e) { console.log("5) truncated intent:", e.message, "(code should be STORE_CORRUPT)"); }
} finally { rmSync(dir, { recursive: true, force: true }); }
