import { callHumanControl } from "#oma-test/app/runtime/human-controls";
/** Scenario tests: Residents and the whole society, with only the model scripted.
 *
 * Everything of fixtures/scenario.ts, plus the product's own runner process
 * (apps/oma/dist/entry/runner.js) started for a Resident the way its unit starts
 * it: it opens a run on the broker's runner endpoint, takes one prepared
 * batch, delivers it into a fresh bundled engine whose tools reach the broker
 * through the run's actor socket, publishes the receipt and completes the
 * batch. One scripted provider answers both the Principal's engine and the
 * Resident's; `isResident` tells them apart by the tools they were offered.
 * Every runner uses the generated rootfs and bubblewrap with the TLS relay.
 * Not provider evidence (P0-5; INF-001).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withScenario, SCENARIO_LIMITS, type Scenario } from "./fixtures/scenario.js";
import { call, continuesTurn, delayed, lastUserText, text, textOf, toolResults, tools, type ChatRequest, type Reply } from "./fixtures/scripted-provider.js";
import { WORKER_MODEL, commitField, commitRoleSet, readSettings, readSettingsForEditing, roleSetOf, writeSettings } from "#oma-test/app/application/settings";
import { runnerReceiptPathAt, workspacePathAt, collaborationRecordRootPathAt } from "@oma/domain/paths";
import { readableBody } from "@oma/mail/display";

import { RESIDENT_TEST_OPTIONS as TIMEOUT } from "./fixtures/resident.js";
import { CONFINED_MODEL, CONFINED_MODEL_2, CONFINED_THINKING_MODEL } from "./fixtures/scripted-provider.js";
const isResident = (request: ChatRequest): boolean => !(request.tools ?? []).some(tool => tool.function?.name === "oma_society");
const lastResult = (request: ChatRequest | undefined): string => toolResults(request ?? { messages: [] }).at(-1)?.text ?? "";
const noticed = (request: ChatRequest): string[] =>
  [...request.messages.map(textOf).join("\n").matchAll(/\/mail\/messages\/(m-[0-9a-f-]+-\d+)\.md/g)].map(match => match[1]!);
const receiptIn = (result: string): { operation: string; state: string; result?: { message?: string } } => {
  const envelope = JSON.parse(result);
  assert.equal(typeof envelope.invocation.key, "string");
  assert.ok(envelope.receipt, `the tool result carries no receipt: ${result}`);
  return envelope.receipt;
};
/** The Principal sends one mail through the broker, as its tool would. */
async function principalSends(s: Scenario, to: string[], subject: string, body: string, key: string): Promise<string> {
  const sent = await s.residentSends("principal", { to, subject, body }, key) as { ok: boolean; result: { result: { message: string } } };
  assert.equal(sent.ok, true, JSON.stringify(sent));
  return sent.result.result.message;
}
const residentRequests = (s: Scenario) => s.provider.seen.filter(entry => isResident(entry.body));

test("001. A Resident's run reads the mail it was given, replies in the thread, and completes its batch once", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const task = await principalSends(s, ["worker-a"], "요약 요청", "README를 세 줄로 요약해 주세요.", "p-r01");
    s.script((request, index) => {
      if (index === 0) return tools(call("read", { path: `/oma/mail/messages/${task}.md` }));
      if (index === 1) return tools(call("oma_send", { to: ["principal"], subject: "Re: 요약 요청", content: { kind: "text", value: "요약: 설치, 실행, 기여." }, replyTo: task }));
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

test("002. A Resident is offered its own tools and not the Principal's", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    await principalSends(s, ["worker-a"], "확인", "도구를 확인하세요.", "p-r02");
    s.script([tools(call("read", { path: "/oma/peers/index.md" })), text("확인했습니다.")]);
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const offered = (residentRequests(s)[0]!.body.tools ?? []).map(tool => tool.function?.name);
    for (const name of ["oma_spawn", "oma_wait", "read", "oma_send", "oma_follow"])
      assert.ok(offered.includes(name), `${name} missing`);
    assert.ok(offered.includes("bash"), "the confined Resident lost its sandbox shell");
    for (const name of ["oma_society", "oma_goal_publish", "oma_agent_control", "oma_context_publish"])
      assert.ok(!offered.includes(name), `${name} was offered to a Resident`);
    assert.match(lastResult(residentRequests(s)[1]!.body), /worker-a/);
  });
});

