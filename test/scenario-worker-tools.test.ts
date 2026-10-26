import { TransportSpool } from "@oma/storage/transport-spool";
/** mail-v1 Worker review loop end-to-end through the model-facing tools.
 *
 * A real society runs (provisioned state, broker, Principal session); each
 * Resident's tools are the real registration (`registerOmaTools` with a
 * detached channel), invoked directly — no model, no engine. A tool call runs
 * the real `oma` CLI as a child process; the CLI reaches the scenario's real
 * broker over a real unix socket. As the broker's own actor endpoints bind one
 * socket to one agent (the frames carry no actor), each Worker here gets a
 * private socket bridge that dispatches every frame with that actor's resident
 * authority — the same RpcConnection, limits and stream framing the broker
 * itself uses. git.submit streams, review acceptance, mail materialization
 * and the main CAS are all real. Assertions are durable facts — ledger rows,
 * mailbox files, receipts — plus the refusal text the tool surfaces; results
 * are captured in outer variables and asserted only after execute() resolves
 * (a throw inside a provider callback only reports "provider failed").
 */
import "#oma-test/app/runtime/client-preload";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Actor, AuthContext, Capability, Request } from "@oma/contracts";
import { capabilitiesOf } from "@oma/domain/authority";
import { RpcConnection } from "@oma/broker/connection";
import { SharedPeerPin } from "@oma/broker/peer-pin";
import { PrincipalChannel } from "@oma/extension/principal-channel";
import { registerOmaTools } from "@oma/extension/mail-tools";
import { storedMailBytes } from "@oma/domain/mail-values";
import { readableBody } from "@oma/mail/display";
import { inspectLedger } from "#oma-test/app/diagnostics/ledger";
import { readDiagnosticSnapshot } from "@oma/storage";
import { agentRootPathAt, actorSocketDirectoryAt, actorSocketPathAt, projectGitPathAt, runnerViewPathAt, workspacePathAt }
  from "@oma/domain/paths";
import { SCENARIO_LIMITS, withScenario, type Scenario } from "./fixtures/scenario.js";

const TIMEOUT = { timeout: 120_000 };
const SOCIETY = "demo";
const CLI = fileURLToPath(new URL("../../apps/oma/dist/cli.js", import.meta.url));
const GIT = "/usr/bin/git";

