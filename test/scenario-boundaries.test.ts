/** Scenario tests at the boundaries the sixth review fixed, with only the
 * model scripted (fixtures/scenario.ts): the Resident's file tools on
 * the confined workspace (P0V-74), the inputs its CLI reads (P0V-78), the shared
 * context, and the order mail is delivered in when the clock goes back
 * (P0V-87). Each asserts durable facts -- files on the host, ledger rows,
 * what the model was handed -- for the normal path and its failure.
 *
 * Not provider evidence (P0-5).
 */
import test from "node:test";
import type { AuthContext, Request } from "@oma/contracts";
import { RESIDENT_TEST_OPTIONS } from "./fixtures/resident.js";
import assert from "node:assert/strict";
import { closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { withScenario, SCENARIO_LIMITS } from "./fixtures/scenario.js";
import { call, text, textOf, toolResults, tools, type ChatRequest } from "./fixtures/scripted-provider.js";
import { principalWorkspace } from "@oma/engine/principal-session";
import { workspacePathAt } from "@oma/domain/paths";
import { sha256Hex } from "@oma/domain/canonical-json";

const TIMEOUT = { timeout: 180_000 };
const lastResult = (request: ChatRequest | undefined): string => toolResults(request ?? { messages: [] }).at(-1)?.text ?? "";
const receiptIn = (result: string): { operation: string; state: string; result?: Record<string, unknown> } => {
  const at = result.indexOf("{");
  assert.ok(at >= 0, `the tool result carries no receipt: ${result}`);
  return JSON.parse(result.slice(at)) as { operation: string; state: string; result?: Record<string, unknown> };
};
const noticed = (notice: string): string[] => [...notice.matchAll(/path=\/mail\/archive\/cur\/(m-[0-9a-f-]+-\d+):2,/g)].map(match => match[1]!);

const goalMail = (body: string, expectedRevision: string, request: string) => tools(call("oma_mail_send", {
  to: ["residents"], subject: "Shared goal", body, intent: "goal", expectedRevision, request,
}));

test("SCN-B01: Principal GOAL mail preserves the exact other documents from its expected revision", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    // The trusted host seeds historical multi-document context, not the model.
    // The model may now change only GOAL; the CLI carries other bytes forward.
    const files = [["GOAL.md", "# Before\n"], ["RATIONALE.md", "﻿Why\r\n"], ["decisions/001.md", "결정: 재시도는 세 번.\n"]] as const;
    const content = Buffer.from(files.map(([, body]) => body).join(""));
    const authority: AuthContext = { actor: "principal", incarnation: s.store.getAgent("principal")!.incarnation,
      role: "principal", channel: "actor", capabilities: new Set(["context.publish"]),
      peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
    const request: Request = { v: 1, id: "seed", method: "context.publish", request: "seed", params: {
      expected: null, entries: files.map(([path, body]) => ({ path, bytes: Buffer.byteLength(body), sha256: sha256Hex(Buffer.from(body)) })),
      content: { bytes: content.length, sha256: sha256Hex(content), mediaType: "application/vnd.oma.context-v1" },
    } };
    const source = async function* () { yield content; };
    const denied = await s.broker.dispatch(authority, request, source()) as { ok: boolean; error: { code: string } };
    assert.equal(denied.ok, false); assert.equal(denied.error.code, "CAPABILITY_DENIED");
    assert.equal(s.operations("principal").filter(row => row.kind === "context.publish").length, 0);
    const seed = await s.broker.dispatch({ ...authority, channel: "host" }, request, source()) as { ok: boolean };
    assert.equal(seed.ok, true, JSON.stringify(seed));
    const current = join(s.root, "world", "context", "current");
    const base = readlinkSync(current).slice("revisions/".length);
    const goal = "# 목표\n결제 오류를 없앤다.\n";
    s.script([goalMail(goal, base, "ctx-b01"), text("게시했습니다.")]);
    await s.prompt("목표를 메일로 게시해");
    const receipt = receiptIn(lastResult(s.provider.seen[1]!.body));
    assert.equal(receipt.state, "succeeded", JSON.stringify(receipt));
    assert.equal(readFileSync(join(current, "GOAL.md"), "utf8"), goal);
    for (const [path, body] of files.slice(1)) assert.equal(readFileSync(join(current, path), "utf8"), body);
    assert.match(readlinkSync(current), /^revisions\/[0-9a-f]{40,64}$/);
    assert.equal(s.operations("principal").filter(row => row.kind === "context.publish").length, 2);
  });
});

