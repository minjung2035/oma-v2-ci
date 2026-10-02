import test from "node:test";
import assert from "node:assert/strict";
import type {
  AuthContext,
  ProtocolLimits,
} from "../implementation/contracts.js";
import { PublicDispatcher } from "../src/broker/public-dispatcher.js";
import { errorAnswer } from "../src/broker/replies.js";
import { publicFailure } from "../src/domain/errors.js";
import { boundedLogOutput } from "../src/broker/logs.js";
import {
  boundedLogResponse,
  MIN_LOG_FRAME_BYTES,
} from "../src/protocol/log-response.js";
import { ConnectionDecoder, encodeFrame } from "../src/frame.js";
import { decodeRpcReply } from "../src/protocol/response-codec.js";
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
  peer: { pid: process.pid, uid: 1000, gid: 1000, cgroup: null },
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
    units: { statusSnapshot: unused },
    views: { status: unused },
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
    admitResource: () => () => undefined,
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
