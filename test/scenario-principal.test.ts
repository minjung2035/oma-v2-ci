/** Scenario tests: the Principal's whole loop with only the model scripted.
 *
 * Each test runs a real society (provisioned state, Store, mail, broker with
 * its Principal and host endpoints), the bundled engine started by the
 * product's PrincipalSession with the trusted extension, the model-facing CLI
 * the extension starts, and the product's PrincipalDelivery. The model is an
 * OpenAI-compatible endpoint answering from a script (fixtures/
 * scripted-provider.ts), so a scenario decides what the model does and the
 * product decides everything else. Assertions are on durable facts: ledger
 * rows, mailbox files, receipts and the session history.
 *
 * Not provider evidence (P0-5): how a real provider streams, fails and is
 * retried is the engine's (INF-001).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withScenario } from "./fixtures/scenario.js";
import { call, continuesTurn, delayed, failing, lastUserText, text, textOf, toolResults, tools, type ChatRequest, type Reply } from "./fixtures/scripted-provider.js";
import { principalSessionDir, principalWorkspace } from "@oma/engine/principal-session";

const TIMEOUT = { timeout: 120_000 };

/** The newest tool result the engine handed the model. */
const lastResult = (request: ChatRequest | undefined): string => toolResults(request ?? { messages: [] }).at(-1)?.text ?? "";

test("SCN-P01: a Human asks about code; the Principal reads canonical main without orchestration", TIMEOUT, async () => {
  // mail-v1: the Principal reads code only as a review request's patch; an
  // unknown name answers with the visibility refusal, not a listing.
  await withScenario({ residents: ["worker-a"], script: [tools(call("oma_merge", { action: "diff", name: "merge-01234567-0000-4000-8000-000000000000" })), text("코드를 확인했습니다.")] }, async s => {
    const turn = await s.prompt("현재 프로젝트 코드를 확인해줘");
    assert.equal(s.provider.seen.length, 2, "the model was not asked again with the tool's result");
    const offered = (s.provider.seen[0]!.body.tools ?? []).map(tool => tool.function?.name);
    for (const name of ["oma_merge", "oma_challenge", "oma_mail_send", "oma_mail_read"]) assert.ok(offered.includes(name), `${name} was not offered to the model`);
    for (const name of ["bash", "write", "edit", "oma_status", "oma_mail_ack", "oma_agent_create", "oma_git", "oma_review_decide"]) assert.ok(!offered.includes(name), name);
    const result = lastResult(s.provider.seen[1]!.body);
    assert.match(result, /CAPABILITY_DENIED|Insufficient permission/, result);
    assert.ok(continuesTurn(s.provider.seen[1]!.body));
    assert.ok(turn.lines.some(line => line.includes("코드를 확인했습니다")), JSON.stringify(turn.lines));
  });
});

/** The message id a delivery notice names, in the order it lists them. */
const noticed = (notice: string): string[] => [...notice.matchAll(/path=\/mail\/archive\/cur\/(m-[0-9a-f-]+-\d+):2,/g)].map(match => match[1]!);
/** A receipt the model was handed as a tool result. */
const receiptIn = (result: string): { operation: string; state: string; result?: { message?: string; archivePath?: string } } => {
  const at = result.indexOf("{");
  assert.ok(at >= 0, `the tool result carries no receipt: ${result}`);
  return JSON.parse(result.slice(at)) as { operation: string; state: string; result?: { message?: string; archivePath?: string } };
};

test("SCN-P02: the model sends Korean mail to a Resident; one operation, one delivery, the stored body is what it wrote", TIMEOUT, async () => {
  const body = "API 목록을 정리해 주세요.\n우선순위: 인증 → 결제 ✅";
  await withScenario({ residents: ["worker-a"], script: [
    tools(call("oma_mail_send", { to: ["worker-a"], subject: "작업 요청", body, kind: "question" })), text("보냈습니다."),
  ] }, async s => {
    await s.prompt("worker-a에게 API 정리를 부탁해");
    const receipt = receiptIn(lastResult(s.provider.seen[1]!.body));
    assert.equal(receipt.state, "succeeded");
    const sends = s.operations("principal").filter(row => row.kind === "mail.send");
    assert.equal(sends.length, 1);
    assert.equal(sends[0]!.state, "succeeded");
    const message = receipt.result!.message!;
    assert.deepEqual(s.inbox("worker-a"), [message]);
    assert.equal(s.store.getDelivery(message, "worker-a")?.materialized, 1);
    const stored = s.archived(message);
    assert.match(stored, /^X-OMA-Kind: question/im);
    assert.ok(stored.includes("Subject: =?UTF-8?") || stored.includes("Subject: 작업 요청"), "the subject is not stored");
    // The stored body is what the model wrote, through the transfer encoding.
    const encoded = stored.split("\r\n\r\n").slice(1).join("\r\n\r\n");
    const decoded = /Content-Transfer-Encoding: base64/i.test(stored) ? Buffer.from(encoded.replace(/\r\n/g, ""), "base64").toString("utf8") : encoded;
    assert.equal(decoded.replace(/\r\n/g, "\n").replace(/\n$/, ""), body);
  });
});