test("003. A Resident writes to another Resident and to the commons; each recipient, the sender included, gets it once", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a", "worker-b", "worker-c"] }, async s => {
    await principalSends(s, ["worker-a"], "조율", "b와 모두에게 알려주세요.", "p-r03");
    s.script([tools(call("oma_send", { to: ["worker-b"], subject: "직접", content: { kind: "text", value: "b에게" } }), call("oma_send", { to: ["commons"], subject: "공지", content: { kind: "text", value: "모두에게" } })), text("알렸습니다.")]);
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    assert.equal(s.inbox("worker-b").length, 2, "worker-b did not get the direct mail and the notice");
    assert.equal(s.inbox("worker-c").length, 1);
    // The commons is a list, and its sender is on it (MAIL routing table);
    // worker-a holds its own task and its own notice, once each.
    assert.equal(s.inbox("worker-a", "new").length + s.inbox("worker-a", "cur").length, 2);
  });
});

test("004. A Resident whose provider keeps failing leaves its batch for the next run, which completes it once", TIMEOUT, async () => {
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

test("005. A Resident's runner killed mid-run loses no mail; the next run delivers it and completes it once", TIMEOUT, async () => {
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

test("006. A Resident that writes a file larger than a frame finishes its run (DR15)", TIMEOUT, async () => {
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

test("007. A Resident cannot write outside its workspace", TIMEOUT, async () => {
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

test("008. The whole society: a Human delegates, a Resident answers, the Principal reads it and reports", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    let workerStep = 0, deliveryStep = 0;
    s.script((request, index) => {
      if (isResident(request)) {
        if (workerStep++ === 0) return tools(call("read", { path: "/oma/mail/inbox.md" }));
        if (workerStep > 2) return text("답장했습니다.");
        const task = /mail\/messages\/(m-[0-9a-f-]+-\d+)\.md/.exec(lastResult(request))![1]!;
        return tools(call("oma_send", { to: ["principal"], subject: "Re: 조사", content: { kind: "text", value: "원인은 캐시 만료입니다." }, replyTo: task }));
      }
      if (lastUserText(request).includes("조사해")) return continuesTurn(request) ? text("worker-a에게 맡겼습니다.")
        : tools(call("oma_send", { to: ["worker-a"], subject: "조사", content: { kind: "text", value: "느린 응답의 원인을 조사해 주세요." } }, "s01-task"));
      if (deliveryStep++ === 0) return tools(call("read", { path: join(collaborationRecordRootPathAt(s.root, "principal"), "mail/inbox.md") }));
      if (deliveryStep === 2) return tools(call("read", { path: join(collaborationRecordRootPathAt(s.root, "principal"), "mail/messages", `${/mail\/messages\/(m-[0-9a-f-]+-\d+)\.md/.exec(lastResult(request))![1]}.md`) }));
      return text("worker-a: 원인은 캐시 만료입니다.");
    });
    await s.prompt("느린 응답을 조사해");
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    assert.equal((await s.deliver()).kind, "delivered");
    assert.ok(s.lines.some(line => line.includes("원인은 캐시 만료입니다")), JSON.stringify(s.lines.slice(-4)));
    // Every fact once: the task, the answer, both deliveries, both batches.
    const task = s.operations("principal").find(row => row.kind === "mail.send")!;
    assert.equal(task.state, "succeeded");
    assert.equal(s.operations("worker-a").filter(row => row.kind === "mail.send").length, 1);
    assert.deepEqual(s.store.preparedBatches("worker-a"), []);
    assert.deepEqual(s.store.preparedBatches("principal"), []);
    const answer = s.inbox("principal", "cur").concat(s.inbox("principal", "new"))[0]!.replace(/:2,.*$/, "");
    assert.equal(s.store.getDelivery(answer, "principal")?.presented, 1);
  });
});

test("009. Two Residents answer; the Principal gets both answers in one delivery", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a", "worker-b"] }, async s => {
    await principalSends(s, ["worker-a", "worker-b"], "의견", "각자 의견을 주세요.", "p-s02");
    s.script(request => (continuesTurn(request) ? text("보냈습니다.")
      : tools(call("oma_send", { to: ["principal"], subject: "의견", content: { kind: "text", value: `의견 (${request.messages.length})` } }))));
    assert.equal((await s.activate("worker-a")).code, 0);
    assert.equal((await s.activate("worker-b")).code, 0);
    s.script([text("두 의견을 받았습니다.")]);
    const outcome = await s.deliver();
    assert.deepEqual([outcome.kind, outcome.kind === "delivered" ? outcome.messages : 0], ["delivered", 2]);
  });
});

test("010. Mail that arrives while a Resident's run is going is left for its next run", TIMEOUT, async () => {
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

test("011. A Worker creates a peer; the first run reads its brief; the same frozen name intent links to its original child and a different brief refuses", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    await principalSends(s, ["worker-a"], "Collaborate", "Create a peer.", "create-task");
    const create = (brief: string, request: string) => tools(call("oma_spawn", { name: "worker-n", from: "HEAD", brief: { kind: "text", value: brief } }, request));
    const creatorReplies = [create("Review the README.", "create-1"), create("Review the README.", "create-repeat"), create("Different task", "create-2"), text("Ready.")];
    let creatorStep = 0, childRead = false;
    const creatorRequests: ChatRequest[] = [];
    s.script(request => {
      const brief = noticed(request).find(id => s.store.getDelivery(id, "worker-n") !== null);
      if (brief) {
        if (continuesTurn(request)) {
          assert.match(lastResult(request), /Review the README/); childRead = true; return text("Read.");
        }
        return tools(call("read", { path: `/oma/mail/messages/${brief}.md` }));
      }
      creatorRequests.push(request);
      return creatorReplies[creatorStep++] ?? text("Ready.");
    });
    const creator = await s.activate("worker-a"); assert.equal(creator.code, 0, creator.stderr);
    const results = toolResults(creatorRequests.at(-1)!).map(result => result.text);
    const created = receiptIn(results[0]!); assert.equal(created.state, "succeeded");
    const linked = receiptIn(results[1]!); assert.equal(linked.state, "succeeded");
    const link = s.store.getOperationById(linked.operation);
    assert.ok(link?.kind === "agent.create" && link.plan.existingCreation === created.operation && link.plan.initialMessage === null);
    assert.match(results[2]!, /AGENT_CONFLICT/);
    const agent = s.store.getAgent("worker-n")!; assert.deepEqual([agent.desired, agent.createdBy], ["enabled", "worker-a"]);
    const [brief] = [...s.inbox("worker-n"), ...s.inbox("worker-n", "cur")]; assert.ok(brief, "the peer has no initial brief");
    const id = brief.replace(/:2,.*$/, "");
    assert.equal(readableBody(s.archived(id)), "Review the README.");
    const deadline = Date.now() + 30_000;
    while ((!childRead || s.store.getDelivery(id, "worker-n")?.presented !== 1) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(childRead, true, "the automatically started first run did not read its brief");
    assert.equal(s.store.getDelivery(id, "worker-n")?.presented, 1);
    const finished = await s.residentFinished("worker-n");
    assert.equal(finished.execMainStatus, 0, JSON.stringify(finished));
    assert.equal(s.operations("worker-a").filter(row => row.kind === "agent.create" && row.state === "succeeded").length, 2);
    assert.equal(s.operations("principal").filter(row => row.kind === "agent.create").length, 0);
  });
});

test("012. Accepted creation starts its first real Resident without a manual activation", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    await principalSends(s, ["worker-a"], "Create", "Create a peer with its initial brief.", "auto-create-task");
    let childRead = false;
    s.script(request => {
      const brief = noticed(request).find(id => s.store.getDelivery(id, "worker-auto") !== null);
      if (brief) {
        if (continuesTurn(request)) {
          assert.match(lastResult(request), /Read the exact initial brief/);
          childRead = true;
          return text("Read.");
        }
        return tools(call("read", { path: `/oma/mail/messages/${brief}.md` }));
      }
      return continuesTurn(request) ? text("Created.") : tools(call("oma_spawn", { name: "worker-auto", from: "HEAD", brief: { kind: "text", value: "Read the exact initial brief." } }, "auto-create"));
    });
    const creator = await s.activate("worker-a");
    assert.equal(creator.code, 0, creator.stderr);
    const deadline = Date.now() + 30_000;
    while ((!childRead || s.store.preparedBatches("worker-auto").length > 0) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(childRead, true, "the native creation path did not run the new Resident");
    const operation = s.operations("worker-a").find(row => row.kind === "agent.create")!;
    assert.equal(operation.state, "succeeded");
    const [brief] = [...s.inbox("worker-auto"), ...s.inbox("worker-auto", "cur")];
    assert.ok(brief);
    assert.equal(readableBody(s.archived(brief.replace(/:2,.*$/, ""))), "Read the exact initial brief.");
    const delivered = s.store.getDelivery(brief.replace(/:2,.*$/, ""), "worker-auto")!;
    assert.equal(delivered.presented, 1);
    assert.equal(s.store.getBatch(delivered.batchId!)?.state, "completed");
    assert.ok(existsSync(runnerReceiptPathAt(s.root, "worker-auto", delivered.batchId!)));
    const finished = await s.residentFinished("worker-auto");
    assert.equal(finished.execMainStatus, 0, JSON.stringify(finished));
  });
});

