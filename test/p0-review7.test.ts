/** The seventh review (adversarial, 2026-09-28): the core's findings, each
 * held by what the product now does. Platform findings are in
 * platform-stream-publication, platform-host-service and platform-snapshot. */
import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestKeyOf } from "../src/extension/shared.js";
import { publishNoReplace } from "../src/storage/durable-fs.js";
import { replaceDerivedSymlink } from "../src/storage/staged-tree.js";
import { lockFileDescriptor } from "../src/leaf.js";
import { RequestCache, readCacheFile, type CacheReader } from "../src/request-cache.js";

const UUID = "0123abcd-0000-4000-8000-00000000beef";

test("P0V-111 / G01-01: a publication collects every dead locked temporary in its directory, whatever name it was for", t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-collect-"));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  // A receipt whose publication was killed and that is never published again.
  writeFileSync(join(dir, `.gone.json.${UUID}.held.tmp`), "half");
  // A live writer of another name, holding its lock.
  const live = `.busy.json.${UUID.replace("beef", "cafe")}.held.tmp`;
  writeFileSync(join(dir, live), "writing");
  const held = openSync(join(dir, live), "r");
  t.after(() => { closeSync(held); });
  assert.equal(lockFileDescriptor(held).kind, "held");
  // A configuration's temporary, written without a lock.
  writeFileSync(join(dir, `.config.json.${UUID}.tmp`), "unlocked");
  assert.equal(publishNoReplace(join(dir, "other.json"), "x"), "created");
  assert.deepEqual(readdirSync(dir).sort(), [live, `.config.json.${UUID}.tmp`, "other.json"].sort());
});

test("P0V-111 / G01r2-02: a derived link's publication removes what a killed one of the same link left", t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-link-"));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  symlinkSync("revisions/a", join(dir, `.current.${UUID}.tmp`));
  symlinkSync("revisions/b", join(dir, `.other.${UUID}.tmp`));
  writeFileSync(join(dir, `.current.${UUID.replace("beef", "f00d")}.tmp`), "a file is not this writer's link");
  replaceDerivedSymlink(join(dir, "current"), "revisions/c");
  assert.deepEqual(readdirSync(dir).sort(), [`.current.${UUID.replace("beef", "f00d")}.tmp`, `.other.${UUID}.tmp`, "current"].sort());
});

/** A session branch as the engine keeps it: an assistant message with its
 * tool calls, and a tool result for each call that got one. */
function session(entries: readonly { call: string; tool: string; args: Record<string, unknown>; answered: boolean }[]) {
  const branch = entries.flatMap(entry => [
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: entry.call, name: entry.tool, arguments: entry.args }] } },
    ...(entry.answered ? [{ type: "message", message: { role: "toolResult", toolCallId: entry.call, toolName: entry.tool, content: [] } }] : []),
  ]);
  return { sessionManager: { getSessionId: () => "session-1", getBranch: () => branch } };
}

test("P0V-110 / F-07: a call repeated after its result was lost has the key of the first; after a result the model saw, a new one", () => {
  const args = { to: ["bob"], subject: "hi", body: "the same letter" };
  const send = (id: string, context: ReturnType<typeof session>) => requestKeyOf(undefined, { id, tool: "oma_mail_send", params: args, context });
  // The first call; the engine died before its result was recorded.
  const first = send("call-1", session([{ call: "call-1", tool: "oma_mail_send", args, answered: false }]));
  // The engine answered it with "No result provided" (not kept in the session); the model calls again.
  const again = send("call-2", session([
    { call: "call-1", tool: "oma_mail_send", args, answered: false },
    { call: "call-2", tool: "oma_mail_send", args, answered: false },
  ]));
  assert.equal(again, first, "the repeated call is the same request, which the broker answers once");
  // The model saw the first result and sends the same letter again: a new request.
  const later = send("call-3", session([
    { call: "call-1", tool: "oma_mail_send", args, answered: true },
    { call: "call-3", tool: "oma_mail_send", args, answered: false },
  ]));
  assert.notEqual(later, first);
  // Other arguments, another tool: other requests.
  assert.notEqual(requestKeyOf(undefined, { id: "call-4", tool: "oma_mail_send", params: { ...args, body: "another" }, context: session([]) }), first);
  assert.notEqual(requestKeyOf(undefined, { id: "call-5", tool: "oma_mail_ack", params: args, context: session([]) }), first);
  // The model's own key is the key; an invalid one is refused.
  assert.equal(requestKeyOf("mine-1", { id: "x", tool: "oma_mail_send", params: args, context: session([]) }), "mine-1");
  assert.throws(() => requestKeyOf("bad key", { id: "x", tool: "oma_mail_send", params: args }));
  // Without the engine's session, the call's own id stands in for it.
  assert.notEqual(requestKeyOf(undefined, { id: "a", tool: "oma_mail_send", params: args }), requestKeyOf(undefined, { id: "b", tool: "oma_mail_send", params: args }));
  assert.match(first, /^pi-[0-9a-f]{40}$/);
});

test("P0V-112 / G02-ledger-r2-02: request metadata larger than a request and its receipt can be is not read, and is not taken for absent", t => {
  const home = mkdtempSync(join(tmpdir(), "oma-cache-bound-"));
  t.after(() => { rmSync(home, { recursive: true, force: true }); });
  const dir = join(home, ".local", "state", "oma", "requests");
  mkdirSync(dir, { recursive: true });
  let reads = 0;
  const reader: CacheReader = (path, expected, maximum) => { reads += 1; return readCacheFile(path, expected, maximum); };
  writeFileSync(join(dir, "k1.json"), `{"key":"k1","pad":"${"x".repeat(4096)}"}`);
  const observed = new RequestCache(home, reader, 1024).read("k1");
  assert.equal(observed.kind, "corrupt");
  assert.match(observed.kind === "corrupt" ? observed.reason : "", /larger than a request and its receipt/);
  assert.equal(reads, 1);
  assert.equal(new RequestCache(home).read("k1").kind, "corrupt", "under the reference bound it is read, and still not a request this cache wrote");
});