test("SCN-B02: the retained context CLI input refuses an oversized stream before transport or acceptance (P0V-78)", TIMEOUT, async () => {
  await withScenario({}, async s => {
    const directory = join(principalWorkspace(s.root), "context");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "GOAL.md"), "# 목표\n");
    const big = openSync(join(directory, "RATIONALE.md"), "w");
    try { ftruncateSync(big, 9 * 1024 * 1024); } finally { closeSync(big); }
    // Exercise the CLI's production input owner without restoring the removed
    // model-facing directory tool or weakening the separate mail body bound.
    const result = spawnSync(process.execPath, ["--input-type=module", "-e",
      `import { prepareContextEffects } from ${JSON.stringify(new URL(import.meta.resolve("#oma-test/app/cli/effects/context")).href)}; import { fatal } from ${JSON.stringify(new URL(import.meta.resolve("#oma-test/app/cli/exit")).href)}; try { prepareContextEffects(process.argv[1]); } catch (error) { fatal(error); }`, directory],
    { encoding: "utf8", env: { OMA_CONTEXT_BYTES: String(SCENARIO_LIMITS.contextBytes) }, timeout: 10_000 });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /larger than a request can carry \(8388608 bytes\)/);
    assert.equal(s.operations("principal").filter(row => row.kind === "context.publish").length, 0);
    assert.equal(existsSync(join(s.root, "world", "context", "current")), false);
  });
});

test("SCN-B03: a Worker's write through a workspace link is refused; an ordinary write succeeds (P0V-74)", RESIDENT_TEST_OPTIONS, async () => {
  await withScenario({ residents: ["worker-a", "worker-b"] }, async s => {
    const workspace = workspacePathAt(s.root, "worker-a");
    const outside = join(s.root, "outside"); mkdirSync(outside);
    await s.residentSends("worker-b", { to: ["worker-a"], subject: "Notes", body: "Write notes." }, "task");
    s.script((_request, index) => {
      if (index === 0) {
        // The actual runner has cloned and opened this Worker's workspace.
        symlinkSync(join(outside, "planted"), join(workspace, "notes.md"));
        return tools(call("write", { path: "notes.md", content: "pwned\n" }));
      }
      if (index === 1) return tools(call("write", { path: "docs/plan.md", content: "계획\n" }));
      return text("끝났습니다.");
    });
    const run = await s.activate("worker-a"); assert.equal(run.code, 0, run.stderr);
    const refused = lastResult(s.provider.seen[1]!.body);
    assert.match(refused, /workspace|link|refus/i, refused);
    assert.equal(existsSync(join(outside, "planted")), false);
    assert.equal(readFileSync(join(workspace, "docs", "plan.md"), "utf8"), "계획\n");
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
    s.script([goalMail("# 목표 1\n", "none", "ctx-1"), text("게시했습니다.")]);
    await s.prompt("목표를 게시해");
    const current = join(s.root, "world", "context", "current");
    const first = readlinkSync(current).slice("revisions/".length);
    // The model still believes nothing is published.
    s.script([goalMail("# 목표 2\n", "none", "ctx-2"), text("충돌했습니다.")]);
    await s.prompt("새 목표를 게시해");
    const refused = lastResult(s.provider.seen.at(-1)!.body);
    assert.match(refused, /CONTEXT_CONFLICT/, refused);
    assert.ok(refused.includes(first), `the refusal does not name the actual base: ${refused}`);
    assert.equal(readFileSync(join(current, "GOAL.md"), "utf8"), "# 목표 1\n", "a stale publication moved the context");
    s.script([goalMail("# 목표 2\n", first, "ctx-3"), text("다시 게시했습니다.")]);
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
      capabilities: new Set(["route.follow"]), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
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
  const { piAgentDir } = await import("@oma/engine/pi-runtime");
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
