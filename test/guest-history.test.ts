/** Saved guest identities over real files/SDK metadata; no systemd or VM. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { GuestHistories } from "#oma-test/app/platform/guest/histories";
import { GuestHost } from "#oma-test/app/platform/guest/host";
import { publishProjectBinding } from "#oma-test/app/runtime/provision";
import { newSessionBirth, publishSessionBirth } from "#oma-test/app/runtime/session-mode";
import { modelWorkspacePathAt } from "@oma/domain/paths";
import { checkedGuestHistory, guestHistoryReference, parseGuestHistoryReference } from "@oma/protocol/guest-history";
import { PLATFORM_FRAME_BYTES } from "@oma/protocol/host-guest";

function world(t: import("node:test").TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "oma-guest-history-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const societies = join(dir, "societies"), projects = join(dir, "projects"), projectId = randomUUID(), society = "demo";
  const root = join(societies, society), cwd = join(projects, projectId);
  mkdirSync(root, { recursive: true }); mkdirSync(cwd, { recursive: true });
  publishProjectBinding(root, { society, canonicalProjectPath: cwd });
  const birth = publishSessionBirth(root, newSessionBirth(root, "society", cwd));
  mkdirSync(birth.history, { recursive: true });
  const histories = new GuestHistories(societies, projects);
  const save = (index: number, firstMessage = "Saved Human request") => {
    const id = randomUUID(), file = `history-${String(index).padStart(4, "0")}.jsonl`, timestamp = "2026-10-02T00:00:00.000Z";
    const header = { type: "session", version: CURRENT_SESSION_VERSION, id, timestamp, cwd: modelWorkspacePathAt(root, "principal") };
    writeFileSync(join(birth.history, file), JSON.stringify(header) + "\n" + JSON.stringify({ type: "message", id: "entry", parentId: null,
      timestamp, message: { role: "user", content: [{ type: "text", text: firstMessage }], timestamp: Date.parse(timestamp) } }) + "\n", { mode: 0o600 });
    return checkedGuestHistory({ projectId, society, file, sessionId: id });
  };
  return { dir, societies, projects, projectId, society, root, cwd, birth, histories, save };
}

test("DR29/MODE-005: guest reference is canonical identity and contains no host or guest path", t => {
  const w = world(t), identity = w.save(1), reference = guestHistoryReference(identity);
  assert.deepEqual(parseGuestHistoryReference(reference), identity);
  for (const value of ["/host/history.jsonl", reference + "=", "oma-guest-history:garbage"])
    assert.throws(() => parseGuestHistoryReference(value), { code: "INVALID_REQUEST" });
  for (const fields of [{ file: "../outside.jsonl" }, { file: "/outside.jsonl" }, { projectId: "guest-path" }, { society: "../other" },
    { sessionId: "" }, { cwd: "/host" }])
    assert.throws(() => checkedGuestHistory({ ...identity, ...fields }), { code: "INVALID_REQUEST" });
});

test("DR29/MODE-005: inspection preserves exact saved mode/header and rejects replaced or rebound identity", async t => {
  const w = world(t), identity = w.save(1), path = join(w.birth.history, identity.file), before = readFileSync(path);
  assert.deepEqual(await w.histories.inspect(identity), { file: path, mode: "society", sessionId: identity.sessionId });
  assert.deepEqual(readFileSync(path), before);
  await assert.rejects(w.histories.inspect({ ...identity, sessionId: randomUUID() }), { code: "INVALID_REQUEST" });
  await assert.rejects(w.histories.inspect({ ...identity, projectId: randomUUID() }), { code: "INVALID_REQUEST" });
  writeFileSync(path, "");
  await assert.rejects(w.histories.inspect(identity), { code: "STORE_CORRUPT" });
  await assert.rejects(w.histories.list(w.projectId, w.society), { code: "BROKER_UNAVAILABLE" });
  rmSync(path);
  await assert.rejects(w.histories.inspect(identity), { code: "INVALID_REQUEST" });
});

test("DR29/MODE-005: catalog pages keep exact identity and preview/count without transporting conversation paths", async t => {
  const w = world(t), expected = new Set<string>();
  for (let index = 0; index < 500; index++) expected.add(w.save(index, "가".repeat(160)).file);
  const seen = new Set<string>();
  let after: string | undefined, pages = 0;
  do {
    const result = await w.histories.list(w.projectId, w.society, after);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < PLATFORM_FRAME_BYTES);
    const entries = result.sessions as { identity: { file: string }; firstMessage: string; messageCount: number }[];
    for (const entry of entries) {
      assert.equal(seen.has(entry.identity.file), false); seen.add(entry.identity.file);
      assert.equal(entry.messageCount, 1); assert.equal(entry.firstMessage, "가".repeat(160));
      assert.equal(Object.hasOwn(entry, "path"), false); assert.equal(Object.hasOwn(entry, "allMessagesText"), false);
    }
    pages++; after = result.after === null ? undefined : result.after as string;
  } while (after !== undefined);
  assert.ok(pages > 1); assert.deepEqual(seen, expected);
  await assert.rejects(w.histories.list(w.projectId, w.society, "../escape"), { code: "INVALID_REQUEST" });
});

test("DR29/MODE-005: resume observes identity before launch and refuses an already open writer", async t => {
  const w = world(t), identity = w.save(1), launched: unknown[][] = [];
  const git = (...args: string[]) => assert.equal(spawnSync("/usr/bin/git", ["-C", w.cwd, ...args]).status, 0);
  git("init", "-q"); writeFileSync(join(w.cwd, "a"), "a"); git("add", "a");
  git("-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-qm", "a");
  const socket = join(w.dir, "holder.sock");
  const host = new GuestHost({ societiesDir: w.societies, projectsDir: w.projects, stopDeadlineMs: 1000,
    launcher: { socketPath: () => socket, start: async (...args) => { launched.push(args); }, stop: async () => "unknown" } });
  await assert.rejects(host.resume({ ...identity, sessionId: "replaced" }), { code: "INVALID_REQUEST" });
  assert.equal(launched.length, 0);
  assert.deepEqual(await host.resume(identity), { state: "running" });
  assert.deepEqual(launched, [[w.society, w.cwd, join(w.birth.history, identity.file)]]);
  const server = createServer(socket => { socket.end(); });
  await new Promise<void>(resolve => { server.listen(socket, resolve); });
  try { await assert.rejects(host.resume(identity), { code: "ATTACH_CONFLICT" }); }
  finally { await new Promise<void>(resolve => { server.close(() => resolve()); }); }
  assert.equal(launched.length, 1);
});
