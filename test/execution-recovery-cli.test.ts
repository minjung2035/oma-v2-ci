// #17: actual host command and locks; same-boot recovery must refuse, with real accepted work intact.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { ProcessLock } from "@oma/native/process-lock";
import { tryHoldSociety } from "#oma-test/app/runtime/society-lease";
import { parseOmaArguments } from "#oma-test/app/runtime/host-arguments";
import { mailLedger } from "#oma-test/app/broker/mail-composition";
import { mailEffects } from "#oma-test/app/broker/mail-effects";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import { makeValidAgent, ALL_CAPS } from "./fixtures/spec.js";

test("001. Execution recovery grammar requires an explicit Society and exactly one phase, with no force option", () => {
  assert.deepEqual(parseOmaArguments(["recover-execution", "--society", "demo", "--prepare"]), { kind: "recover-execution", society: "demo", config: undefined, phase: "prepare" });
  for (const args of [[], ["--society", "demo"], ["--society", "demo", "--prepare", "--apply"], ["--society", "demo", "--apply", "--force"], ["--prepare"], ["--society", "../bad", "--apply"]])
    assert.throws(() => parseOmaArguments(["recover-execution", ...args]), { code: "INVALID_REQUEST" });
});
test("002. CLI preparation excludes live Society/broker owners, then preserves a pending accepted plan and refuses same-boot reset", { timeout: 30000 }, async t => {
  const config = createCompleteConfigurationFixture(); t.after(config.close);
  const data = join(config.root, "data"), runtime = join(config.root, "run"), root = join(data, "oma/demo"), runRoot = join(runtime, "oma/demo"), home = join(config.root, "home");
  for (const path of [root, runRoot, home]) mkdirSync(path, { recursive: true, mode: 0o700 });
  const db = join(root, "runtime.sqlite");
  let store = new Store(db, 0, { society: "demo" });
  store.transaction(tx => { for (const actor of ["principal", "alice"]) tx.insertAgent(makeValidAgent(actor)); });
  const effects = mailEffects({ stateRoot: root, society: "demo" });
  const mail = new MailModule({ stateRoot: root, society: "demo" }, mailLedger(store), 64,
    { ...effects, publishMailArchive: () => { throw new Error("injected unpublished accepted mail"); } });
  const result = await mail.send({ actor: "alice", role: "resident", incarnation: 1, channel: "actor", capabilities: new Set(ALL_CAPS),
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } }, "accepted-before-recovery", { to: ["principal"], kind: "message", subject: "accepted", body: "preserve this exact plan" });
  assert.equal(result.state, "pending");
  const accepted = store.getOperation("alice", "accepted-before-recovery"); assert.ok(accepted); store.close();
  const database = readFileSync(db);
  ExecutionJournal.initialize(root); const journal = join(root, "execution/scopes.jsonl"); writeFileSync(journal, "corrupt execution observation\n");
  const original = readFileSync(journal), ticket = join(root, "execution/recovery.json");
  const cli = (phase: string) => spawnSync(process.execPath, [resolve("apps/oma/dist/entry/oma.js"), "recover-execution", "--society", "demo", "--config", config.input, phase], {
    env: { HOME: home, XDG_DATA_HOME: data, XDG_RUNTIME_DIR: runtime, PATH: process.env.PATH, LANG: "C.UTF-8" }, encoding: "utf8", timeout: 10000,
  });
  const lease = tryHoldSociety(root); assert.ok(lease);
  try { const busy = cli("--prepare"); assert.notEqual(busy.status, 0); assert.match(busy.stderr, /close the Society/); assert.equal(existsSync(ticket), false); }
  finally { lease.release(); }
  const broker = ProcessLock.tryAcquire(join(runRoot, "broker.lock")); assert.ok(broker);
  try { const busy = cli("--prepare"); assert.notEqual(busy.status, 0); assert.match(busy.stderr, /a broker owns/); assert.equal(existsSync(ticket), false); }
  finally { broker.close(); }
  const prepared = cli("--prepare"); assert.equal(prepared.status, 0, prepared.stderr); assert.match(prepared.stderr, /Reboot this host/);
  const refused = cli("--apply"); assert.notEqual(refused.status, 0); assert.match(refused.stderr, /requires a different Linux kernel boot/);
  assert.deepEqual(readFileSync(journal), original); assert.deepEqual(readFileSync(db), database);
  assert.equal(existsSync(ticket), true);
  store = new Store(db);
  try {
    const after = store.getOperation("alice", "accepted-before-recovery"); assert.ok(after);
    assert.equal(after.id, accepted.id); assert.equal(after.planJson, accepted.planJson); assert.equal(after.state, "pending");
    assert.equal(existsSync(join(root, "agents/principal/runner/receipts")), false);
  } finally { store.close(); }
});