/** The tool result's one text block is the CLI's stdout. */
type Tool = { execute: (id: string, params: Record<string, unknown>) => Promise<unknown> };
/** A printed receipt, from any `succeeded` answer's single JSON line. */
const receiptIn = (result: string): { operation?: string; state?: string; result?: Record<string, unknown> } => {
  const found = result.match(/\{"operation":"[^"]+".*\}/);
  assert.ok(found, `no receipt in tool result: ${result.slice(0, 300)}`);
  return JSON.parse(found[0]);
};
const nameOf = (file: string): string => file.replace(/:2,.*$/, "");
const canonicalMain = (s: Scenario): string =>
  execFileSync(GIT, ["--git-dir", projectGitPathAt(s.root), "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim();
const mailFiles = (dir: string): string[] => existsSync(dir) ? readdirSync(dir).sort() : [];
const workersDir = (s: Scenario): string => join(s.root, "mail", "workers", "cur");
const archiveDir = (s: Scenario): string => join(s.root, "mail", "archive", "cur");
/** The request's rev-N thread revision in the workers archive, if materialized. */
const threadRevision = (s: Scenario, name: string, rev: number): string | null =>
  mailFiles(workersDir(s)).map(file => readFileSync(join(workersDir(s), file), "utf8"))
    .find(eml => new RegExp(`^Subject: \\[${name}\\] .*\\(rev ${rev}\\)`, "m").test(eml)) ?? null;
/** The stored raw message an inbox names, in whichever archive its audience put it. */
const storedMessage = (s: Scenario, id: string): string => {
  for (const dir of [archiveDir(s), workersDir(s)]) {
    const file = mailFiles(dir).find(entry => entry.startsWith(`${id}:`));
    if (file !== undefined) return readFileSync(join(dir, file), "utf8");
  }
  assert.fail(`no stored message ${id}`);
};
/** The principal's pending approval mail for a request, by content not position. */
const pendingApproval = (s: Scenario, name: string): string => {
  const found = s.inbox("principal").map(nameOf).filter(id => {
    const eml = s.archived(id);
    return /X-Oma-Kind: approval_required/i.test(eml) && eml.includes(`[${name}]`);
  });
  assert.equal(found.length, 1, `expected exactly one pending approval for ${name}, got ${found}`);
  return found[0]!;
};

/** The authority the broker's own actor endpoint would bind to this socket:
 * the agent's live role, incarnation and profile-derived capabilities. */
function actorAuth(s: Scenario, actor: Actor): AuthContext {
  const agent = s.store.getAgent(actor);
  assert.ok(agent, `no agent ${actor}`);
  return {
    actor, incarnation: agent.incarnation, role: agent.role, channel: "actor",
    get capabilities(): ReadonlySet<Capability> {
      const current = s.store.getAgent(actor);
      return current === null ? new Set() : capabilitiesOf(current);
    },
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() },
  };
}
/** Any actor's dispatch, as residentCall builds it. */
const actorCall = (s: Scenario, actor: Actor, method: string, params: Record<string, unknown>, key: string | null) =>
  s.broker.dispatch(actorAuth(s, actor),
    { v: 1, id: key ?? method, method, ...(key === null ? {} : { request: key }), params } as unknown as Request, null) as
    Promise<Record<string, unknown>>;

interface Bridge {
  readonly path: string;
  /** Every request frame the socket has forwarded, in order. */
  readonly frames: Record<string, unknown>[];
  close(): Promise<void>;
}
/** One unix socket bound to one actor: every frame is dispatched with that
 * actor's resident authority, exactly as the broker's actor endpoint would.
 * Framing, stream spooling and limits are the product's own (RpcConnection). */
async function actorSocket(s: Scenario, actor: Actor, frames: Record<string, unknown>[]): Promise<Bridge> {
  const agent = s.store.getAgent(actor);
  assert.ok(agent, `no resident ${actor}`);
  const directory = actorSocketDirectoryAt(s.runRoot, actor, agent.incarnation);
  mkdirSync(directory, { recursive: true });
  const path = actorSocketPathAt(s.runRoot, actor, agent.incarnation);
  const connections = new Set<RpcConnection>();
  const tasks = new Set<Promise<void>>();
  const errors: unknown[] = [];
  const server: Server = createServer(socket => {
    const connection = new RpcConnection({
      socket,
      makeSpool: descriptor => new TransportSpool(join(s.root, "staging"), descriptor),
      peer: new SharedPeerPin(() => true, () => {}),
      limits: { frameBytes: SCENARIO_LIMITS.frameBytes,
        idleStreamSeconds: SCENARIO_LIMITS.idleStreamSeconds, receiptWaitSeconds: SCENARIO_LIMITS.receiptWaitSeconds },
      preflight(raw) {
        const params = raw.params as { bundle?: { bytes?: unknown } } | undefined;
        if (params?.bundle)
          assert.ok(typeof params.bundle.bytes === "number" && params.bundle.bytes <= SCENARIO_LIMITS.bundleBytes,
            "bundle exceeds the configured stream bound");
      },
      handle: async (raw, body) => {
        frames.push(raw);
        return await s.broker.dispatch(actorAuth(s, actor), raw as unknown as Request, body);
      },
      onTask(task) {
        tasks.add(task);
        void task.finally(() => tasks.delete(task)).catch(error => errors.push(error));
      },
      onCleanupError: error => errors.push(error),
      onClosed: () => connections.delete(connection),
    });
    connections.add(connection);
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, resolve); });
  return {
    path, frames,
    async close() {
      for (const connection of connections) connection.close();
      await Promise.allSettled([...tasks]);
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
      assert.deepEqual(errors, [], "bridge transport errors");
    },
  };
}

interface Worker {
  readonly actor: string;
  readonly workspace: string;
  readonly home: string;
  readonly tools: Map<string, Tool>;
  readonly bridge: Bridge;
  /** Runs the registered tool and returns its one text block (CLI stdout). */
  call(tool: string, params: Record<string, unknown>): Promise<string>;
}

/** The lifecycle's per-agent layout (LIFE-002): a private clone of canonical
 * main whose origin is the canonical repository, plus the agent's home and
 * batch view — then the real tool registration bound to that actor's socket. */
async function openWorker(s: Scenario, actor: Actor): Promise<Worker> {
  const workspace = workspacePathAt(s.root, actor);
  const git = (args: string[], cwd: string): string =>
    execFileSync(GIT, args, { cwd, encoding: "utf8" }).trim();
  git(["clone", "--no-local", "--single-branch", "--branch", "main", projectGitPathAt(s.root), workspace], s.root);
  git(["remote", "set-url", "origin", projectGitPathAt(s.root)], workspace);
  git(["config", "user.email", `${actor}@demo.oma.invalid`], workspace);
  git(["config", "user.name", actor], workspace);
  const home = join(agentRootPathAt(s.root, actor), "home");
  const view = runnerViewPathAt(s.root, actor);
  mkdirSync(home, { recursive: true });
  mkdirSync(view, { recursive: true });
  const frames: Record<string, unknown>[] = [];
  const bridge = await actorSocket(s, actor, frames);
  const tools = new Map<string, Tool>();
  const previous = { ...process.env };
  // The engine's per-actor values are the registration's — it freezes them
  // into the environment every CLI this actor ever runs is started with.
  Object.assign(process.env, {
    OMA_AGENT_HOME: home, OMA_SOCKET: bridge.path, OMA_BATCH_VIEW: view, OMA_ACTOR: actor,
  });
  try {
    registerOmaTools({ registerTool: (tool: never) => tools.set((tool as { name: string }).name, tool as unknown as Tool) } as never,
      workspace, PrincipalChannel.detached());
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
  const call = async (tool: string, params: Record<string, unknown>): Promise<string> => {
    const registered = tools.get(tool);
    assert.ok(registered, `${tool} was not registered for ${actor}`);
    const result = await registered.execute(`w-${tool}`, params) as { content?: { text?: string }[] };
    return result?.content?.[0]?.text ?? "";
  };
  return { actor, workspace, home, tools, bridge, call };
}

interface WorkerRig {
  worker(actor: Actor): Worker;
  close(): Promise<void>;
}
/** The shared engine environment a Resident's spawn plan sets (host paths —
 * this rig registers tools directly, not a Resident engine) with each actor's
 * own socket/home/view bound at that actor's registration only. */
async function workerRig(s: Scenario, actors: readonly Actor[]): Promise<WorkerRig> {
  const previous = { ...process.env };
  Object.assign(process.env, {
    OMA_CLI_PATH: CLI,
    OMA_MAIL_ARCHIVE: archiveDir(s),
    OMA_WORKER_ARCHIVE: workersDir(s),
    OMA_SOCIETY: SOCIETY,
    OMA_PROJECT_GIT: projectGitPathAt(s.root),
    OMA_CONTEXT_GIT: "",
    OMA_MAIL_BYTES: String(storedMailBytes(SCENARIO_LIMITS.mailBodyBytes)),
    OMA_FRAME_BYTES: String(SCENARIO_LIMITS.frameBytes),
    OMA_CONTEXT_BYTES: String(SCENARIO_LIMITS.contextBytes),
    OMA_BUNDLE_BYTES: String(SCENARIO_LIMITS.bundleBytes),
  });
  const workers = new Map<string, Worker>();
  const restore = (): void => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  };
  try {
    for (const actor of actors) workers.set(actor, await openWorker(s, actor));
  } catch (error) {
    for (const worker of workers.values()) await worker.bridge.close().catch(() => undefined);
    restore();
    throw error;
  }
  return {
    worker(actor) {
      const found = workers.get(actor);
      assert.ok(found, `worker ${actor} was not registered`);
      return found;
    },
    async close() {
      let first: unknown;
      for (const worker of workers.values())
        await worker.bridge.close().catch(error => { first ??= error; });
      restore();
      if (first !== undefined) throw first;
    },
  };
}

/** Commits `change` on the worker's clone: HEAD is the candidate and
 * refs/remotes/origin/main is the base `merge open` resolves. */
function commitWork(w: Worker, message: string, change: (work: string) => void): { candidate: string; base: string } {
  const git = (args: string[]): string => execFileSync(GIT, args, { cwd: w.workspace, encoding: "utf8" }).trim();
  const base = git(["rev-parse", "refs/remotes/origin/main"]);
  change(w.workspace);
  git(["add", "-A"]);
  git(["commit", "-m", message]);
  return { candidate: git(["rev-parse", "HEAD"]), base };
}
const requestNameOf = (receipt: { result?: Record<string, unknown> }): string => {
  const name = receipt.result?.request;
  assert.ok(typeof name === "string", `receipt carries no request name: ${JSON.stringify(receipt).slice(0, 200)}`);
  return name;
};

test("SCN-W01: a LOW merge through a Worker's own tools applies and notifies commons+principal", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob"] }, async s => {
    const rig = await workerRig(s, ["alice", "bob"]);
    try {
      const alice = rig.worker("alice"), bob = rig.worker("bob");
      const { candidate } = commitWork(alice, "w01", work => writeFileSync(join(work, "w01.txt"), "content w01\n"));
      const opened = receiptIn(await alice.call("oma_merge",
        { action: "open", tier: "LOW", title: "w01 change", reason: "the reason for w01", request: "w01.open" }));
      assert.equal(opened.state, "succeeded", `open: ${JSON.stringify(opened).slice(0, 300)}`);
      const name = requestNameOf(opened);
      assert.match(name, /^merge-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      // The ledger shows alice's publish, open and the review-driven integrate.
      const ops = s.operations("alice");
      assert.ok(ops.some(row => row.kind === "git.submit" && row.request_key === "w01.open.submit" && row.state === "succeeded"),
        `no git.submit: ${JSON.stringify(ops)}`);
      assert.ok(ops.some(row => row.kind === "attest.record" && row.request_key === "w01.open" && row.state === "succeeded"));
      assert.ok(ops.some(row => row.kind === "git.integrate" && row.state === "succeeded"),
        `no applied integration: ${JSON.stringify(ops)}`);
      await s.idle();
      assert.equal(canonicalMain(s), candidate, "main advanced to the workspace HEAD");
      // Exactly one completion notice: kind result, to commons + principal.
      const notices = mailFiles(archiveDir(s))
        .map(file => [file, readFileSync(join(archiveDir(s), file), "utf8")] as const)
        .filter(([, eml]) => /X-Oma-Kind: result/i.test(eml) && eml.includes(`[${name}]`));
      assert.equal(notices.length, 1, `expected one completion notice, got ${notices.map(([file]) => file)}`);
      const [noticeFile, notice] = notices[0]!;
      assert.match(notice, /^To:.*commons@demo\.oma\.invalid/m);
      assert.match(notice, /^To:.*principal@demo\.oma\.invalid/m);
      assert.match(readableBody(notice), /content w01/, "the notice carries the applied diff");
      // A LOW merge has no worker review thread at all.
      assert.deepEqual(mailFiles(workersDir(s)), [], `LOW opened no thread: ${mailFiles(workersDir(s))}`);
      // Another Worker's own registration reads the notice from the public archive.
      const read = await bob.call("oma_mail_read", { messageId: nameOf(noticeFile) });
      assert.match(read, /content w01/);
      assert.match(read, new RegExp(name));
      const report = inspectLedger(readDiagnosticSnapshot(s.root), { stateRoot: s.root, society: SOCIETY });
      assert.equal(report.report.status, "PASS", report.report.issues.map(issue => issue.code).join(","));
    } finally { await rig.close(); }
  });
});