test("013. Human stop prevents activation; releasing the observed stop lets the next run get pending mail", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const control = async (action: "stop" | "release", key: string) => {
      const status = await callHumanControl(s.runRoot, SCENARIO_LIMITS, { action: "inspect", agent: "worker-a" }, () => {});
      assert.equal(status.kind, "status");
      if (status.kind !== "status") throw new Error("expected a current control observation");
      return callHumanControl(s.runRoot, SCENARIO_LIMITS, { action, agent: "worker-a", key,
        expected: { incarnation: status.incarnation, desired: status.desired, control: status.control?.operation ?? null } }, () => {});
    };
    await control("stop", "human-stop");
    assert.equal(s.store.getAgent("worker-a")?.desired, "stopped");
    const task = await principalSends(s, ["worker-a"], "대기", "멈춘 동안 온 일", "p-l06");
    const refused = await s.activate("worker-a");
    assert.notEqual(refused.code, 0, "a stopped Resident's runner ran");
    assert.equal(s.store.getDelivery(task, "worker-a")?.presented, 0);
    await control("release", "human-release");
    assert.equal(s.store.getAgent("worker-a")?.desired, "enabled");
    await s.restartBroker();
    s.script([text("대기하던 일을 받았습니다.")]);
    assert.equal((await s.activate("worker-a")).code, 0);
    assert.equal(s.store.getDelivery(task, "worker-a")?.presented, 1);
  });
});

