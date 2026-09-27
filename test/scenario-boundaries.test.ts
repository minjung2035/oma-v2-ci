/** Scenario tests at the boundaries the sixth review fixed, with only the
 * model scripted (fixtures/scenario.ts): the Principal's own file tools on
 * the host (P0V-74), the local inputs its CLI reads (P0V-78), the shared
 * context, and the order mail is delivered in when the clock goes back
 * (P0V-87). Each asserts durable facts -- files on the host, ledger rows,
 * what the model was handed -- for the normal path and its failure.
 *
 * Not provider evidence (P0-5).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withScenario } from "./fixtures/scenario.js";
import { call, continuesTurn, text, textOf, toolResults, tools, type ChatRequest } from "./fixtures/scripted-provider.js";
import { principalWorkspace } from "../src/tui/session.js";

const TIMEOUT = { timeout: 180_000 };
const lastResult = (request: ChatRequest | undefined): string => toolResults(request ?? { messages: [] }).at(-1)?.text ?? "";
const receiptIn = (result: string): { operation: string; state: string; result?: Record<string, unknown> } => {
  const at = result.indexOf("{");
  assert.ok(at >= 0, `the tool result carries no receipt: ${result}`);
  return JSON.parse(result.slice(at)) as { operation: string; state: string; result?: Record<string, unknown> };
};
const noticed = (notice: string): string[] => [...notice.matchAll(/path=\/mail\/archive\/cur\/(m-[0-9a-f-]+-\d+):2,/g)].map(match => match[1]!);

test("SCN-B01: the Principal publishes the shared context from its workspace; the world holds exactly those bytes", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const directory = join(principalWorkspace(s.root), "context");
    mkdirSync(join(directory, "decisions"), { recursive: true });
    const goal = "# 목표\n결제 오류를 없앤다.\n";
    writeFileSync(join(directory, "GOAL.md"), goal);
    writeFileSync(join(directory, "decisions", "001.md"), "결정: 재시도는 세 번.\n");
    s.script(request => (continuesTurn(request) ? text("게시했습니다.")
      : tools(call("oma_context_publish", { directory: "context", expect: "none", request: "ctx-b01" }))));
    await s.prompt("목표를 게시해");
    const receipt = receiptIn(lastResult(s.provider.seen[1]!.body));
    assert.equal(receipt.state, "succeeded", JSON.stringify(receipt));
    const current = join(s.root, "world", "context", "current");
    assert.equal(readFileSync(join(current, "GOAL.md"), "utf8"), goal);
    assert.equal(readFileSync(join(current, "decisions", "001.md"), "utf8"), "결정: 재시도는 세 번.\n");
    assert.match(readlinkSync(current), /^revisions\/[0-9a-f]{40,64}$/);
    assert.equal(s.operations("principal").filter(row => row.kind === "context.publish").length, 1);
  });
});

test("SCN-B02: a context larger than the society's context bound is refused before it is read, and nothing is recorded (P0V-78)", TIMEOUT, async () => {
  await withScenario({}, async s => {
    const directory = join(principalWorkspace(s.root), "context");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "GOAL.md"), "# 목표\n");
    // 9 MiB, sparse: above the 8 MiB the scenario's society allows.
    const big = openSync(join(directory, "RATIONALE.md"), "w");
    ftruncateSync(big, 9 * 1024 * 1024);
    closeSync(big);
    s.script(request => (continuesTurn(request) ? text("너무 큽니다.")
      : tools(call("oma_context_publish", { directory: "context", expect: "none", request: "ctx-b02" }))));
    await s.prompt("목표를 게시해");
    const result = lastResult(s.provider.seen[1]!.body);
    assert.match(result, /larger than a request can carry \(8388608 bytes\)/, result);
    assert.equal(s.operations("principal").filter(row => row.kind === "context.publish").length, 0, "a refused context was recorded");
    assert.equal(existsSync(join(s.root, "world", "context", "current")), false);
  });
});

test("SCN-B03: the Principal's write through a link its workspace holds is refused; nothing appears outside (P0V-74)", TIMEOUT, async () => {
  const outside = mkdtempSync(join(tmpdir(), "oma-outside-"));
  try {
    await withScenario({}, async s => {
      const workspace = principalWorkspace(s.root);
      mkdirSync(workspace, { recursive: true });
      // A link a checkout brought in, to a file that does not exist yet.
      symlinkSync(join(outside, "planted"), join(workspace, "notes.md"));
      mkdirSync(join(workspace, "docs"), { recursive: true });
      s.script([
        tools(call("write", { path: "notes.md", content: "pwned\n" })),
        tools(call("write", { path: "docs/plan.md", content: "계획\n" })),
        text("끝났습니다."),
      ]);
      await s.prompt("노트를 써");
      const refused = toolResults(s.provider.seen[1]!.body).at(-1)?.text ?? "";
      assert.match(refused, /workspace|link|refus/i, `the write through a link was not refused: ${refused}`);
      assert.equal(existsSync(join(outside, "planted")), false, "a file appeared outside the workspace");
      // An ordinary write in the same session lands where it was asked.
      assert.equal(readFileSync(join(workspace, "docs", "plan.md"), "utf8"), "계획\n");
    });
  } finally { rmSync(outside, { recursive: true, force: true }); }
});

test("SCN-B04: writes the model makes together cannot exceed the workspace quota; the one that fits lands (P0V-74, R6-18)", TIMEOUT, async () => {
  await withScenario({}, async s => {
    const workspace = principalWorkspace(s.root);
    mkdirSync(workspace, { recursive: true });
    // The scenario's quota is 64 MiB; leave 300 bytes of it, in a sparse file.
    const filler = openSync(join(workspace, "filler.bin"), "w");
    ftruncateSync(filler, 64 * 1024 * 1024 - 300);
    closeSync(filler);
    const body = "x".repeat(200);
    s.script([
      // Two writes in one answer: each fits alone, not both.
      tools(call("write", { path: "a.txt", content: body }, "w-a"), call("write", { path: "b.txt", content: body }, "w-b")),
      text("썼습니다."),
    ]);
    await s.prompt("두 파일을 써");
    const landed = ["a.txt", "b.txt"].filter(name => existsSync(join(workspace, name)));
    assert.equal(landed.length, 1, `writes together exceeded the quota: ${landed.join(" ")}`);
    const results = toolResults(s.provider.seen[1]!.body).map(result => result.text).join("\n");
    assert.match(results, /quota would be exceeded/, results);
  });
});

test("SCN-B05: mail accepted after the clock was set back reaches the Principal after the mail accepted before it (P0V-87)", TIMEOUT, async () => {
  const wall = Date.now;
  let offset = 0;
  // Held before the scenario builds its Store: it reads the clock it was built with.
  Date.now = () => wall() + offset;
  try {
    const residents = ["worker-a", "worker-b", "worker-c"];
    await withScenario({ residents }, async s => {
      const accepted: string[] = [];
      for (const [index, name] of residents.entries()) {
        const sent = await s.residentSends(name, { to: ["principal"], subject: `보고 ${index + 1}`, body: `${name}의 결과`, kind: "result" }, `order-${index}`) as { result: { result: { message: string } } };
        accepted.push(sent.result.result.message);
        offset -= 3600_000;
      }
      s.script(() => text("받았습니다."));
      const outcome = await s.deliver();
      assert.equal(outcome.kind, "delivered");
      const notice = s.provider.seen[0]!.body.messages.map(textOf).join("\n");
      assert.deepEqual(noticed(notice), accepted, "the Principal was handed the mail in another order than it was accepted");
    });
  } finally { Date.now = wall; }
});

test("SCN-B06: a second publication on a stale base is refused with the actual base; on the actual base it moves the context", TIMEOUT, async () => {
  await withScenario({}, async s => {
    const directory = join(principalWorkspace(s.root), "context");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "GOAL.md"), "# 목표 1\n");
    const publish = (expect: string, request: string) => tools(call("oma_context_publish", { directory: "context", expect, request }));
    s.script([publish("none", "ctx-1"), text("게시했습니다.")]);
    await s.prompt("목표를 게시해");
    const current = join(s.root, "world", "context", "current");
    const first = readlinkSync(current).slice("revisions/".length);
    writeFileSync(join(directory, "GOAL.md"), "# 목표 2\n");
    // The model still believes nothing is published.
    s.script([publish("none", "ctx-2"), text("충돌했습니다.")]);
    await s.prompt("새 목표를 게시해");
    const refused = lastResult(s.provider.seen.at(-1)!.body);
    assert.match(refused, /CONTEXT_CONFLICT/, refused);
    assert.ok(refused.includes(first), `the refusal does not name the actual base: ${refused}`);
    assert.equal(readFileSync(join(current, "GOAL.md"), "utf8"), "# 목표 1\n", "a stale publication moved the context");
    s.script([publish(first, "ctx-3"), text("다시 게시했습니다.")]);
    await s.prompt("현재 기준으로 다시 게시해");
    assert.equal(receiptIn(lastResult(s.provider.seen.at(-1)!.body)).state, "succeeded");
    assert.equal(readFileSync(join(current, "GOAL.md"), "utf8"), "# 목표 2\n");
    assert.notEqual(readlinkSync(current).slice("revisions/".length), first);
    // The refused request left no operation that accepted anything.
    const publications = s.operations("principal").filter(row => row.kind === "context.publish");
    assert.deepEqual(publications.map(row => row.state).sort(), ["succeeded", "succeeded"]);
  });
});

test("SCN-B07: a Resident follows a topic, gets its mail, unfollows, and gets none after; a Resident that never followed gets none", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a", "worker-b"] }, async s => {
    const agent = s.store.getAgent("worker-b")!;
    const auth = { actor: "worker-b", incarnation: agent.incarnation, role: "resident", channel: "actor",
      capabilities: new Set(["route.follow"]), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
    const route = async (method: "route.follow" | "route.unfollow", request: string) => {
      const answer = await s.broker.dispatch(auth as never, { v: 1, id: request, method, request, params: { topic: "release" } } as never, null) as { ok: boolean };
      assert.equal(answer.ok, true, JSON.stringify(answer));
    };
    const announce = async (subject: string, request: string): Promise<string> => {
      s.script([tools(call("oma_mail_send", { to: ["topic/release"], subject, body: subject, request })), text("알렸습니다.")]);
      await s.prompt(`${subject} 알려`);
      return receiptIn(lastResult(s.provider.seen.at(-1)!.body)).result!.message as string;
    };
    await route("route.follow", "follow-1");
    const first = await announce("배포 1", "rel-1");
    assert.deepEqual(s.inbox("worker-b"), [first]);
    await route("route.unfollow", "unfollow-1");
    const second = await announce("배포 2", "rel-2");
    assert.ok(!s.inbox("worker-b").includes(second), "mail after the unfollow reached the Resident");
    assert.deepEqual(s.inbox("worker-a"), [], "a Resident that never followed got topic mail");
    // Mail to a topic nobody follows is still accepted and archived (MAIL-002).
    assert.ok(s.archived(second).length > 0);
  });
});

test("SCN-B08: a body that begins with U+FEFF is stored and read back with it (P0V-86)", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const body = "﻿머리에 BOM이 있는 본문\n둘째 줄";
    const sent = await s.residentSends("worker-a", { to: ["principal"], subject: "BOM", body, kind: "result" }, "bom-1") as { result: { result: { message: string } } };
    const message = sent.result.result.message;
    s.script((request, index) => (index === 0 ? tools(call("oma_mail_read", { messageId: message })) : text("읽었습니다.")));
    const outcome = await s.deliver();
    assert.equal(outcome.kind, "delivered");
    const read = lastResult(s.provider.seen[1]!.body);
    assert.ok(read.includes(body), `the body the model read lost its U+FEFF: ${JSON.stringify(read.slice(0, 200))}`);
  });
});

test("SCN-B09 / S-02: the Principal's model cannot read the engine's credential, by any spelling of its path, nor list the society's state", TIMEOUT, async () => {
  const { piAgentDir } = await import("../src/runtime/pi-runtime.js");
  await withScenario({}, async s => {
    const credential = join(piAgentDir(s.root), "auth.json");
    mkdirSync(piAgentDir(s.root), { recursive: true });
    writeFileSync(credential, '{"anthropic":{"type":"api_key","key":"sk-ant-api03-NEVER-SHOWN"}}');
    const workspace = principalWorkspace(s.root);
    mkdirSync(workspace, { recursive: true });
    s.script([
      tools(call("read", { path: credential }, "r1"), call("read", { path: "../pi/auth.json" }, "r2"),
        call("read", { path: `${workspace}/../../pi/auth.json` }, "r3"), call("ls", { path: s.root }, "r4")),
      text("읽지 못했습니다."),
    ]);
    await s.prompt("엔진 인증 파일을 읽어");
    const results = toolResults(s.provider.seen[1]!.body).map(result => result.text);
    assert.equal(results.length, 4);
    for (const result of results) {
      assert.doesNotMatch(result, /NEVER-SHOWN|api_key/, `the model read the credential: ${result.slice(0, 200)}`);
      assert.doesNotMatch(result, /runtime\.sqlite|repos/, `the model listed the society's state: ${result.slice(0, 200)}`);
    }
  });
});

test("SCN-B10 / S-02: a hundred commons messages reach no Principal session; the one question to the Principal reaches it once", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a", "worker-b"] }, async s => {
    for (let index = 0; index < 100; index++)
      await s.residentSends("worker-a", { to: ["commons"], subject: `공지 ${index}`, body: `공지 ${index}` }, `commons-${index}`);
    const question = await s.residentSends("worker-b", { to: ["principal"], subject: "질문", body: "결정이 필요합니다", kind: "question" }, "q-1") as { result: { result: { message: string } } };
    s.script(() => text("질문을 받았습니다."));
    const outcome = await s.deliver();
    assert.equal(outcome.kind, "delivered");
    assert.equal(outcome.kind === "delivered" ? outcome.messages : 0, 1, "the Principal was handed more than its question");
    const notice = s.provider.seen[0]!.body.messages.map(textOf).join("\n");
    assert.deepEqual(noticed(notice), [question.result.result.message]);
    // Maildir names: a delivered message sits in cur with its info suffix.
    assert.deepEqual([...s.inbox("principal", "new"), ...s.inbox("principal", "cur")].map(name => name.replace(/:2,.*$/, "")), [question.result.result.message],
      "commons mail reached the Principal's mailbox");
    assert.equal((await s.deliver()).kind === "delivered", false, "a second delivery found more for the Principal");
  });
});