test("SCN-W02: a MEDIUM merge needs one peer vote; the other Worker supplies it through the tools", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob"] }, async s => {
    const rig = await workerRig(s, ["alice", "bob"]);
    try {
      const alice = rig.worker("alice"), bob = rig.worker("bob");
      const { candidate } = commitWork(alice, "w02", work => writeFileSync(join(work, "w02.txt"), "content w02\n"));
      const opened = receiptIn(await alice.call("oma_merge",
        { action: "open", tier: "MEDIUM", title: "w02", reason: "the reason for w02", request: "w02.open" }));
      assert.equal(opened.state, "succeeded");
      const name = requestNameOf(opened);
      const before = JSON.parse(await bob.call("oma_merge", { action: "status", name })) as
        { display: string; required: number; approvers: string[] };
      assert.equal(before.display, "peer-needed");
      assert.equal(before.required, 1);
      assert.deepEqual(before.approvers, []);
      const voted = receiptIn(await bob.call("oma_merge",
        { action: "vote", name, verdict: "approve", body: "bob approves w02", request: "w02.bob" }));
      assert.equal(voted.state, "succeeded");
      await s.idle();
      assert.equal(canonicalMain(s), candidate);
      const after = JSON.parse(await alice.call("oma_merge", { action: "status", name })) as
        { display: string; approvers: string[] };
      assert.equal(after.display, "applied");
      assert.deepEqual(after.approvers, ["bob"]);
      // The workers archive holds the thread revisions (open + vote).
      assert.ok(threadRevision(s, name, 0) !== null, "the open's rev-0 thread is in the workers archive");
      assert.ok(threadRevision(s, name, 1) !== null, "the vote's rev-1 thread is in the workers archive");
      // The completion notice reaches every resident through commons.
      for (const actor of ["alice", "bob"] as const) {
        const ids = s.inbox(actor).map(nameOf);
        assert.ok(ids.some(id => { const eml = storedMessage(s, id); return /X-Oma-Kind: result/i.test(eml) && eml.includes(`[${name}]`); }),
          `${actor} inbox lacks the result notice: ${ids}`);
      }
      assert.equal(s.inbox("principal").map(nameOf).filter(id => s.archived(id).includes(`[${name}]`)).length, 1,
        "the principal got the completion notice");
    } finally { await rig.close(); }
  });
});

