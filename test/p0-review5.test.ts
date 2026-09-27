// Priority 0, fifth review (external whole-codebase review of 18421f0, R01-R13):
// regressions that belong to no single owner's test file. Each test names the
// finding (P0V) and the review's id (R).
import test from "node:test";
import assert from "node:assert/strict";
import { KeyDecoder, type Key } from "../src/tui/keys.js";
import { INITIAL, step, type MailRow, type Notice, type PanelData, type State } from "../src/tui/model.js";
import { mailScrollLimit, render } from "../src/tui/view/index.js";
import { unknownDashboard } from "./fixtures/dashboard.js";
import { AcceptedFailure, StoreError, acceptedFailure, errorCodeOf, publicFailure } from "../src/domain/errors.js";
import { AdmissionGate } from "../src/domain/admission.js";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Store } from "../src/store.js";
import { Broker } from "../src/broker.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { ViewsModule } from "../src/views.js";
import type { UnitsModule } from "../src/units.js";
import type { ResolvedAgentSpec } from "../implementation/contracts.js";
import { preparedFixture } from "./fixtures/delivery-receipt.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";

test("P0V-67 / R12, P0-2: where the terminal's reads are cut does not change the text -- a U+FEFF after the cut is kept", () => {
  const bom = [...Buffer.from("﻿", "utf8")];
  const typed = (...reads: number[][]): string => {
    const decoder = new KeyDecoder(() => 0);
    const keys = [...reads.flatMap(read => decoder.push(Uint8Array.from(read))), ...decoder.finish()];
    return keys.map(key => (key.kind === "char" ? key.value : "")).join("");
  };
  const whole = [...Buffer.from("A"), ...bom, ...Buffer.from("B")];
  assert.equal(typed(whole), "A﻿B");
  for (let cut = 1; cut < whole.length; cut += 1)
    assert.equal(typed(whole.slice(0, cut), whole.slice(cut)), "A﻿B", `cut after byte ${cut}`);
  // A read that starts with the character is not the start of a document.
  assert.equal(typed([...bom, ...Buffer.from("x")]), "﻿x");
});

test("P0V-68 / R13, P0-2: the last line of a long message can be scrolled to while a notice or the busy line is shown", () => {
  const row: MailRow = { id: "m-a", from: "worker-a", kind: "message", subject: "long", unread: false, path: "/mail/m-a" };
  const data: PanelData = Object.freeze({ dashboard: unknownDashboard(), config: Object.freeze([]), extensions: Object.freeze([]), mail: Object.freeze([row]), mailUnreadable: null, mailOmitted: 0 });
  let state = step(INITIAL, { kind: "panel" } as Key, data, 262144).state;
  for (const kind of ["right", "right", "enter"] as const) state = step(state, { kind } as Key, data, 262144).state;
  const body = { text: Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join("\n"), truncated: false };
  const notices: [Notice | null, boolean][] = [[null, false], [null, true], [{ kind: "unchanged", label: "x", value: "1" }, false]];
  for (const [notice, busy] of notices) {
    const input = { state, data, transcript: [], body, notice, busy, columns: 60, rows: 12 };
    const bottom = { ...input, state: { ...state, detail: { ...state.detail, scroll: mailScrollLimit(input) } } as State };
    assert.match(render(bottom).join("\n"), /^line 60\s*$/m, `the last line is out of reach (notice ${notice !== null}, busy ${busy})`);
  }
});

test("P0V-64 / R09, P0-2: an accepted failure a cleanup failure was bundled with is public as that accepted failure", () => {
  const actual = "a".repeat(40);
  const accepted = new AcceptedFailure("STALE_BASE", "main moved", "none", { details: { actual } });
  const bundled = new AggregateError([accepted, new Error("EIO while removing a temporary")]);
  assert.deepEqual(publicFailure(bundled), publicFailure(accepted), "phase or details were read from the bundle, not the failure");
  assert.deepEqual(publicFailure(bundled).details, { actual });
  // What is known of the effect is the failure's, not a default.
  for (const knowledge of ["none", "applied"] as const) {
    const failure = acceptedFailure(new AggregateError([new AcceptedFailure("POLICY_CHANGED", "changed", knowledge), new Error("cleanup")]));
    assert.equal(failure.effectKnowledge, knowledge);
    assert.equal(failure.code, "POLICY_CHANGED");
  }
  // A plain failure before acceptance is still one.
  assert.equal(publicFailure(new AggregateError([new StoreError("INVALID_REQUEST", "bad"), new Error("cleanup")])).code, "INVALID_REQUEST");
});

/** A native SQLite error as node:sqlite raises it. */
const sqliteError = (errcode: number): Error => Object.assign(new Error(`sqlite ${errcode}`), { code: "ERR_SQLITE_ERROR", errcode });

