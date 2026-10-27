import test from "node:test";
import assert from "node:assert/strict";
import type {
  AuthContext,
  ProtocolLimits,
} from "@oma/contracts";
import { PublicDispatcher } from "@oma/broker/public-dispatcher";
import { errorAnswer } from "@oma/broker/replies";
import { publicFailure } from "@oma/domain/errors";
import { boundedLogOutput } from "@oma/broker/logs";
import {
  boundedLogResponse,
  MIN_LOG_FRAME_BYTES,
} from "@oma/protocol/log-response";
import { ConnectionDecoder, encodeFrame } from "@oma/protocol/frame";
import { decodeRpcReply } from "@oma/protocol/response-codec";
import { makeValidAgent } from "./fixtures/spec.js";

const limits: ProtocolLimits = {
  frameBytes: 256 * 1024,
  mailBodyBytes: 256 * 1024,
  subjectBytes: 512,
  addresses: 64,
  replyReferences: 64,
  contextFiles: 256,
  contextBytes: 8388608,
  bundleBytes: 268435456,
  logBytes: 1024 * 1024,
  batchMaxMessages: 24,
  idleStreamSeconds: 60,
  receiptWaitSeconds: 60,
};
const auth: AuthContext = {
  actor: "alice",
  incarnation: 1,
  role: "resident",
  channel: "actor",
  capabilities: new Set(),
  peer: { pid: process.pid, uid: 1000, gid: 1000 },
};
function dispatcher(text: string, frameBytes: number) {
  const unused = (): never => {
    throw new Error("unexpected non-log effect");
  };
  return new PublicDispatcher({ waitRun: () => { throw new Error("no live run in this fixture"); },
    store: {
      listAgents: () => [{ name: "alice" }],
      getAgent: actor => actor === "alice" ? makeValidAgent("alice") : null,
      getReceipt: unused,
      hasOperation: unused,
    },
    mail: { send: async () => unused() },
    units: { statusSnapshot: async () => ({ observedAtMs: 1, units: new Map(), failure: null }) },
    views: { status: async () => [] },
    review: null,
git: null,
    lifecycle: {
      create: async () => unused(),
      start: unused,
      stop: unused,
      ack: unused,
      follow: unused,
    },
    limits: { ...limits, frameBytes },
    isDraining: () => false,
    assertAdmission() {},

    refreshViews() {},
    failureAnswer: (id, error) => errorAnswer(id, publicFailure(error)),
    readLogs: async () => ({
      ...boundedLogOutput(Buffer.from(text), limits.logBytes),
      observedAtMs: Number.MAX_SAFE_INTEGER,
    }),
  });
}

for (const [name, source, frameBytes, id] of [
  [
    "default 1 MiB log / 256 KiB frame",
    "L".repeat(1024 * 1024),
    limits.frameBytes,
    "logs-default",
  ],
  [
    "JSON escapes and custom smaller frame",
    '\n"\\\u0000\t'.repeat(1024),
    256,
    "logs-small",
  ],
  [
    "UTF-8, surrogate pairs and escaped request ID",
    "한😀é".repeat(1024),
    512,
    'id"\\한😀'.repeat(12),
  ],
] as const) {
  test(`F3: ${name} remains a decodable bounded success`, async () => {
    const params = { agent: "alice", sinceSeconds: 60 };
    const response = await dispatcher(source, frameBytes).dispatch(
      auth,
      { v: 1, id, method: "logs.read", params },
      null,
    );
    const frame = encodeFrame(response);
    assert.ok(
      frame.length - 4 <= frameBytes,
      "budget includes envelope, metadata, ID and JSON escaping",
    );
    assert.equal(frame.readUInt32BE(), frame.length - 4);
    const events = new ConnectionDecoder(frameBytes).push(frame);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.kind, "frame");
    if (events[0]?.kind !== "frame")
      throw new Error("expected one complete JSON frame");
    const decoded = decodeRpcReply(
      "logs.read",
      events[0].frame.raw,
      id,
      params,
    );
    assert.equal(decoded.ok, true);
    if (!decoded.ok) throw new Error("expected logs success");
    assert.equal(decoded.result.truncated, true);
    assert.equal(decoded.result.observedAtMs, Number.MAX_SAFE_INTEGER);
    assert.ok(decoded.result.text.length > 0);
    assert.ok(
      source.startsWith(decoded.result.text),
      "truncation preserves a Unicode-safe prefix",
    );
  });
}