test("SCN-W03: oma_merge diff pages the exact base→candidate patch and refuses bad cursors", TIMEOUT, async () => {
  await withScenario({ residents: ["alice"] }, async s => {
    const rig = await workerRig(s, ["alice"]);
    try {
      const alice = rig.worker("alice");
      const lines = Array.from({ length: 4200 }, (_, i) => `row ${i} ${"x".repeat(24)}`).join("\n");
      const { candidate, base } = commitWork(alice, "w03",
        work => writeFileSync(join(work, "big.txt"), `${lines}\n한 줄\n`));
      const opened = receiptIn(await alice.call("oma_merge",
        { action: "open", tier: "LOW", title: "w03 big", reason: "a diff bigger than a page", request: "w03.open" }));
      const name = requestNameOf(opened);
      // The byte-exact patch the CLI's merge-diff flags produce.
      const expected = execFileSync(GIT, ["--git-dir", projectGitPathAt(s.root), "diff",
        "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color", base, candidate]);
      assert.ok(expected.length > 64 * 1024, `the fixture diff must exceed a page (${expected.length})`);
      interface Page { sha256: string; bytes: number; cursor: number; next: number | null; text: string; base: string; candidate: string }
      const pages: Page[] = [];
      for (let cursor: number | undefined; ;) {
        const page = JSON.parse(await alice.call("oma_merge",
          { action: "diff", name, ...(cursor === undefined ? {} : { cursor }) })) as Page;
        pages.push(page);
        if (page.next === null) break;
        assert.ok(pages.length < 64, "diff paging did not converge");
        cursor = page.next;
      }
      assert.ok(pages.length >= 2, `expected several pages, got ${pages.length}`);
      const digest = createHash("sha256").update(expected).digest("hex");
      assert.equal(pages[0]!.sha256, digest);
      assert.equal(pages[0]!.bytes, expected.length);
      assert.equal(pages[0]!.cursor, 0);
      for (const [index, page] of pages.entries()) {
        assert.equal(page.cursor, index === 0 ? 0 : pages[index - 1]!.next);
        assert.equal(page.next === null, index === pages.length - 1);
        assert.equal(page.base, base);
        assert.equal(page.candidate, candidate);
      }
      assert.equal(Buffer.concat(pages.map(page => Buffer.from(page.text, "utf8"))).equals(expected), true,
        "the pages reassemble the exact diff");
      // Cursor refusals surface through the tool as CLI failures.
      await assert.rejects(() => alice.call("oma_merge", { action: "diff", name, cursor: expected.length }),
        /not at a page boundary/);
      const continuation = expected.findIndex((byte, index) => index > 0 && (byte & 0xc0) === 0x80);
      assert.ok(continuation > 0, "the fixture diff carries a UTF-8 continuation byte");
      await assert.rejects(() => alice.call("oma_merge", { action: "diff", name, cursor: continuation }),
        /not at a page boundary/);
      await assert.rejects(() => alice.call("oma_merge", { action: "diff", name, cursor: "abc" }), /invalid cursor/);
    } finally { await rig.close(); }
  });
});