test("014. The broker restarts during a Resident's turn; the next run settles the batch from its receipt and does not present it again", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const task = await principalSends(s, ["worker-a"], "정산", "처리해 주세요.", "p-r08");
    s.script(() => delayed(1500, text("처리했습니다.")));
    const running = s.activate("worker-a");
    const deadline = Date.now() + 30_000;
    while (residentRequests(s).length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    await s.stopBroker();
    const first = await running;
    assert.notEqual(first.code, 0, "the run completed against a broker that was gone");
    const presentedBefore = residentRequests(s).filter(entry => !continuesTurn(entry.body)).length;
    await s.restartBroker();
    s.script([text("다시는 보이면 안 됩니다.")]);
    const second = await s.activate("worker-a");
    assert.equal(second.code, 0, second.stderr);
    assert.equal(s.store.getDelivery(task, "worker-a")?.presented, 1);
    assert.deepEqual(s.store.preparedBatches("worker-a"), []);
    assert.equal(residentRequests(s).filter(entry => !continuesTurn(entry.body)).length, presentedBefore,
      "the batch was presented to the model again although its receipt settled it");
  });
});

test("015. A Worker model changed in the configuration applies from the next activation", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    await principalSends(s, ["worker-a"], "첫째", "첫 번째", "p-x01a");
    s.script([text("첫째 완료")]);
    assert.equal((await s.activate("worker-a")).code, 0);
    assert.equal(residentRequests(s).at(-1)!.body.model, CONFINED_MODEL.model);
    const settings = readSettings(s.configPath);
    assert.equal(commitField(settings, WORKER_MODEL, "scripted-2").kind, "saved");
    await principalSends(s, ["worker-a"], "둘째", "두 번째", "p-x01b");
    await s.restartBroker();
    s.script([text("둘째 완료")]);
    assert.equal((await s.activate("worker-a")).code, 0);
    assert.equal(residentRequests(s).at(-1)!.body.model, CONFINED_MODEL_2.model, "the next activation did not use the changed model");
  });
});