test("SCN-P03: mail to the Principal is delivered into its session, read, answered as a reply, and completed once", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const asked = await s.residentSends("worker-a", { to: ["principal"], subject: "질문", body: "어느 API를 쓸까요?", kind: "question" }, "w-q1") as { ok: boolean; result: { result: { message: string } } };
    assert.equal(asked.ok, true);
    const question = asked.result.result.message;
    s.script((request, index) => {
      if (index === 0) {
        const ids = noticed(request.messages.map(textOf).join("\n"));
        return tools(call("oma_mail_read", { messageId: `/mail/archive/cur/${ids[0]}:2,` }));
      }
      if (index === 1) return tools(call("oma_mail_send", { to: ["worker-a"], subject: "Re: 질문", body: "REST로 가세요.", replyTo: question }));
      return text("답장했습니다.");
    });
    const outcome = await s.deliver();
    assert.equal(outcome.kind, "delivered", JSON.stringify(outcome));
    assert.match(lastResult(s.provider.seen[1]!.body), /어느 API를 쓸까요\?/, "the model did not read the question's body");
    // The ledger: presented once, in a completed batch.
    const delivery = s.store.getDelivery(question, "principal")!;
    assert.equal(delivery.presented, 1);
    assert.equal(s.store.getBatch(delivery.batchId!)?.state, "completed");
    assert.deepEqual(s.store.preparedBatches("principal"), []);
    // The reply: one operation, in worker-a's inbox, threaded to the question.
    const reply = receiptIn(lastResult(s.provider.seen[2]!.body)).result!.message!;
    assert.deepEqual(s.inbox("worker-a"), [reply]);
    assert.match(s.archived(reply), new RegExp(`^In-Reply-To: <${question}@demo\\.oma\\.invalid>`, "m"));
    // Nothing is delivered twice.
    assert.equal((await s.deliver()).kind, "idle");
  });
});

test("SCN-P04: Principal delivery and repeated reads never manufacture an acknowledgement", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const sent = await s.residentSends("worker-a", { to: ["principal"], subject: "Report", body: "Finished.", kind: "result" }, "w-r1") as { result: { result: { message: string } } };
    const message = sent.result.result.message;
    s.script([tools(call("oma_mail_read", { messageId: message })), text("Read.")]);
    assert.equal((await s.deliver()).kind, "delivered");
    s.script([tools(call("oma_mail_read", { messageId: message })), text("Read again.")]);
    await s.prompt("Read that message again.");
    assert.match(lastResult(s.provider.seen.at(-1)!.body), /Finished/);
    assert.equal(s.store.getDelivery(message, "principal")?.presented, 1);
    assert.equal(s.store.getDelivery(message, "principal")?.acknowledged, 0);
    assert.equal(s.operations("principal").filter(row => row.kind === "mail.ack").length, 0);
    assert.equal((await s.deliver()).kind, "idle");
  });
});

test("SCN-P05: several Residents' mail arrives as one batch; the model reads the index and every message", TIMEOUT, async () => {
  const residents = ["worker-a", "worker-b", "worker-c"];
  await withScenario({ residents }, async s => {
    const messages: string[] = [];
    for (const [index, name] of residents.entries()) {
      const sent = await s.residentSends(name, { to: ["principal"], subject: `보고 ${index + 1}`, body: `${name}의 결과입니다.`, kind: "result" }, `w-${index}`) as { result: { result: { message: string } } };
      messages.push(sent.result.result.message);
    }
    s.script((request, index) => {
      if (index === 0) return tools(call("oma_mail_read", { messageId: "/inbox.md" }));
      const ids = noticed(request.messages.map(textOf).join("\n"));
      if (index <= ids.length) return tools(call("oma_mail_read", { messageId: ids[index - 1] }));
      return text("세 보고를 모두 읽었습니다.");
    });
    const outcome = await s.deliver();
    assert.deepEqual([outcome.kind, outcome.kind === "delivered" ? outcome.messages : 0], ["delivered", 3]);
    const index = lastResult(s.provider.seen[1]!.body);
    for (const message of messages) assert.ok(index.includes(message), `the index does not list ${message}`);
    const results = toolResults(s.provider.seen.at(-1)!.body).map(result => result.text).join("\n");
    for (const name of residents) assert.ok(results.includes(`${name}의 결과입니다.`), `${name}'s body was not read`);
    for (const message of messages) assert.equal(s.store.getDelivery(message, "principal")?.presented, 1);
  });
});