test("SCN-W04: the requester cancels a HIGH merge; a later Worker vote is refused REQUEST_CLOSED", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob"] }, async s => {
    const rig = await workerRig(s, ["alice", "bob"]);
    try {
      const alice = rig.worker("alice"), bob = rig.worker("bob");
      commitWork(alice, "w04", work => writeFileSync(join(work, "w04.txt"), "content w04\n"));
      const opened = receiptIn(await alice.call("oma_merge",
        { action: "open", tier: "HIGH", title: "w04", reason: "the reason for w04", request: "w04.open" }));
      const name = requestNameOf(opened);
      const cancelled = receiptIn(await alice.call("oma_merge",
        { action: "cancel", name, reason: "superseded by a newer change", request: "w04.cancel" }));
      assert.equal(cancelled.state, "succeeded");
      const status = JSON.parse(await alice.call("oma_merge", { action: "status", name })) as { display: string };
      assert.equal(status.display, "cancelled");
      const opsBefore = s.operations().length;
      await assert.rejects(() => bob.call("oma_merge",
        { action: "vote", name, verdict: "approve", body: "a late approve", request: "w04.bob" }), /REQUEST_CLOSED/);
      assert.equal(s.operations().length, opsBefore, "a closed request records nothing");
    } finally { await rig.close(); }
  });
});

