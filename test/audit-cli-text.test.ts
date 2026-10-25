import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MailInput } from "@oma/contracts";
import { Store } from "@oma/storage";
import { RequestCache } from "#oma-test/app/request-cache";
import { decodeSubject, parseEmlHeaders } from "@oma/mail/headers";
import { gitAuth, gitFixture } from "./fixtures/git-crash.js";
import { makeValidAgent } from "./fixtures/spec.js";
import { runCliWithPeer } from "./fixtures/cli-peer.js";
import { runCliWithLookup } from "./fixtures/cli-lookup.js";

const body = "\ufeff  first\r\nsecond\rthird\n \r\n";
const normalized = "\ufeff  first\nsecond\rthird\n \n";

test("CLI text: UTF-8 subject decoding preserves encoded whitespace and decodes only once", () => {
  assert.equal(decodeSubject("\nplain title"), "plain title");
  assert.equal(decodeSubject("=?UTF-8?Q?caf=C3=A9_=3F?="), "café ?");
  assert.equal(
    decodeSubject("=?UTF-8?B?ICBoZWxsbw==?=\n=?UTF-8?Q?_world__?="),
    "  hello world  ",
  );
  const literal = "=?UTF-8?B?aGVsbG8=?=";
  assert.equal(
    decodeSubject(`=?UTF-8?B?${Buffer.from(literal).toString("base64")}?=`),
    literal,
  );
  assert.equal(decodeSubject(null), "");
  for (const malformed of [
    "=?ISO-8859-1?Q?caf=E9?=",
    "=?UTF-8?Q?=GG?=",
    "=?UTF-8?B?////?=",
    "=?UTF-8?B?YQ?=",
  ])
    assert.throws(() => decodeSubject(malformed), { code: "INVALID_REQUEST" });
});

for (const [subject, explicit] of [
  ["plain title", null],
  ["Mostly ASCII subject with café", null],
  ["한글 😀 제목", null],
  ["a".repeat(1200), null],
  ["=?UTF-8?B?aGVsbG8=?= " + "a".repeat(1200), null],
  ["original title", "  explicit subject  "],
] as const) {
  test(`CLI text: reply uses ${explicit === null ? `original ${subject.length}-character subject` : "explicit subject"} and frozen LF body`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-cli-text-"));
    const home = join(root, "home");
    mkdirSync(home);
    const store = new Store(join(root, "runtime.sqlite"));
    try {
      store.transaction((tx) => {
        tx.insertAgent(makeValidAgent("a"));
        tx.insertAgent(makeValidAgent("b"));
      });
      const { mail } = gitFixture(root, store);
      await mail.send({ ...gitAuth, actor: "b" }, "original", {
        to: ["a"],
        subject,
        kind: "message",
        body: "original body",
      });
      const original = store.getOperation("b", "original")!;
      if (original.kind !== "mail.send")
        throw new Error("wrong fixture operation");
      const replyPath = join(home, "original.eml");
      const bodyPath = join(home, "body.txt");
      writeFileSync(
        replyPath,
        readFileSync(mail.objectPath(original.plan.message.id)),
      );
      writeFileSync(bodyPath, body);
      const key = "reply";
      const expected = explicit ?? `Re: ${subject}`;
      const args = [
        "send",
        "--reply",
        replyPath,
        "--file",
        bodyPath,
        "--request",
        key,
        ...(explicit === null ? [] : ["--subject", explicit]),
      ];
      const run = await runCliWithPeer(home, root, args, async (request) => {
        assert.equal(request.method, "mail.send");
        const params = request.params as MailInput;
        assert.equal(params.subject, expected);
        assert.equal(params.body, normalized);
        assert.equal(params.replyToMessage, original.plan.message.id);
        const result = await mail.send(gitAuth, key, params);
        return { v: 1, id: request.id, ok: true, result };
      });
      assert.equal(run.signal, null);
      assert.equal(run.status, 0, run.stderr);
      const sent = store.getOperation("a", key)!;
      if (sent.kind !== "mail.send") throw new Error("wrong fixture operation");
      const raw = readFileSync(mail.objectPath(sent.plan.message.id));
      // MAIL-003/P0-2: the MIME subject preserves the same explicit bytes as
      // the frozen CLI request, including outer whitespace.
      assert.equal(
        decodeSubject(
          parseEmlHeaders(raw, { maxHeaderBytes: raw.byteLength }).subject,
        ),
        expected,
      );
      const cached = new RequestCache(home).read(key);
      assert.equal(cached.kind, "present");
      if (cached.kind !== "present") throw new Error("missing frozen request");
      rmSync(replyPath);
      rmSync(bodyPath);
      const retry = await runCliWithLookup(
        home,
        root,
        args,
        key,
        cached.value.lastReceipt!,
      );
      assert.equal(retry.status, 0, retry.stderr);
      assert.equal(retry.requests.length, 1);
      assert.deepEqual(new RequestCache(home).read(key), cached);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("CLI text: agent brief is normalized before freezing and never reread on retry", async () => {
  const home = mkdtempSync(join(tmpdir(), "oma-cli-brief-"));
  try {
    const path = join(home, "brief.txt");
    writeFileSync(path, body);
    const key = "brief";
    const args = [
      "agent",
      "create",
      "worker",
      "--from",
      "a".repeat(40),
      "--file",
      path,
      "--request",
      key,
    ];
    const handle = async (request: Record<string, unknown>) => {
      if (request.method === "operation.get")
        return {
          v: 1,
          id: request.id,
          ok: false,
          error: {
            code: "REQUEST_NOT_FOUND",
            message: "controlled absent receipt",
            retry: "same-key",
          },
        };
      assert.equal(request.method, "agent.create");
      assert.equal((request.params as { brief: string }).brief, normalized);
      return {
        v: 1,
        id: request.id,
        ok: false,
        error: {
          code: "BROKER_UNAVAILABLE",
          message: "controlled rejection; no user-manager call",
          retry: "same-key",
        },
      };
    };
    const first = await runCliWithPeer(home, home, args, handle);
    assert.equal(first.signal, null);
    assert.equal(first.status, 3, first.stderr);
    assert.match(first.stderr, /Acceptance status unknown: brief/);
    assert.deepEqual(
      first.requests.map((request) => request.method),
      ["agent.create", "operation.get"],
    );
    const cached = new RequestCache(home).read(key);
    assert.equal(cached.kind, "present");
    rmSync(path);
    const retry = await runCliWithPeer(home, home, args, handle);
    assert.equal(retry.signal, null);
    assert.equal(retry.status, 3, retry.stderr);
    assert.match(retry.stderr, /Acceptance status unknown: brief/);
    assert.deepEqual(
      retry.requests.map((request) => request.method),
      ["operation.get", "agent.create", "operation.get"],
    );
    assert.deepEqual(new RequestCache(home).read(key), cached);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
