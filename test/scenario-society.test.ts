/** Scenario tests: Residents and the whole society, with only the model scripted.
 *
 * Everything of fixtures/scenario.ts, plus the product's own runner process
 * (dist/src/entry/runner.js) started for a Resident the way its unit starts
 * it: it opens a run on the broker's runner endpoint, takes one prepared
 * batch, delivers it into a fresh bundled engine whose tools reach the broker
 * through the run's actor socket, publishes the receipt and completes the
 * batch. One scripted provider answers both the Principal's engine and the
 * Resident's; `isResident` tells them apart by the tools they were offered.
 * The runner runs unconfined (no rootfs is declared); confinement has its own
 * live tests. Not provider evidence (P0-5; INF-001).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withScenario, type Scenario } from "./fixtures/scenario.js";
import { call, continuesTurn, lastUserText, text, textOf, toolResults, tools, type ChatRequest, type Reply } from "./fixtures/scripted-provider.js";
import { runnerReceiptPathAt, workspacePathAt } from "../src/storage/paths.js";

const TIMEOUT = { timeout: 180_000 };
const isResident = (request: ChatRequest): boolean => !(request.tools ?? []).some(tool => tool.function?.name === "oma_agent_create");
const lastResult = (request: ChatRequest | undefined): string => toolResults(request ?? { messages: [] }).at(-1)?.text ?? "";
const noticed = (request: ChatRequest): string[] =>
  [...request.messages.map(textOf).join("\n").matchAll(/path=\/mail\/archive\/cur\/(m-[0-9a-f-]+-\d+):2,/g)].map(match => match[1]!);
const receiptIn = (result: string): { operation: string; state: string; result?: { message?: string } } => {
  const at = result.indexOf("{");
  assert.ok(at >= 0, `the tool result carries no receipt: ${result}`);
  return JSON.parse(result.slice(at)) as { operation: string; state: string; result?: { message?: string } };
};
/** The Principal sends one mail through the broker, as its tool would. */
async function principalSends(s: Scenario, to: string[], subject: string, body: string, key: string): Promise<string> {
  const principal = s.store.getAgent("principal")!;
  const sent = await s.broker.dispatch({ actor: "principal", incarnation: principal.incarnation, role: "principal", channel: "actor",
    capabilities: new Set(["mail.send"]), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } },
  { v: 1, id: key, method: "mail.send", request: key, params: { to, subject, kind: "message", body } } as never, null) as { ok: boolean; result: { result: { message: string } } };
  assert.equal(sent.ok, true, JSON.stringify(sent));
  return sent.result.result.message;
}
const residentRequests = (s: Scenario) => s.provider.seen.filter(entry => isResident(entry.body));

test("SCN-R01: a Resident's run reads the mail it was given, replies in the thread, and completes its batch once", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const task = await principalSends(s, ["worker-a"], "요약 요청", "README를 세 줄로 요약해 주세요.", "p-r01");
    s.script((request, index) => {
      if (index === 0) return tools(call("oma_mail_read", { messageId: `/mail/archive/cur/${noticed(request)[0]}:2,` }));
      if (index === 1) return tools(call("oma_mail_send", { to: ["principal"], subject: "Re: 요약 요청", body: "요약: 설치, 실행, 기여.", kind: "result", replyTo: task }));
      return text("완료했습니다.");
    });
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    assert.match(lastResult(residentRequests(s)[1]!.body), /README를 세 줄로/, "the Resident did not read its mail");
    const delivery = s.store.getDelivery(task, "worker-a")!;
    assert.equal(delivery.presented, 1);
    assert.equal(s.store.getBatch(delivery.batchId!)?.state, "completed");
    assert.ok(existsSync(runnerReceiptPathAt(s.root, "worker-a", delivery.batchId!)), "the runner published no receipt");
    const replies = s.operations("worker-a").filter(row => row.kind === "mail.send");
    assert.equal(replies.length, 1);
    const [reply] = s.inbox("principal");
    assert.ok(reply);
    assert.match(s.archived(reply), new RegExp(`^In-Reply-To: <${task}@demo\\.oma\\.invalid>`, "m"));
  });
});