test("SCN-W05: self-review is refused, a Worker's approval field never reaches the wire, a second vote supersedes", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const rig = await workerRig(s, ["alice", "bob"]);
    try {
      const alice = rig.worker("alice"), bob = rig.worker("bob");
      commitWork(alice, "w05", work => writeFileSync(join(work, "w05.txt"), "content w05\n"));
      const opened = receiptIn(await alice.call("oma_merge",
        { action: "open", tier: "HIGH", title: "w05", reason: "the reason for w05", request: "w05.open" }));
      const name = requestNameOf(opened);
      await assert.rejects(() => alice.call("oma_merge",
        { action: "vote", name, verdict: "approve", body: "approving my own", request: "w05.self" }), /SELF_REVIEW/);
      // A Worker's vote has no approval field; the refusal is local.
      const framesBefore = bob.bridge.frames.length, opsBefore = s.operations().length;
      await assert.rejects(() => bob.call("oma_merge",
        { action: "vote", name, verdict: "approve", body: "b", approval: "m-00000000-0000-4000-8000-000000000001-0", request: "w05.bad" }),
        /approval is only the Principal's field is not valid/);
      assert.equal(bob.bridge.frames.length, framesBefore, "the refusal never reached the wire");
      assert.equal(s.operations().length, opsBefore);
      const first = receiptIn(await bob.call("oma_merge",
        { action: "vote", name, verdict: "approve", body: "first look is fine", request: "w05.v1" }));
      assert.equal(first.state, "succeeded");
      const second = receiptIn(await bob.call("oma_merge",
        { action: "vote", name, verdict: "approve", body: "second look still fine", request: "w05.v2" }));
      assert.equal(second.state, "succeeded");
      const status = JSON.parse(await alice.call("oma_merge", { action: "status", name })) as
        { display: string; approvers: string[]; entries: { kind: string; actor: string; verdict?: string }[] };
      assert.deepEqual(status.approvers, ["bob"], "the latest approve supersedes, it does not add");
      assert.deepEqual(status.entries.filter(entry => entry.kind === "vote" && entry.actor === "bob").map(entry => entry.verdict),
        ["approve", "approve"], "both vote facts stay on the ledger");
      assert.equal(status.display, "peer-needed", "one more of the required two peer approvals is missing");
      const rev2 = threadRevision(s, name, 2);
      assert.ok(rev2 !== null, "the superseding vote's rev-2 thread exists");
      assert.match(readableBody(rev2), /second look still fine/);
    } finally { await rig.close(); }
  });
});

