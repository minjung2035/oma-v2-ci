/** DR27 / P0-4: each client observation owns its own budget. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Client, ClientError } from "@oma/client";
import { installRuntime } from "@oma/client/runtime";
import { CLIENT_RUNTIME, installClientRuntime } from "#oma-test/app/runtime/client-runtime";

const operation = "op-00000000-0000-4000-8000-000000000001";

test("001. Each in-process observation owns its budget, not the whole tool", async t => {
  const root = mkdtempSync(join(process.cwd(), ".client-lifetime-"));
  const timers: number[] = [];
  const original = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn: (...args: unknown[]) => void, ms: number, ...args: unknown[]) => {
    timers.push(ms); return original(fn, ms, ...args);
  });
  installRuntime({ ...CLIENT_RUNTIME, channel: () => ({ connect: async () => {}, close() {},
    call: async () => ({ ok: true, result: { operation, state: "pending" } }) }) });
  try {
    const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket") } });
    assert.deepEqual(JSON.parse(await client.sendMail({ to: ["b"], subject: "s", body: "b", kind: "message" }, "one")), {
      request: "one", receipt: { operation, state: "pending" },
    });
    assert.equal(timers.length, 1);
    assert.ok(timers[0]! > 0 && timers[0]! <= CLIENT_RUNTIME.observationSeconds * 1000);
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

test("002. Abort releases the socket, preserves the freeze, and reports same-key unknown", async () => {
  const root = mkdtempSync(join(process.cwd(), ".client-abort-"));
  const controller = new AbortController();
  let opened!: () => void;
  const started = new Promise<void>(resolve => { opened = resolve; });
  let closed = 0;
  installRuntime({ ...CLIENT_RUNTIME, channel: () => {
    let rejectCall: ((error: unknown) => void) | undefined;
    return { connect: async () => {}, call: () => new Promise((_, reject) => { rejectCall = reject; opened(); }),
      close(error) { closed++; rejectCall?.(error ?? new Error("closed")); } };
  } });
  try {
    const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket") } });
    const done = client.sendMail({ to: ["b"], subject: "s", body: "b", kind: "message" }, "cancelled", controller.signal);
    await started; controller.abort();
    await assert.rejects(() => done, error => error instanceof ClientError && error.request === "cancelled" && error.exitCode === 3);
    assert.ok(closed > 0);
    assert.equal(CLIENT_RUNTIME.cache(root, 512 * 1024).read("cancelled").kind, "present");
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});

test("003. An already aborted call neither builds nor opens a socket", async () => {
  let calls = 0;
  installRuntime({ ...CLIENT_RUNTIME, channel: () => { calls++; throw new Error("unexpected dial"); } });
  try {
    const client = new Client({ cwd: process.cwd(), env: {} });
    await assert.rejects(() => client.query("agent.wait", { observe: true }, AbortSignal.abort()),
      error => error instanceof ClientError && error.exitCode === 3 && error.code === "BROKER_UNAVAILABLE");
    assert.equal(calls, 0);
  } finally { installClientRuntime(); }
});

for (const state of ["pending", "unknown", "failed", "succeeded"] as const) test(`004. Cli process lifetime: ${state} is not inferred from process exit`, async () => {
  const root = mkdtempSync(join(process.cwd(), ".client-outcome-"));
  const receipt = state === "failed" ? { operation, state, error: { code: "CHECK_FAILED" as const, message: "check", retry: "never" as const } }
    : state === "succeeded" ? { operation, state, result: { kind: "route.follow" as const, topic: "commons", subscribed: true } }
      : { operation, state };
  installRuntime({ ...CLIENT_RUNTIME, channel: () => ({ connect: async () => {}, close() {}, call: async () => ({ ok: true, result: receipt }) }) });
  try {
    const client = new Client({ cwd: root, env: { HOME: root, OMA_SOCKET: join(root, "socket") } });
    const done = () => client.effect("route.follow", "k", () => ({ method: "route.follow", params: { topic: "commons" } }), () => ({ topic: "commons" }));
    if (state === "pending" || state === "succeeded") assert.deepEqual(JSON.parse(await done()), { request: "k", receipt });
    else await assert.rejects(done, error => {
      assert.ok(error instanceof ClientError);
      assert.equal(error.request, "k");
      assert.equal(error.exitCode, state === "unknown" ? 3 : 2);
      assert.deepEqual(error.receipt, receipt);
      return true;
    });
  } finally { installClientRuntime(); rmSync(root, { recursive: true, force: true }); }
});