test("SCN-P06: a Korean body near the body limit is read back whole through the mail tool", TIMEOUT, async () => {
  const body = "가나다라마바사아자차".repeat(8000);
  assert.ok(Buffer.byteLength(body) <= 262144 && Buffer.byteLength(body) > 200_000);
  await withScenario({ residents: ["worker-a"] }, async s => {
    const sent = await s.residentSends("worker-a", { to: ["principal"], subject: "긴 보고", body, kind: "result" }, "w-long") as { ok: boolean; result: { result: { message: string } } };
    assert.equal(sent.ok, true, JSON.stringify(sent));
    const message = sent.result.result.message;
    s.script([tools(call("oma_mail_read", { messageId: message })), text("다 읽었습니다.")]);
    assert.equal((await s.deliver()).kind, "delivered");
    const read = lastResult(s.provider.seen[1]!.body);
    assert.ok(read.includes(body), `the body was not read whole (${read.length} characters came back)`);
  });
});

test("SCN-P07: the path a send result shows is the path the same tool reads back", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    s.script((request, index) => {
      if (index === 0) return tools(call("oma_mail_send", { to: ["worker-a"], subject: "기록", body: "다시 읽을 내용" }));
      if (index === 1) return tools(call("oma_mail_read", { messageId: receiptIn(lastResult(request)).result!.archivePath! }));
      return text("다시 읽었습니다.");
    });
    await s.prompt("보내고 다시 읽어봐");
    assert.match(lastResult(s.provider.seen[2]!.body), /다시 읽을 내용/, "the shown path could not be read back");
  });
});

test("SCN-P08: mail to the society's commons reaches every Resident and not the sender", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a", "worker-b"], script: [
    tools(call("oma_mail_send", { to: ["commons"], subject: "공지", body: "모두 확인하세요.", kind: "alert" })), text("공지했습니다."),
  ] }, async s => {
    await s.prompt("모두에게 공지해");
    const receipt = receiptIn(lastResult(s.provider.seen[1]!.body));
    assert.equal(receipt.state, "succeeded", JSON.stringify(receipt));
    const message = receipt.result!.message!;
    assert.deepEqual(s.inbox("worker-a"), [message]);
    assert.deepEqual(s.inbox("worker-b"), [message]);
    assert.equal(s.store.getDelivery(message, "principal"), null, "the sender was delivered its own notice");
  });
});

/** A mail to the Principal from a Resident, returning its message id. */
async function residentAsks(s: Parameters<Parameters<typeof withScenario>[1]>[0], key: string, body = "확인해 주세요."): Promise<string> {
  const sent = await s.residentSends("worker-a", { to: ["principal"], subject: `요청 ${key}`, body, kind: "question" }, key) as { ok: boolean; result: { result: { message: string } } };
  assert.equal(sent.ok, true, JSON.stringify(sent));
  return sent.result.result.message;
}
/** How many mail.send operations the Principal has in the ledger. */
const principalSends = (s: Parameters<Parameters<typeof withScenario>[1]>[0]) => s.operations("principal").filter(row => row.kind === "mail.send");

for (const [name, broken] of [["a server error", failing(500)], ["a cut stream", { kind: "cut" } as Reply], ["a body that is not the protocol", { kind: "garbage" } as Reply]] as const)
  test(`SCN-F01: the engine gets ${name} before the model acts; whatever the engine does about it, the effect happens at most once and the next prompt runs`, TIMEOUT, async () => {
    await withScenario({ residents: ["worker-a"] }, async s => {
      s.script((request, index) => {
        if (index === 0) return broken;
        return continuesTurn(request) ? text("보냈습니다.") : tools(call("oma_mail_send", { to: ["worker-a"], subject: "재시도", body: "한 번만 가야 합니다.", request: "once-1" }));
      });
      await s.prompt("worker-a에게 보내");
      // Retrying is the engine's (INF-001): it may ask again or end the run.
      assert.ok(principalSends(s).length <= 1, "the mail was sent more than once");
      await s.prompt("다시 보내");
      assert.equal(principalSends(s).length, 1, "the request did not end up sent exactly once");
      assert.equal(s.inbox("worker-a").length, 1);
    });
  });

