import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { registerHashlineTools } from "@oma/tool-hashline";
import { containWorkspaceTools } from "@oma/tool-runtime/contained-tools";
import { resultReadSurface } from "@oma/tool-runtime/result-read";
import { resultRootFor } from "@oma/tool-runtime/contained-search";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { Store } from "@oma/storage";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { CollaborationMailViews } from "#oma-test/app/views/collaboration-mail";
import { messageIdForOperation } from "@oma/domain/derived";
import { storedMailBytes } from "@oma/domain/mail-values";
import { principalEnvironment } from "@oma/engine/principal-session";
import { planPiSpawn } from "@oma/engine/pi-spawn-plan";
import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
import { residentOptions } from "./fixtures/resident.js";
import { makeValidAgent } from "./fixtures/spec.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import type { AuthContext } from "@oma/contracts";

const auth: AuthContext = { actor: "alice", incarnation: 1, channel: "actor", role: "resident", capabilities: new Set(["mail.send"]),
  peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
type Tool = { description?: string; execute(id: string, input: object, signal: undefined, update: undefined, context: unknown): Promise<{ content: { text?: string }[]; details?: { result?: { complete: boolean; read: object } } }> };
async function reader(root: string, records: string) {
  const workspace = join(root, "workspace"), sessions = join(root, "sessions");
  mkdirSync(workspace); mkdirSync(sessions);
  const sessionManager = SessionManager.create(workspace, sessions), context = { cwd: workspace, sessionManager, ui: { setStatus() {} } };
  const tools = new Map<string, Tool>(), hooks = new Map<string, ((event: object, context: unknown) => unknown)[]>();
  const pi = { registerTool: (tool: { name: string }) => tools.set(tool.name, tool as unknown as Tool),
    on: (name: string, hook: (event: object, context: unknown) => unknown) => hooks.set(name, [...(hooks.get(name) ?? []), hook]) };
  containWorkspaceTools(pi as never, workspace, false, true, [records]);
  await registerHashlineTools(resultReadSurface(pi as never, resultRootFor(workspace)),
    { workspace, readableRoots: [records], sandboxed: false, readOnly: true, stateDir: join(root, "hashline"),
      write: async () => assert.fail("Principal read cannot mutate") });
  for (const hook of hooks.get("session_start") ?? []) await hook({ type: "session_start" }, context);
  const execute = (name: string, input: object) => tools.get(name)!.execute("read-mail", input, undefined, undefined, context);
  assert.equal(tools.has("bash"), false);
  assert.match(tools.get("read")!.description!, /grep.*oma-result/);
  return { read: async (path: string, offset = 1, limit = 2000) => {
    const result = await execute("read", { path, offset, limit });
    return result.content.map(part => part.text ?? "").join("\n");
  }, completeLongLine: async (path: string) => {
    const result = await execute("grep", { path, pattern: "." });
    assert.equal(result.details?.result?.complete, true, "the original contained walker must complete");
    let next: object | null = result.details!.result!.read;
    const chunks: Buffer[] = [];
    let digest = "";
    while (next !== null) {
      const page = JSON.parse((await execute("read", next)).content[0]!.text!);
      chunks.push(Buffer.from(page.dataBase64, "base64"));
      digest ||= page.sha256; assert.equal(page.sha256, digest);
      next = page.next === null ? null : { path: page.reference, byteOffset: page.next, byteLimit: 65536 };
    }
    const complete = Buffer.concat(chunks);
    assert.equal(createHash("sha256").update(complete).digest("hex"), digest);
    return complete.toString("utf8");
  }, close: async () => { for (const hook of hooks.get("session_shutdown") ?? []) await hook({ type: "session_shutdown" }, context); } };
}

for (const bodyBytes of [16 * 1024, 256 * 1024]) {
  test(`001. Current mail reader: ${bodyBytes}-byte permitted bodies remain fully reachable through the published anchored read path`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-current-mail-bound-")), store = new Store(join(root, "runtime.sqlite"));
    let read: Awaited<ReturnType<typeof reader>> | undefined;
    try {
      const principal = principalEnvironment({ stateRoot: root, runRoot: join(root, "run"), libdir: process.cwd() },
        { society: "demo", provider: "pi", model: "current", extensions: [] },
        { frameBytes: 262144, mailBodyBytes: bodyBytes, batchMaxMessages: 4, addresses: 64, contextBytes: 1 << 20, bundleBytes: 1 << 20 });
      assert.equal(Number(principal.OMA_MAIL_BYTES), storedMailBytes(bodyBytes));
      const options = residentOptions(root);
      const plan = planPiSpawn(residentEngineEffects.sandbox, { ...options, limits: { ...options.limits, mailBodyBytes: bodyBytes } });
      assert.equal(Number(plan.env.OMA_MAIL_BYTES ?? plan.args[plan.args.indexOf("OMA_MAIL_BYTES") + 1]), storedMailBytes(bodyBytes));
      store.transaction(tx => { tx.insertAgent(makeValidAgent("alice")); tx.insertAgent(makeValidAgent("principal")); });
      const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64, 24, TEST_VIEW_LIMITS);
      const views = new CollaborationMailViews(store, mail, root, "demo"), records = views.rootFor("principal");
      const bodies = { equals: `a${"=".repeat(bodyBytes - 1)}`, korean: "가a".repeat(bodyBytes / 4),
        emoji: "😀abc".repeat(Math.floor(bodyBytes / 7)), lines: "a\n".repeat(bodyBytes / 2) };
      read = await reader(root, records);
      for (const [key, body] of Object.entries(bodies)) {
        assert.ok(Buffer.byteLength(body) <= bodyBytes);
        await mail.send(auth, key, { to: ["principal"], subject: key, kind: "message", body });
        const operation = store.getOperation("alice", key)!, id = messageIdForOperation(operation.id, 0);
        const archive = join(root, "mail/archive/cur", `${id}:2,`), original = readFileSync(archive), delivery = store.getDelivery(id, "principal");
        const published = views.publishRecords("principal", [id]);
        assert.equal(published.length, 1);
        const path = join(records, "mail/messages", `${id}.md`);
        assert.equal(readFileSync(path, "utf8"), body);
        const expected = body.split("\n"); if (body.endsWith("\n")) expected.pop();
        const observed: string[] = [];
        for (let offset = 1; offset <= expected.length; offset += 2000) {
          const page = await read.read(path, offset, 2000);
          if (page.includes("content not shown")) {
            assert.equal(expected.length, 1, "the stress body is one independently known long line");
            const complete: string = await read.completeLongLine(path), prefix = `${basename(path)}:1: `;
            assert.equal(complete, `${prefix}${body}\n`);
            observed.push(complete.slice(prefix.length, -1));
          } else {
            assert.doesNotMatch(page, /truncated|E_FILE_TOO_LARGE/i, `${key}: ${page.slice(-500)}`);
            observed.push(...page.split("\n").filter(line => /^[A-Za-z]{4}│/.test(line)).map(line => line.slice(5)));
          }
        }
        assert.deepEqual(observed, expected, `${key}: no body prefix, missing rows or silent truncation`);
        for (const forbidden of [archive, `/mail/archive/cur/${id}:2,`, `${id}:2,`, id]) {
          await assert.rejects(() => read!.read(forbidden));
        }
        assert.deepEqual(readFileSync(archive), original);
        assert.deepEqual(store.getDelivery(id, "principal"), delivery);
        assert.deepEqual(store.getOperation("alice", key), operation);
      }
    } finally { await read?.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
  });
}