test("016. A verified installed Worker extension remains directly callable alongside the collaboration tools", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    // The package store as the engine's package manager leaves it, beside every session.
    const packages = join(dirname(s.root), ".packages");
    const entry = "packages:npm/node_modules/oma-hello-ext/extensions/hello.ts";
    const file = join(packages, entry.slice("packages:".length));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "import { writeFileSync } from 'node:fs';\nexport default function (pi) {\n  pi.on(\"session_start\", () => writeFileSync(\"extension-loaded.txt\", \"loaded\"));\n  pi.registerTool({ name: \"hello_ext\", label: \"hello\", " +
      "description: \"Say hello from an installed package.\", parameters: { type: \"object\", properties: {} },\n" +
      "    async execute() { return { content: [{ type: \"text\", text: \"hello\" }], details: {} }; } });\n}\n");
    await principalSends(s, ["worker-a"], "첫째", "첫 번째", "p-x03a");
    s.script([text("첫째 완료")]);
    assert.equal((await s.activate("worker-a")).code, 0);
    const named = (index: number) => (residentRequests(s).at(index)!.body.tools ?? []).map(tool => tool.function?.name);
    assert.ok(!named(-1).includes("hello_ext"), "an extension no role chose was loaded");
    const initialCatalog = residentRequests(s).at(-1)!.body.tools?.find(tool => tool.function?.name === "toolset");
    assert.ok(!JSON.stringify(initialCatalog ?? {}).includes('"hello_ext"'),
      "an extension no role chose was offered in the optional catalog");
    // Turned on for the Workers: the configuration names the store and the role names the package's file.
    const current = readSettings(s.configPath);
    writeSettings(s.configPath, { ...current.config, installation: { ...current.config.installation, packages } });
    const inline = readSettingsForEditing(s.configPath);
    const roles = roleSetOf(inline.snapshot!);
    const worker = inline.workerProfile!;
    commitRoleSet(inline.snapshot!, inline.config, { ...roles, [worker]: { ...roles[worker]!, extensions: [...roles[worker]!.extensions, entry] } });
    await principalSends(s, ["worker-a"], "둘째", "확장 도구를 쓰세요", "p-x03b");
    await s.restartBroker();
    s.script((request, index) => {
      const offered = (request.tools ?? []).map(tool => tool.function?.name);
      assert.ok(offered.includes("hello_ext"), "the verified user extension lost its direct SDK exposure");
      assert.ok(!offered.includes("toolset"), "the retired selector must remain absent");
      return index === 0 ? tools(call("hello_ext", {}, "installed-hello")) : text("둘째 완료");
    });
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    assert.equal(readFileSync(join(workspacePathAt(s.root, "worker-a"), "extension-loaded.txt"), "utf8"), "loaded");
    assert.equal(toolResults(residentRequests(s).at(-1)!.body).find(result => result.id === "installed-hello")?.text, "hello");
  });
});

test("017. A Worker's model and effort chosen from the engine's list are what its next activation asks for", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const settings = readSettings(s.configPath);
    assert.equal(commitField(settings, WORKER_MODEL, { ...CONFINED_THINKING_MODEL, thinking: "high" }).kind, "saved");
    await principalSends(s, ["worker-a"], "생각", "깊게 생각해 주세요", "p-x02");
    await s.restartBroker();
    s.script([text("생각 완료")]);
    assert.equal((await s.activate("worker-a")).code, 0);
    const asked = residentRequests(s).at(-1)!.body;
    assert.equal(asked.model, CONFINED_THINKING_MODEL.model);
    // Not the engine's own default (medium): the profile's effort reached the engine.
    assert.equal(asked.reasoning_effort, "high");
  });
});

test("018. A backend status query for one Worker names that agent and its pending mail", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a", "worker-b"] }, async s => {
    await s.residentSends("worker-b", { to: ["worker-a"], subject: "대기", body: "처리 대기" }, "w-p09");
    const answer = await s.residentCall("worker-a", "status.get", { agent: "worker-a" }, null) as { ok: boolean; result: unknown };
    assert.equal(answer.ok, true);
    const status = JSON.stringify(answer.result);
    assert.match(status, /worker-a/);
    assert.doesNotMatch(status, /worker-b/, "a backend status query for one agent listed another");
  });
});