test("SCN-R02: a Resident is offered its own tools and not the Principal's", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    await principalSends(s, ["worker-a"], "확인", "도구를 확인하세요.", "p-r02");
    s.script([tools(call("oma_status", {})), text("확인했습니다.")]);
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const offered = (residentRequests(s)[0]!.body.tools ?? []).map(tool => tool.function?.name);
    for (const name of ["oma_mail_read", "oma_mail_send", "oma_mail_ack", "oma_status"]) assert.ok(offered.includes(name), `${name} missing`);
    for (const name of ["oma_agent_create", "oma_agent_lifecycle", "oma_context_publish", "oma_route", "bash"])
      assert.ok(!offered.includes(name), `${name} was offered to a Resident`);
    assert.match(lastResult(residentRequests(s)[1]!.body), /worker-a/);
  });
});

test("SCN-R03: a Resident writes to another Resident and to the commons; each recipient, the sender included, gets it once", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a", "worker-b", "worker-c"] }, async s => {
    await principalSends(s, ["worker-a"], "조율", "b와 모두에게 알려주세요.", "p-r03");
    s.script([tools(call("oma_mail_send", { to: ["worker-b"], subject: "직접", body: "b에게" }), call("oma_mail_send", { to: ["commons"], subject: "공지", body: "모두에게", kind: "alert" })), text("알렸습니다.")]);
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    assert.equal(s.inbox("worker-b").length, 2, "worker-b did not get the direct mail and the notice");
    assert.equal(s.inbox("worker-c").length, 1);
    // The commons is a list, and its sender is on it (MAIL routing table);
    // worker-a holds its own task and its own notice, once each.
    assert.equal(s.inbox("worker-a", "new").length + s.inbox("worker-a", "cur").length, 2);
  });
});

test("SCN-R04: a Resident whose provider keeps failing leaves its batch for the next run, which completes it once", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const task = await principalSends(s, ["worker-a"], "재시도", "처리해 주세요.", "p-r04");
    s.script(() => ({ kind: "http-error", status: 503 }) as Reply);
    const failed = await s.activate("worker-a");
    assert.notEqual(failed.code, 0, "a run whose model never answered reported success");
    assert.equal(s.store.getDelivery(task, "worker-a")?.presented, 0);
    assert.equal(s.store.preparedBatches("worker-a").length, 1);
    await s.restartBroker();
    s.script([text("이번에는 처리했습니다.")]);
    const again = await s.activate("worker-a");
    assert.equal(again.code, 0, again.stderr);
    assert.equal(s.store.getDelivery(task, "worker-a")?.presented, 1);
    assert.deepEqual(s.store.preparedBatches("worker-a"), []);
  });
});

test("SCN-R05: a Resident's runner killed mid-run loses no mail; the next run delivers it and completes it once", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const task = await principalSends(s, ["worker-a"], "중단", "처리해 주세요.", "p-r05");
    s.script(() => ({ kind: "hang" }));
    const killed = await s.activate("worker-a", 4_000);
    assert.notEqual(killed.code, 0);
    assert.equal(s.store.getDelivery(task, "worker-a")?.presented, 0);
    await s.restartBroker();
    s.script([text("다시 처리했습니다.")]);
    const again = await s.activate("worker-a");
    assert.equal(again.code, 0, again.stderr);
    assert.equal(s.store.getDelivery(task, "worker-a")?.presented, 1);
    assert.deepEqual(s.store.preparedBatches("worker-a"), []);
  });
});

test("SCN-R06: a Resident that writes a file larger than a frame finishes its run (DR15)", TIMEOUT, async () => {
  const content = "row,value\n".repeat(40_000);
  await withScenario({ residents: ["worker-a"] }, async s => {
    await principalSends(s, ["worker-a"], "데이터", "큰 CSV를 만들어 주세요.", "p-r06");
    s.script([tools(call("write", { path: "data.csv", content })), text("만들었습니다.")]);
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    assert.equal(readFileSync(join(workspacePathAt(s.root, "worker-a"), "data.csv"), "utf8"), content);
    assert.deepEqual(s.store.preparedBatches("worker-a"), []);
  });
});