for (const broken of [{ kind: "disconnect" } as Reply, { kind: "cut" } as Reply, failing(503)])
  for (const recover of [false, true])
    test(`SCN-RETRY: ${broken.kind} retries five times, then ${recover ? "recovers" : "fails"} without replaying a tool`, TIMEOUT, async () => {
      await withScenario({ residents: ["worker-a"] }, async s => {
        s.script((_request, index) => {
          if (index === 0) return tools(call("oma_mail_send", { to: ["worker-a"], subject: "재시도 경계", body: "한 번만" }));
          return recover && index === 6 ? text("연결 복구 완료") : broken;
        });
        const turn = await s.prompt("메일을 보내고 결과를 알려줘");
        assert.equal(s.provider.seen.length, 7, "one tool response, then the initial call and five retries");
        const attempts = turn.events.filter(event => event.type === "auto_retry_start");
        assert.deepEqual(attempts.map(event => [event.attempt, event.maxAttempts]), [1, 2, 3, 4, 5].map(n => [n, 5]));
        const end = turn.events.find(event => event.type === "auto_retry_end");
        assert.equal(end?.success, recover);
        assert.equal(end?.attempt, 5);
        assert.equal(principalSends(s).length, 1);
        assert.equal(s.inbox("worker-a").length, 1);
        assert.ok(turn.lines.some(line => line.includes(recover ? "Model API connection restored" : "Model API failed after 5 retries")));
        for (const seen of s.provider.seen.slice(2))
          assert.deepEqual(toolResults(seen.body), toolResults(s.provider.seen[1]!.body), "the completed tool result must survive retries");
      });
    });

test("SCN-RETRY: closing the session during backoff cancels retries without replaying the completed tool", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    s.script((_request, index) => index === 0
      ? tools(call("oma_mail_send", { to: ["worker-a"], subject: "취소 경계", body: "한 번만" }))
      : failing(503));
    let cancelled = false;
    const off = s.session.onEvent(event => {
      if (event.type === "auto_retry_start" && !cancelled) { cancelled = true; s.session.close(); }
    });
    try {
      assert.equal(s.session.submit("메일을 보내고 응답해 줘").kind, "accepted");
      await s.session.exited;
      assert.equal(cancelled, true, "the test never reached retry backoff");
      assert.equal(s.provider.seen.length, 2, "a cancelled backoff started another provider request");
      assert.equal(principalSends(s).length, 1);
      assert.equal(s.inbox("worker-a").length, 1);
      assert.equal(s.events.some(event => event.type === "auto_retry_end" && event.success === true), false);
    } finally { off(); }
  });
});

test("SCN-RETRY: authentication failure does not retry", TIMEOUT, async () => {
  await withScenario({ script: () => failing(401) }, async s => {
    const refused = await s.prompt("응답해 줘");
    assert.equal(s.provider.seen.length, 1);
    assert.equal(refused.events.filter(event => event.type === "auto_retry_start").length, 0);
  });
});

test("SCN-F02: a delivery whose model never answers is not completed; the mail stays and is presented again, then completed once", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const message = await residentAsks(s, "w-f2");
    s.script(() => failing(503));
    const failed = await s.deliver();
    assert.notEqual(failed.kind, "delivered", JSON.stringify(failed));
    const delivery = s.store.getDelivery(message, "principal")!;
    assert.equal(delivery.presented, 0, "a delivery the model never answered was recorded as presented");
    assert.equal(s.store.preparedBatches("principal").length, 1, "the batch was not kept for the next attempt");
    s.script([text("이제 받았습니다.")]);
    const retried = await s.deliver();
    assert.equal(retried.kind, "delivered", JSON.stringify(retried));
    assert.equal(s.store.getDelivery(message, "principal")?.presented, 1);
    assert.deepEqual(s.store.preparedBatches("principal"), []);
    assert.equal((await s.deliver()).kind, "idle", "the mail was presented a third time");
  });
});

test("SCN-F03: tool arguments that are not JSON reach the model as a failed call; its corrected call sends once", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    s.script((request, index) => {
      if (index === 0) return tools({ name: "oma_mail_send", args: null, raw: "{\"to\": [\"worker-a\"], \"subject\": " });
      if (index === 1) return tools(call("oma_mail_send", { to: ["worker-a"], subject: "고친 요청", body: "이번엔 맞습니다." }));
      return text("보냈습니다.");
    });
    await s.prompt("보내");
    assert.equal(principalSends(s).length, 1);
    assert.deepEqual(s.inbox("worker-a").length, 1);
  });
});

test("SCN-F04: mail to an address that does not exist is refused to the model and records nothing", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"], script: [
    tools(call("oma_mail_send", { to: ["nobody"], subject: "없는 주소", body: "x" })), text("그런 agent가 없습니다."),
  ] }, async s => {
    await s.prompt("nobody에게 보내");
    // The routing owner answers, before acceptance, and says which name (P0-2).
    assert.match(lastResult(s.provider.seen[1]!.body), /ADDRESS_NOT_FOUND/, lastResult(s.provider.seen[1]!.body));
    const refused = await s.residentSends("worker-a", { to: ["worker-a", "nobody"], subject: "x", body: "x" }, "w-f4") as { ok: boolean; error: { code: string } };
    assert.deepEqual([refused.ok, refused.error.code], [false, "ADDRESS_NOT_FOUND"]);
    assert.equal(principalSends(s).filter(row => row.state === "succeeded").length, 0);
    assert.deepEqual(readdirSync(join(s.root, "mail", "archive", "cur")), []);
  });
});