test("F3: minimal and complete responses retain truthful truncation metadata", () => {
  const view = {
    text: "",
    truncated: false,
    observedAtMs: Number.MAX_SAFE_INTEGER,
  };
  assert.equal(
    encodeFrame(boundedLogResponse("", view, MIN_LOG_FRAME_BYTES)).length - 4,
    MIN_LOG_FRAME_BYTES,
  );
  assert.throws(() => boundedLogResponse("", view, MIN_LOG_FRAME_BYTES - 1), {
    code: "UNSUPPORTED_PROFILE",
  });
  assert.throws(() => boundedLogResponse("x".repeat(512), view, 256), {
    code: "INVALID_REQUEST",
  });
  for (const truncated of [false, true]) {
    const short = { ...view, text: 'short 한😀\n"\\', truncated };
    assert.deepEqual(boundedLogResponse("short", short, 512).result, short);
  }
});

test("F3: raw journal byte truncation never manufactures a partial UTF-8 character", () => {
  const bytes = Buffer.from("A😀Z");
  for (const max of [1, 2, 3, 4])
    assert.deepEqual(boundedLogOutput(bytes, max), {
      text: "A",
      truncated: true,
    });
  assert.deepEqual(boundedLogOutput(bytes, 5), {
    text: "A😀",
    truncated: true,
  });
  assert.deepEqual(boundedLogOutput(bytes.subarray(0, 4), 4, true), {
    text: "A",
    truncated: true,
  });
  assert.deepEqual(boundedLogOutput(bytes, 6), {
    text: "A😀Z",
    truncated: false,
  });
});


test("DR27: nonexistent log target is refused instead of reported as an empty journal", async () => {
  const response = await dispatcher("", limits.frameBytes).dispatch(auth,
    { v: 1, id: "missing", method: "logs.read", params: { agent: "missing", sinceSeconds: 60 } }, null);
  const decoded = decodeRpcReply("logs.read", response, "missing", { agent: "missing", sinceSeconds: 60 });
  assert.equal(decoded.ok, false);
  if (!decoded.ok) assert.equal(decoded.error.code, "ADDRESS_NOT_FOUND");
});

test("NB-20: status.get names an address like logs.read does", async () => {
  const missing = await dispatcher("", limits.frameBytes).dispatch(auth,
    { v: 1, id: "s-missing", method: "status.get", params: { agent: "missing" } }, null);
  const decodedMissing = decodeRpcReply("status.get", missing, "s-missing", { agent: "missing" });
  assert.equal(decodedMissing.ok, false);
  if (!decodedMissing.ok) assert.equal(decodedMissing.error.code, "ADDRESS_NOT_FOUND");
  // A known agent answers, and an absent one is refused before any snapshot work.
  const present = await dispatcher("", limits.frameBytes).dispatch(auth,
    { v: 1, id: "s-present", method: "status.get", params: { agent: "alice" } }, null);
  const decodedPresent = decodeRpcReply("status.get", present, "s-present", { agent: "alice" });
  assert.equal(decodedPresent.ok, true);
});

test("NB-03: a text over budget by one byte is a strict prefix, never whole text called truncated", () => {
  const view = { text: "L".repeat(128), truncated: false, observedAtMs: 7 };
  const sizeOf = (result: unknown) => Buffer.byteLength(JSON.stringify({ v: 1, id: "b", ok: true, result }));
  const whole = boundedLogResponse("b", view, limits.frameBytes);
  assert.equal(whole.result.truncated, false);
  // frameBytes exactly one below the untruncated envelope: the truncating
  // envelope would carry the whole text, but must not claim a cut that did
  // not happen.
  const budget = sizeOf(whole.result) - 1;
  const cut = boundedLogResponse("b", view, budget);
  assert.equal(cut.result.truncated, true);
  assert.ok(cut.result.text.length < view.text.length, "the delivered text is a real prefix");
  assert.ok(view.text.startsWith(cut.result.text));
  assert.ok(sizeOf(cut.result) <= budget);
  // A view already truncated upstream may answer whole at the same budget:
  // its truncating envelope is the full one, so the flag stays honest either
  // way. One byte below it, a strict prefix is what the wire carries.
  const upstream = { ...view, truncated: true };
  const wholeAgain = boundedLogResponse("b", upstream, budget);
  assert.equal(wholeAgain.result.truncated, true);
  assert.equal(wholeAgain.result.text, view.text);
  assert.ok(sizeOf(wholeAgain.result) <= budget);
  const tighter = boundedLogResponse("b", upstream, budget - 1);
  assert.equal(tighter.result.truncated, true);
  assert.ok(tighter.result.text.length < view.text.length);
  assert.ok(view.text.startsWith(tighter.result.text));
  assert.ok(sizeOf(tighter.result) <= budget - 1);
});