test("SCN-R07: a Resident cannot write outside its workspace", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    await principalSends(s, ["worker-a"], "경계", "시도하세요.", "p-r07");
    const outside = join(s.root, "world", "planted.txt");
    s.script([tools(call("write", { path: outside, content: "x" }), call("write", { path: "../../config.json", content: "{}" })), text("못 했습니다.")]);
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    assert.equal(existsSync(outside), false, "the Resident wrote into the shared world");
    assert.doesNotMatch(readFileSync(join(s.root, "config.json"), "utf8"), /^\{\}$/, "the Resident replaced the configuration");
  });
});

test("SCN-S01: the whole society: a Human delegates, a Resident answers, the Principal reads it and reports", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    s.script((request, index) => {
      if (isResident(request)) {
        if (continuesTurn(request)) return text("답장했습니다.");
        const [task] = noticed(request);
        return tools(call("oma_mail_send", { to: ["principal"], subject: "Re: 조사", body: "원인은 캐시 만료입니다.", kind: "result", replyTo: task }));
      }
      if (lastUserText(request).includes("조사해")) return continuesTurn(request) ? text("worker-a에게 맡겼습니다.")
        : tools(call("oma_mail_send", { to: ["worker-a"], subject: "조사", body: "느린 응답의 원인을 조사해 주세요.", kind: "question", request: "s01-task" }));
      if (continuesTurn(request)) return text("worker-a: 원인은 캐시 만료입니다.");
      return tools(call("oma_mail_read", { messageId: `/mail/archive/cur/${noticed(request).at(-1)}:2,` }));
    });
    await s.prompt("느린 응답을 조사해");
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    assert.equal((await s.deliver()).kind, "delivered");
    assert.ok(s.lines.some(line => line.includes("원인은 캐시 만료입니다")), JSON.stringify(s.lines.slice(-4)));
    // Every fact once: the task, the answer, both deliveries, both batches.
    const task = s.operations("principal").find(row => row.request_key === "s01-task")!;
    assert.equal(task.state, "succeeded");
    assert.equal(s.operations("worker-a").filter(row => row.kind === "mail.send").length, 1);
    assert.deepEqual(s.store.preparedBatches("worker-a"), []);
    assert.deepEqual(s.store.preparedBatches("principal"), []);
    const answer = s.inbox("principal", "cur").concat(s.inbox("principal", "new"))[0]!.replace(/:2,.*$/, "");
    assert.equal(s.store.getDelivery(answer, "principal")?.presented, 1);
  });
});

test("SCN-S02: two Residents answer; the Principal gets both answers in one delivery", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a", "worker-b"] }, async s => {
    await principalSends(s, ["worker-a", "worker-b"], "의견", "각자 의견을 주세요.", "p-s02");
    s.script(request => (continuesTurn(request) ? text("보냈습니다.")
      : tools(call("oma_mail_send", { to: ["principal"], subject: "의견", body: `의견 (${request.messages.length})`, kind: "result" }))));
    assert.equal((await s.activate("worker-a")).code, 0);
    assert.equal((await s.activate("worker-b")).code, 0);
    s.script([text("두 의견을 받았습니다.")]);
    const outcome = await s.deliver();
    assert.deepEqual([outcome.kind, outcome.kind === "delivered" ? outcome.messages : 0], ["delivered", 2]);
  });
});

test("SCN-S03: mail that arrives while a Resident's run is going is left for its next run", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const first = await principalSends(s, ["worker-a"], "첫째", "첫 번째 일", "p-s03a");
    let second = "";
    s.script(() => ({ kind: "delayed", ms: 1500, then: { kind: "text", text: "첫째 완료" } }) as Reply);
    const running = s.activate("worker-a");
    const deadline = Date.now() + 30_000;
    while (residentRequests(s).length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    second = await principalSends(s, ["worker-a"], "둘째", "두 번째 일", "p-s03b");
    assert.equal((await running).code, 0);
    assert.equal(s.store.getDelivery(first, "worker-a")?.presented, 1);
    assert.equal(s.store.getDelivery(second, "worker-a")?.presented, 0, "the later mail was folded into the running delivery");
    await s.restartBroker();
    s.script([text("둘째 완료")]);
    assert.equal((await s.activate("worker-a")).code, 0);
    assert.equal(s.store.getDelivery(second, "worker-a")?.presented, 1);
  });
});