test("SCN-W06: a HIGH challenge opened by tool reverts the applied merge on the Principal's vote", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const rig = await workerRig(s, ["alice", "bob", "carol"]);
    try {
      const alice = rig.worker("alice"), bob = rig.worker("bob"), carol = rig.worker("carol");
      const { candidate } = commitWork(alice, "w06", work => writeFileSync(join(work, "w06.txt"), "content w06\n"));
      const merged = receiptIn(await alice.call("oma_merge",
        { action: "open", tier: "LOW", title: "w06", reason: "the reason for w06", request: "w06.open" }));
      const mergeName = requestNameOf(merged);
      assert.equal(canonicalMain(s), candidate);
      const opened = receiptIn(await alice.call("oma_challenge",
        { action: "open", merge: mergeName, tier: "HIGH", title: "revert w06", reason: "a regression", request: "w06.ch" }));
      assert.equal(opened.state, "succeeded");
      const challenge = requestNameOf(opened);
      assert.match(challenge, /^challenge-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      for (const [worker, key] of [[bob, "w06.bob"], [carol, "w06.carol"]] as const) {
        const voted = receiptIn(await worker.call("oma_challenge",
          { action: "vote", name: challenge, verdict: "approve", body: `${worker.actor} approves the revert`, request: key }));
        assert.equal(voted.state, "succeeded");
      }
      await s.idle();
      // Both peer approvals produced the Principal's approval mail.
      const approval = pendingApproval(s, challenge);
      // A Worker's diff sees the revert patch and, on request, the original.
      const revert = JSON.parse(await bob.call("oma_challenge", { action: "diff", name: challenge, view: "revert" })) as
        { view: string; text: string };
      assert.equal(revert.view, "revert");
      assert.match(revert.text, /-content w06/, "the revert patch removes the change");
      const original = JSON.parse(await bob.call("oma_challenge", { action: "diff", name: challenge, view: "original" })) as
        { view: string; text: string };
      assert.match(original.text, /\+content w06/, "the original patch adds the change");
      // The Principal's decision goes over the same wire fact its tools send.
      const reply = await actorCall(s, "principal", "attest.record",
        { kind: "vote", name: challenge, verdict: "approve", body: "the revert is right", approval }, "w06.principal");
      assert.equal(reply.ok, true, `principal vote refused: ${JSON.stringify(reply).slice(0, 300)}`);
      await s.idle();
      const head = canonicalMain(s);
      assert.notEqual(head, candidate, "main moved off the merged commit");
      const applied = execFileSync(GIT, ["--git-dir", projectGitPathAt(s.root), "diff", candidate, head], { encoding: "utf8" });
      assert.match(applied, /-content w06/, "the revert commit removed the change");
      const status = JSON.parse(await alice.call("oma_challenge", { action: "status", name: challenge })) as { display: string };
      assert.equal(status.display, "applied");
    } finally { await rig.close(); }
  });
});