test("SCN-F05: a model that repeats a send with the same request key gets the first receipt, not a second mail", TIMEOUT, async () => {
  const send = call("oma_mail_send", { to: ["worker-a"], subject: "한 번", body: "같은 key", request: "same-key-1" });
  await withScenario({ residents: ["worker-a"], script: [tools(send), tools(send), text("두 번 불렀습니다.")] }, async s => {
    await s.prompt("보내고, 확실하게 한 번 더 보내");
    const [first, second] = toolResults(s.provider.seen[2]!.body).map(result => receiptIn(result.text));
    assert.equal(first!.operation, second!.operation, "the repeat was a new operation");
    assert.equal(principalSends(s).length, 1);
    assert.equal(s.inbox("worker-a").length, 1);
  });
});

test("SCN-F06: a send while the broker is down is 'outcome unknown' with its key; after the restart, the same key sends it once", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    await s.stopBroker();
    s.script([tools(call("oma_mail_send", { to: ["worker-a"], subject: "중단 중", body: "다시 보낼 내용", request: "outage-1" })), text("나중에 다시 보내겠습니다.")]);
    await s.prompt("worker-a에게 보내");
    const unknown = lastResult(s.provider.seen[1]!.body);
    assert.match(unknown, /outage-1/, `the tool did not name the key to ask again with: ${unknown}`);
    assert.doesNotMatch(unknown, /"state":"succeeded"/);
    await s.restartBroker();
    s.script([tools(call("oma_mail_send", { to: ["worker-a"], subject: "중단 중", body: "다시 보낼 내용", request: "outage-1" })), text("보냈습니다.")]);
    await s.prompt("이제 다시 보내");
    const receipt = receiptIn(lastResult(s.provider.seen.at(-1)!.body));
    assert.equal(receipt.state, "succeeded", JSON.stringify(receipt));
    assert.equal(principalSends(s).length, 1);
    assert.equal(principalSends(s)[0]!.request_key, "outage-1");
    assert.equal(s.inbox("worker-a").length, 1);
  });
});

test("SCN-F07: after a broker restart the engine is registered again and authenticated tools keep working", TIMEOUT, async () => {
  const open = tools(call("oma_society", { action: "open", request: "open-f07" }));
  await withScenario({ residents: ["worker-a"], script: [open, text("Open."), open, text("Still open.")] }, async s => {
    await s.prompt("Open Worker execution.");
    const original = receiptIn(lastResult(s.provider.seen[1]!.body)); assert.equal(original.state, "succeeded");
    await s.restartBroker(); await s.prompt("Look up the same request.");
    assert.deepEqual(receiptIn(lastResult(s.provider.seen[3]!.body)), original);
    assert.equal(s.operations("principal").filter(row => row.kind === "society.set").length, 1);
  });
});

test("SCN-F08: an engine killed in the middle of a delivery loses no mail; the next session gets it and completes it once", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const message = await residentAsks(s, "w-f8");
    s.script(() => ({ kind: "hang" }));
    const pending = s.tick();
    const deadline = Date.now() + 20_000;
    while (s.provider.seen.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(s.provider.seen.length, 1, "the delivery never reached the model");
    await s.restartEngine("SIGKILL");
    const first = await pending;
    assert.notEqual(first.kind, "delivered", JSON.stringify(first));
    assert.equal(s.store.getDelivery(message, "principal")?.presented, 0);
    s.script([text("다시 받았습니다.")]);
    const again = await s.deliver();
    assert.ok(again.kind === "delivered" || again.kind === "settled", JSON.stringify(again));
    if (again.kind === "settled") assert.equal((await s.deliver()).kind, "idle");
    assert.equal(s.store.getDelivery(message, "principal")?.presented, 1);
    assert.deepEqual(s.store.preparedBatches("principal"), []);
  });
});

test("SCN-F09: a Human prompt typed during a delivery waits for it and then runs, once", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const message = await residentAsks(s, "w-f9");
    s.script((request) => {
      if (lastUserText(request).includes("사람의 질문")) return text("사람에게 답합니다.");
      return delayed(800, text("전달된 메일을 처리했습니다."));
    });
    const pending = s.tick();
    const deadline = Date.now() + 20_000;
    while (!s.session.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    const outcome = s.session.submit("사람의 질문입니다");
    assert.equal(outcome.kind, "accepted");
    const delivered = await pending;
    assert.equal(delivered.kind, "delivered", JSON.stringify(delivered));
    await s.idle();
    const humanTurns = s.provider.seen.filter(entry => lastUserText(entry.body).includes("사람의 질문"));
    assert.equal(humanTurns.length, 1, "the Human's prompt was not run exactly once");
    const deliveryTurn = s.provider.seen.findIndex(entry => lastUserText(entry.body).includes("path=/mail/archive/cur/"));
    const humanTurn = s.provider.seen.findIndex(entry => lastUserText(entry.body).includes("사람의 질문"));
    assert.ok(deliveryTurn >= 0 && deliveryTurn < humanTurn, "the Human's prompt was folded into the delivery's run");
    assert.equal(s.store.getDelivery(message, "principal")?.presented, 1);
  });
});