test("P0V-69 / F2, P0-5: SQLite's result code is read once -- corruption is corruption, an observation that failed is not", () => {
  const cases: [number, string][] = [
    [11, "STORE_CORRUPT"], [267, "STORE_CORRUPT"], [779, "STORE_CORRUPT"], [26, "STORE_CORRUPT"],
    [5, "DB_BUSY"], [517, "DB_BUSY"], [6, "DB_BUSY"],
    [10, "BROKER_UNAVAILABLE"], [266, "BROKER_UNAVAILABLE"], [14, "BROKER_UNAVAILABLE"], [8, "BROKER_UNAVAILABLE"], [3, "BROKER_UNAVAILABLE"],
    [13, "STORAGE_FULL"], [1, "INTERNAL_ERROR"],
  ];
  for (const [errcode, code] of cases) assert.equal(errorCodeOf(sqliteError(errcode)), code, `SQLite ${errcode}`);
  // A real one: node:sqlite on a file that is not a database.
  const root = mkdtempSync(join(tmpdir(), "oma-notadb-"));
  try {
    const path = join(root, "noise.sqlite");
    writeFileSync(path, randomBytes(8192));
    let native: unknown = null;
    try { new DatabaseSync(path).prepare("SELECT 1 FROM sqlite_master").get(); } catch (error) { native = error; }
    assert.equal(errorCodeOf(native), "STORE_CORRUPT");
    // The fence closes on it, raw or bundled with a cleanup failure, and not on an I/O error.
    const direct = new AdmissionGate(); direct.observe(native);
    assert.equal(direct.state, "corrupt", "a native NOTADB left new acceptance open");
    const bundled = new AdmissionGate(); bundled.observe(new AggregateError([new StoreError("STORE_CORRUPT", "decoded"), new Error("cleanup")]));
    assert.equal(bundled.state, "corrupt");
    const io = new AdmissionGate(); io.observe(sqliteError(10)); io.observe(Object.assign(new Error("EIO"), { code: "EIO" }));
    assert.equal(io.state, "healthy", "an I/O failure was taken for corruption");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("P0V-69 / F2, P0-5: a BEGIN that fails with an I/O or unnamed error does not declare the store corrupt", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-begin-io-"));
  const store = new Store(join(root, "runtime.sqlite"));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const db = Reflect.get(store, "db") as { exec(sql: string): void };
  const exec = db.exec.bind(db);
  for (const [errcode, code] of [[10, "BROKER_UNAVAILABLE"], [1, "INTERNAL_ERROR"], [11, "STORE_CORRUPT"]] as const) {
    db.exec = (sql: string) => { if (sql === "BEGIN IMMEDIATE") throw sqliteError(errcode); exec(sql); };
    assert.throws(() => store.transaction(() => undefined), (error: unknown) => errorCodeOf(error) === code, `BEGIN failing with SQLite ${errcode}`);
  }
  db.exec = exec;
});

test("P0V-70 / F3, P0-2: a status publication that finds the ledger corrupt closes admission; a view file that failed to write does not", async () => {
  const f = await preparedFixture(1);
  const units = { onRevokeRun: undefined, bindIncarnationReader: () => undefined, unitCgroup: () => "" } as unknown as UnitsModule;
  const lifecycle = new LifecycleModule(f.store, units, { stateRoot: f.root, projectGit: join(f.root, "repos", "project.git"), society: "demo",
    hasGoal: () => true, activationAllowed: () => true },
    (_parent: unknown, input: { name: string; from: string; brief: string }) => ({ ...input }) as unknown as ResolvedAgentSpec, f.mail);
  const broker = new Broker(f.store, f.mail, units, new ViewsModule(f.store, f.root, "demo", "p", TEST_VIEW_LIMITS), lifecycle, null, null,
    { stateRoot: f.root, runRoot: join(f.root, "run"), society: "demo", hasGoal: () => true });
  const health = Reflect.get(broker, "health") as AdmissionGate;
  const publish = (failure: { readonly read?: unknown; readonly write?: unknown }): Promise<void> => {
    Reflect.set(broker, "statusRefresh", { request: () => failure.read === undefined ? Promise.resolve({ agents: [] }) : Promise.reject(failure.read) });
    Reflect.set(broker, "views", { publishStatus: () => { if (failure.write !== undefined) throw failure.write; } });
    (Reflect.get(broker, "publishStatus") as () => void).call(broker);
    return new Promise(resolve => setImmediate(() => setImmediate(resolve)));
  };
  try {
    await publish({ write: Object.assign(new Error("EIO: view file"), { code: "EIO" }) });
    assert.equal(health.state, "healthy", "a view file that failed to write closed admission");
    await publish({ write: new StoreError("STORE_CORRUPT", "a delivery row does not decode") });
    assert.equal(health.state, "corrupt", "corruption found while publishing status left admission open");
    const second = new AdmissionGate(); Reflect.set(broker, "health", second);
    await publish({ read: sqliteError(26) });
    assert.equal(second.state, "corrupt", "a ledger read that failed as NOTADB left admission open");
  } finally {
    await broker.drainAndClose();
    (f.store as unknown as { close(): void }).close = () => undefined;
    f.close();
  }
});