test("SCN-W07: a same-key open through the tool replays the frozen request — one submit, one record", TIMEOUT, async () => {
  await withScenario({ residents: ["alice"] }, async s => {
    const rig = await workerRig(s, ["alice"]);
    try {
      const alice = rig.worker("alice");
      commitWork(alice, "w07", work => writeFileSync(join(work, "w07.txt"), "content w07\n"));
      const params = { action: "open", tier: "LOW", title: "w07", reason: "the same key twice", request: "w07.open" } as const;
      const first = receiptIn(await alice.call("oma_merge", params));
      const second = receiptIn(await alice.call("oma_merge", params));
      assert.equal(first.state, "succeeded");
      assert.equal(second.state, "succeeded");
      assert.equal(first.operation, second.operation, "the replay returned the first operation's receipt");
      assert.equal(requestNameOf(first), requestNameOf(second));
      // The CLI's request cache froze the open: the second run asked the ledger
      // for the frozen key rather than rebuilding anything from the workspace.
      const ops = s.operations("alice");
      assert.equal(ops.filter(row => row.kind === "attest.record" && row.request_key === "w07.open").length, 1);
      assert.equal(ops.filter(row => row.kind === "git.submit").length, 1, "the frozen replay never re-submits");
      const methods = alice.bridge.frames.map(frame => frame.method);
      assert.deepEqual(methods, ["git.known", "git.submit", "attest.record", "operation.get"],
        `expected one publish+open and a same-key lookup, got ${JSON.stringify(methods)}`);
    } finally { await rig.close(); }
  });
});

test("SCN-W08: a Worker review adds a thread revision naming the open; the Principal hears nothing", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob"] }, async s => {
    const rig = await workerRig(s, ["alice", "bob"]);
    try {
      const alice = rig.worker("alice"), bob = rig.worker("bob");
      commitWork(alice, "w08", work => writeFileSync(join(work, "w08.txt"), "content w08\n"));
      const opened = receiptIn(await alice.call("oma_merge",
        { action: "open", tier: "MEDIUM", title: "w08", reason: "the reason for w08", request: "w08.open" }));
      const name = requestNameOf(opened);
      const rev0 = threadRevision(s, name, 0);
      assert.ok(rev0 !== null, "the open's rev-0 thread was materialized");
      const rev0Id = rev0.match(/^Message-ID: <([^@>]+)@demo\.oma\.invalid>/m)![1]!;
      const reviewed = receiptIn(await bob.call("oma_merge",
        { action: "review", name, body: "looks fine, but see the tests", request: "w08.review" }));
      assert.equal(reviewed.state, "succeeded");
      const rev1 = threadRevision(s, name, 1);
      assert.ok(rev1 !== null, "the review's rev-1 thread revision exists");
      assert.match(rev1, new RegExp(`^References:.*<${rev0Id}@demo\\.oma\\.invalid>`, "m"),
        "rev-1 names the open message it replies to");
      assert.match(readableBody(rev1), /looks fine, but see the tests/);
      assert.equal(s.inbox("principal").length, 0, "a MEDIUM review sends the Principal no mail");
    } finally { await rig.close(); }
  });
});