test("SCN-F10: the model cannot write the Human's session history or read it", TIMEOUT, async () => {
  await withScenario({}, async s => {
    const history = principalSessionDir(s.root);
    const target = join(history, "planted.jsonl");
    s.script([tools(call("write", { path: target, content: "{}" })), tools(call("read", { path: history })), text("못 했습니다.")]);
    await s.prompt("세션 기록에 써봐");
    assert.equal(existsSync(target), false, "the model wrote into the session history");
    const results = toolResults(s.provider.seen[2]!.body).map(result => result.text);
    assert.equal(results.length, 2);
    for (const result of results) assert.doesNotMatch(result, /"type":"session"/, "the model read the session history");
  });
});

test("SCN-F11: a provider that stops answering mid-turn does not wedge the session; the next prompt runs", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    s.script((_request, index) => (index < 3 ? { kind: "hang" } : text("이제 답합니다.")));
    await s.prompt("응답해", 60_000);
    s.script([tools(call("oma_merge", { action: "diff", name: "merge-01234567-0000-4000-8000-000000000000" })), text("상태 확인")]);
    await s.prompt("상태", 30_000);
    assert.match(lastResult(s.provider.seen.at(-1)!.body), /CAPABILITY_DENIED|Insufficient permission/);
  });
});

test("SCN-L01: delegate, get a reply, read it, follow up, report -- every fact recorded once and threaded", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    // 1. The Human delegates; the model asks worker-a.
    s.script([tools(call("oma_mail_send", { to: ["worker-a"], subject: "로그인 버그", body: "재현하고 원인을 알려주세요.", kind: "question", request: "task-1" })), text("worker-a에게 맡겼습니다.")]);
    await s.prompt("로그인 버그를 worker-a에게 맡겨");
    const task = receiptIn(lastResult(s.provider.seen[1]!.body)).result!.message!;
    // 2. worker-a answers as a reply to the task.
    const answered = await s.residentSends("worker-a", { to: ["principal"], subject: "Re: 로그인 버그", body: "세션 만료 처리 누락입니다.", kind: "result", replyTo: task }, "w-l1") as { ok: boolean; result: { result: { message: string } } };
    assert.equal(answered.ok, true, JSON.stringify(answered));
    const answer = answered.result.result.message;
    // 3. Delivered; the model reads it and follows up in the same thread.
    s.script((request, index) => {
      if (index === 0) return tools(call("oma_mail_read", { messageId: noticed(request.messages.map(textOf).join("\n"))[0]! }));
      if (index === 1) return tools(call("oma_mail_send", { to: ["worker-a"], subject: "Re: 로그인 버그", body: "수정해서 제출해 주세요.", replyTo: answer, request: "follow-1" }));
      return text("원인을 받았고 수정을 요청했습니다.");
    });
    assert.equal((await s.deliver()).kind, "delivered");
    // 4. The Human asks; the model reports from the Worker reply, not status.
    s.script([tools(call("oma_mail_read", { messageId: answer })), text("진행 중입니다.")]);
    await s.prompt("진행 상황은?");
    // The ledger holds each fact once.
    const kinds = s.operations("principal").map(row => `${row.kind}:${row.request_key}:${row.state}`).sort();
    assert.deepEqual(kinds, ["mail.send:follow-1:succeeded", "mail.send:task-1:succeeded"]);
    assert.equal(s.store.getDelivery(answer, "principal")?.acknowledged, 0);
    assert.equal(s.store.getDelivery(answer, "principal")?.presented, 1);
    // The thread: the follow-up names the answer, and the answer the task.
    const followUp = s.inbox("worker-a").find(name => name !== task)!;
    assert.match(s.archived(answer), new RegExp(`^In-Reply-To: <${task}@demo\\.oma\\.invalid>`, "m"));
    assert.match(s.archived(followUp), new RegExp(`^In-Reply-To: <${answer}@demo\\.oma\\.invalid>`, "m"));
    // Folded header lines are one header (RFC 5322).
    const unfolded = s.archived(followUp).replace(/\r\n[ \t]+/g, " ");
    assert.match(unfolded, new RegExp(`^References: <${task}@demo\\.oma\\.invalid> <${answer}@demo\\.oma\\.invalid>`, "m"));
    assert.deepEqual(s.store.preparedBatches("principal"), []);
  });
});

test("SCN-L02: the broker and the engine both restart mid-loop; the resumed session keeps the conversation and gets the reply", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    s.script([tools(call("oma_mail_send", { to: ["worker-a"], subject: "배포 준비", body: "체크리스트를 만들어 주세요.", request: "task-l2" })), text("요청했습니다.")]);
    await s.prompt("배포 준비를 worker-a에게 요청해");
    await s.restartBroker();
    await s.restartEngine("SIGKILL");
    await s.residentSends("worker-a", { to: ["principal"], subject: "Re: 배포 준비", body: "체크리스트 완료.", kind: "result" }, "w-l2");
    const seenBefore = s.provider.seen.length;
    s.script([text("체크리스트를 받았습니다.")]);
    const delivery = await s.deliver();
    assert.equal(delivery.kind, "delivered", JSON.stringify({ delivery, lines: s.lines.slice(-16), events: s.events.slice(-8) }));
    const resumed = s.provider.seen[seenBefore]!.body.messages.map(textOf).join("\n");
    assert.ok(resumed.includes("배포 준비를 worker-a에게 요청해"), "the new engine did not resume the conversation (AV14)");
    assert.ok(resumed.includes("체크리스트 완료") || /path=\/mail\/archive\/cur\//.test(resumed), "the delivery did not reach the resumed session");
    assert.equal(s.operations("principal").filter(row => row.kind === "mail.send").length, 1);
  });
});

test("SCN-L03: five rounds of mail, delivery and reading leave nothing prepared and nothing presented twice", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const messages: string[] = [];
    for (let round = 1; round <= 5; round += 1) {
      const message = await residentAsks(s, `w-round-${round}`, `라운드 ${round}`);
      messages.push(message);
      s.script([tools(call("oma_mail_read", { messageId: message })), text(`라운드 ${round} 확인`)]);
      assert.equal((await s.deliver()).kind, "delivered", `round ${round}`);
    }
    for (const message of messages) {
      const delivery = s.store.getDelivery(message, "principal")!;
      assert.deepEqual([delivery.presented, delivery.acknowledged], [1, 0]);
    }
    const notices = s.provider.seen.filter(entry => /path=\/mail\/archive\/cur\//.test(lastUserText(entry.body)) && !continuesTurn(entry.body));
    assert.equal(notices.length, 5, "a notice was presented more or less than once per round");
    assert.equal((await s.deliver()).kind, "idle");
  });
});

test("SCN-L04: a topic reaches the Residents that follow it and nobody else", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a", "worker-b"] }, async s => {
    const agent = s.store.getAgent("worker-b")!;
    const followed = await s.broker.dispatch({ actor: "worker-b", incarnation: agent.incarnation, role: "resident", channel: "actor",
      capabilities: new Set(["route.follow"]), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } },
    { v: 1, id: "follow", method: "route.follow", request: "follow-design", params: { topic: "design" } } as never, null) as { ok: boolean };
    assert.equal(followed.ok, true, JSON.stringify(followed));
    s.script([tools(call("oma_mail_send", { to: ["topic/design"], subject: "디자인 리뷰", body: "시안을 봐 주세요." })), text("알렸습니다.")]);
    await s.prompt("디자인 토픽에 알려");
    const message = receiptIn(lastResult(s.provider.seen[1]!.body)).result!.message!;
    assert.deepEqual(s.inbox("worker-b"), [message]);
    assert.deepEqual(s.inbox("worker-a"), []);
  });
});

test("SCN-F12: a call to a tool that does not exist changes nothing and the turn still ends", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"], script: [tools(call("oma_delete_everything", { all: true })), text("그런 도구는 없습니다.")] }, async s => {
    const turn = await s.prompt("다 지워");
    assert.ok(turn.lines.some(line => line.includes("그런 도구는 없습니다")));
    assert.deepEqual(s.operations("principal"), []);
    assert.match(lastResult(s.provider.seen[1]!.body), /not found|unknown|없/i);
  });
});

test("SCN-F13: a model's answer larger than a frame does not end the session; its oversized send is refused and nothing is recorded", TIMEOUT, async () => {
  const body = "x".repeat(262144 + 1);
  await withScenario({ residents: ["worker-a"], script: [tools(call("oma_mail_send", { to: ["worker-a"], subject: "너무 김", body })), text("너무 깁니다.")] }, async s => {
    const turn = await s.prompt("긴 메일 보내");
    // DR15: the engine's event carrying the whole call is larger than the frame.
    assert.ok(turn.lines.some(line => line.includes("exceeded the display limit")), JSON.stringify(turn.lines));
    assert.ok(s.session.running, "the session ended on an oversized event");
    assert.doesNotMatch(lastResult(s.provider.seen[1]!.body), /"state":"succeeded"/);
    assert.equal(s.operations("principal").filter(row => row.state === "succeeded").length, 0);
    assert.deepEqual(s.inbox("worker-a"), []);
    // The session goes on.
    s.script([tools(call("oma_merge", { action: "diff", name: "merge-01234567-0000-4000-8000-000000000000" })), text("계속 동작합니다.")]);
    await s.prompt("상태");
    assert.match(lastResult(s.provider.seen.at(-1)!.body), /CAPABILITY_DENIED|Insufficient permission/);
  });
});

test("SCN-F17: an oversized attempted Principal write is refused and the session goes on", TIMEOUT, async () => {
  const content = "데이터 행입니다\n".repeat(20_000);
  await withScenario({ script: [tools(call("write", { path: "big-data.txt", content })), text("썼습니다.")] }, async s => {
    await s.prompt("큰 파일을 써");
    assert.ok(s.session.running, "writing a large file ended the session");
    assert.equal(existsSync(join(principalWorkspace(s.root), "big-data.txt")), false);
    assert.match(lastResult(s.provider.seen.at(-1)!.body), /not found|not available|unknown tool/i);
  });
});

test("SCN-F14: two sends the model makes in one answer both land, each once, each under its own key", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a", "worker-b"], script: [
    tools(call("oma_mail_send", { to: ["worker-a"], subject: "A", body: "A에게", request: "par-a" }), call("oma_mail_send", { to: ["worker-b"], subject: "B", body: "B에게", request: "par-b" })),
    text("둘 다 보냈습니다."),
  ] }, async s => {
    await s.prompt("둘에게 동시에 보내");
    const sends = s.operations("principal").filter(row => row.kind === "mail.send").map(row => `${row.request_key}:${row.state}`).sort();
    assert.deepEqual(sends, ["par-a:succeeded", "par-b:succeeded"]);
    assert.equal(s.inbox("worker-a").length, 1);
    assert.equal(s.inbox("worker-b").length, 1);
  });
});

test("SCN-F15: the broker restarts while a delivery's run is going; the mail ends presented once and completed", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const message = await residentAsks(s, "w-f15");
    s.script(() => delayed(1500, text("처리했습니다.")));
    const pending = s.tick();
    const deadline = Date.now() + 20_000;
    while (s.provider.seen.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    await s.restartBroker();
    const first = await pending;
    await s.idle();
    s.script([text("다시 확인했습니다.")]);
    for (let attempt = 0; attempt < 3 && s.store.getDelivery(message, "principal")?.presented !== 1; attempt += 1) await s.deliver();
    assert.equal(s.store.getDelivery(message, "principal")?.presented, 1, `first tick ${JSON.stringify(first)}`);
    assert.deepEqual(s.store.preparedBatches("principal"), []);
    const notices = s.provider.seen.filter(entry => /path=\/mail\/archive\/cur\//.test(lastUserText(entry.body)) && !continuesTurn(entry.body));
    assert.ok(notices.length >= 1);
  });
});

test("SCN-F16: mail that arrives while a delivery runs is delivered by the next step, not folded into the running one", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a", "worker-b"] }, async s => {
    const first = await residentAsks(s, "w-f16a");
    s.script(() => delayed(800, text("처리했습니다.")));
    const pending = s.tick();
    const deadline = Date.now() + 20_000;
    while (s.provider.seen.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    const later = await s.residentSends("worker-b", { to: ["principal"], subject: "늦게 온 메일", body: "나중에", kind: "message" }, "w-f16b") as { result: { result: { message: string } } };
    assert.equal((await pending).kind, "delivered");
    await s.idle();
    const second = later.result.result.message;
    assert.equal(s.store.getDelivery(second, "principal")?.presented, 0, "the later mail was folded into the running delivery");
    s.script([text("늦은 메일도 받았습니다.")]);
    assert.equal((await s.deliver()).kind, "delivered");
    assert.equal(s.store.getDelivery(first, "principal")?.presented, 1);
    assert.equal(s.store.getDelivery(second, "principal")?.presented, 1);
    assert.notEqual(s.store.getDelivery(first, "principal")?.batchId, s.store.getDelivery(second, "principal")?.batchId);
  });
});

test("SCN-P10: reading a message that does not exist is refused to the model and changes nothing", TIMEOUT, async () => {
  await withScenario({ residents: ["worker-a"], script: [
    tools(call("oma_mail_read", { messageId: "m-00000000-0000-4000-8000-00000000dead-0" }), call("oma_mail_read", { messageId: "../../etc/passwd" })),
    text("그런 메일은 없습니다."),
  ] }, async s => {
    const turn = await s.prompt("그 메일 읽어");
    const [missing, escaped] = toolResults(s.provider.seen[1]!.body).map(result => result.text);
    assert.doesNotMatch(missing!, /root:/);
    assert.doesNotMatch(escaped!, /root:x:0/, "a path outside the archive was read");
    assert.ok(turn.lines.some(line => line.includes("그런 메일은 없습니다")));
    assert.deepEqual(s.operations(), []);
  });
});
