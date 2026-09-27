/** Scenario tests: confined Residents and their Git work, with only the model scripted.
 *
 * The society declares its generated rootfs, so the product's runner starts a
 * Resident's engine under bubblewrap exactly as a deployment does: the
 * trusted extension, bash, the `oma` CLI on the pinned Node, no network, and
 * the provider reached only through the runner's relay, which swaps the
 * placeholder the sandbox holds for the key. The scripted provider speaks
 * TLS as one of the engine's own catalogue providers (fixtures/
 * scripted-provider.ts), and the broker has its Git module, so a Resident's
 * commit, `oma submit` and `oma integrate` run through quarantine and CAS.
 * Not provider evidence (P0-5; INF-001).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withScenario, type Scenario } from "./fixtures/scenario.js";
import { SCRIPTED_KEY, call, continuesTurn, text, textOf, toolResults, tools, type ChatRequest } from "./fixtures/scripted-provider.js";
import { projectGitPathAt } from "../src/storage/paths.js";
import { principalWorkspace } from "../src/tui/session.js";

const bwrap = spawnSync("bwrap", ["--version"]).status === 0;
const OPTIONS = { timeout: 180_000, skip: bwrap ? false : "bubblewrap is not installed on this host" };
const isResident = (request: ChatRequest): boolean => !(request.tools ?? []).some(tool => tool.function?.name === "oma_agent_create");
const lastResult = (request: ChatRequest | undefined): string => toolResults(request ?? { messages: [] }).at(-1)?.text ?? "";
const git = (s: Scenario, ...args: string[]): string => execFileSync("git", ["--git-dir", projectGitPathAt(s.root), ...args], { encoding: "utf8" }).trim();
const bash = (command: string) => tools(call("bash", { command }));
const receiptIn = (result: string): { operation: string; state: string; result?: Record<string, string> } => {
  const at = result.indexOf("{");
  assert.ok(at >= 0, `the tool result carries no receipt: ${result}`);
  return JSON.parse(result.slice(at, result.lastIndexOf("}") + 1)) as { operation: string; state: string; result?: Record<string, string> };
};
async function assign(s: Scenario, to: string, body: string, key: string): Promise<string> {
  const principal = s.store.getAgent("principal")!;
  const sent = await s.broker.dispatch({ actor: "principal", incarnation: principal.incarnation, role: "principal", channel: "actor",
    capabilities: new Set(["mail.send"]), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } },
  { v: 1, id: key, method: "mail.send", request: key, params: { to: [to], subject: "작업", kind: "message", body } } as never, null) as { ok: boolean; result: { result: { message: string } } };
  assert.equal(sent.ok, true, JSON.stringify(sent));
  return sent.result.result.message;
}
const COMMIT = "cd /workspace && echo fixed > fix.txt && git add fix.txt && git -c user.name=worker -c user.email=w@example.invalid commit -qm fix";

test("SCN-C01: a confined Resident commits and submits; the candidate is published, and the Principal gets the result mail", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    await assign(s, "worker-a", "fix.txt를 만들어 제출하세요.", "c01");
    s.script(request => (continuesTurn(request) ? text("제출했습니다.")
      : bash(`${COMMIT} && oma submit HEAD --to principal --subject '수정 제출' --request sub-c01`)));
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const receipt = receiptIn(lastResult(s.provider.seen.filter(entry => isResident(entry.body))[1]!.body));
    assert.equal(receipt.state, "succeeded", JSON.stringify(receipt));
    const published = receipt.result!.publishedRef!;
    assert.match(published, /^refs\/oma\/published\/worker-a\//);
    assert.equal(git(s, "rev-parse", published), receipt.result!.candidate);
    assert.equal(git(s, "show", `${published}:fix.txt`), "fixed");
    assert.equal(s.operations("worker-a").filter(row => row.kind === "git.submit").length, 1);
    // The result mail tells the Principal how to fetch it (CLI-002).
    const [result] = s.inbox("principal");
    assert.ok(result, "the Principal got no result mail");
    s.script(request => (continuesTurn(request) ? text("제출을 확인했습니다.") : tools(call("oma_mail_read", { messageId: result! }))));
    assert.equal((await s.deliver()).kind, "delivered");
    assert.ok(lastResult(s.provider.seen.at(-1)!.body).includes(published), "the result mail does not name the published ref");
  });
});

test("SCN-C02: inside the sandbox the provider key is only a placeholder; the relay hands the provider the real one", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    await assign(s, "worker-a", "환경을 확인하세요.", "c02");
    s.script(request => (continuesTurn(request) ? text("확인했습니다.") : bash("env; cat ~/.pi/agent/models.json 2>&1; ls / /workspace")));
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const resident = s.provider.seen.filter(entry => isResident(entry.body));
    const inside = lastResult(resident[1]!.body);
    assert.ok(inside.length > 0);
    assert.ok(!inside.includes(SCRIPTED_KEY), "the real key is visible inside the sandbox");
    for (const entry of resident) assert.equal(entry.authorization, `Bearer ${SCRIPTED_KEY}`, "the provider did not receive the real key");
    assert.ok(!resident[0]!.body.messages.map(textOf).join("\n").includes(SCRIPTED_KEY));
  });
});

test("SCN-C03: submitting the same request twice publishes one candidate under one operation", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    await assign(s, "worker-a", "두 번 제출해 보세요.", "c03");
    const submit = "oma submit HEAD --to principal --subject '반복' --request sub-c03";
    s.script((request, index) => (index === 0 ? bash(`${COMMIT} && ${submit} && ${submit}`) : text("두 번 불렀습니다.")));
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const results = lastResult(s.provider.seen.filter(entry => isResident(entry.body))[1]!.body);
    const operations = [...results.matchAll(/"operation":"(op-[0-9a-f-]+)"/g)].map(match => match[1]);
    assert.equal(operations.length, 2, results);
    assert.equal(operations[0], operations[1], "the repeat was a second operation");
    assert.equal(s.operations("worker-a").filter(row => row.kind === "git.submit").length, 1);
    assert.equal(git(s, "for-each-ref", "refs/oma/published/").split("\n").filter(Boolean).length, 1);
    assert.equal(s.inbox("principal").length, 1, "the Principal was told twice");
  });
});

test("SCN-C04: a Resident integrates its published candidate with the right expectation; main moves exactly there", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true, integrate: true }, async s => {
    const before = git(s, "rev-parse", "refs/heads/main");
    await assign(s, "worker-a", "제출하고 통합하세요.", "c04");
    s.script((request, index) => {
      if (index === 0) return bash(`${COMMIT} && oma submit HEAD --to principal --subject '통합 대상' --request sub-c04`);
      if (index === 1) {
        const candidate = receiptIn(lastResult(request)).result!.candidate!;
        return bash(`oma integrate ${candidate} --expect ${before} --request int-c04`);
      }
      return text("통합했습니다.");
    });
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const integrated = receiptIn(lastResult(s.provider.seen.filter(entry => isResident(entry.body))[2]!.body));
    assert.equal(integrated.state, "succeeded", JSON.stringify(integrated));
    const candidate = git(s, "for-each-ref", "--format=%(objectname)", "refs/oma/published/");
    assert.equal(git(s, "rev-parse", "refs/heads/main"), candidate, "main did not move to the candidate");
    assert.equal(s.operations("worker-a").filter(row => row.kind === "git.integrate" && row.state === "succeeded").length, 1);
  });
});

test("SCN-C05: an integration against a main that has moved is refused with the actual main, and changes nothing", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true, integrate: true }, async s => {
    const main = git(s, "rev-parse", "refs/heads/main");
    await assign(s, "worker-a", "잘못된 기대로 통합해 보세요.", "c05");
    const stale = "b".repeat(40);
    s.script((request, index) => {
      if (index === 0) return bash(`${COMMIT} && oma submit HEAD --to principal --subject '대상' --request sub-c05`);
      if (index === 1) return bash(`oma integrate ${receiptIn(lastResult(request)).result!.candidate!} --expect ${stale} --request int-c05; echo "exit=$?"`);
      return text("거절됐습니다.");
    });
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const refused = lastResult(s.provider.seen.filter(entry => isResident(entry.body))[2]!.body);
    assert.match(refused, /STALE_BASE|NOT_DESCENDANT|PREREQUISITE_MISSING|INVALID/, refused);
    assert.match(refused, /exit=2/, "a refused integration did not exit as a settled failure (CLI-003)");
    assert.equal(git(s, "rev-parse", "refs/heads/main"), main, "main moved on a refused integration");
  });
});

test("SCN-C06: the Principal publishes the shared context; a confined Resident reads it from /world", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    const goal = join(principalWorkspace(s.root), "context");
    mkdirSync(goal, { recursive: true });
    writeFileSync(join(goal, "GOAL.md"), "# 목표\n로그인 오류를 없앤다.\n");
    s.script(request => (continuesTurn(request) ? text("게시했습니다.")
      : tools(call("oma_context_publish", { directory: goal, expect: "none", request: "ctx-1" }))));
    await s.prompt("목표를 게시해");
    const published = receiptIn(lastResult(s.provider.seen[1]!.body));
    assert.equal(published.state, "succeeded", JSON.stringify(published));
    await assign(s, "worker-a", "목표를 읽으세요.", "c06");
    s.script(request => (continuesTurn(request) ? text("읽었습니다.") : bash("cat /world/context/current/GOAL.md")));
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    assert.match(lastResult(s.provider.seen.at(-1)!.body), /로그인 오류를 없앤다/);
  });
});

test("SCN-C07: without Worker integrate a Resident's integration is refused and main does not move (AUTH-001)", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    const main = git(s, "rev-parse", "refs/heads/main");
    await assign(s, "worker-a", "통합해 보세요.", "c07");
    s.script((request, index) => {
      if (index === 0) return bash(`${COMMIT} && oma submit HEAD --to principal --subject '대상' --request sub-c07`);
      if (index === 1) return bash(`oma integrate ${receiptIn(lastResult(request)).result!.candidate!} --expect ${main} --request int-c07; echo "exit=$?"`);
      return text("권한이 없습니다.");
    });
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const refused = lastResult(s.provider.seen.filter(entry => isResident(entry.body))[2]!.body);
    assert.match(refused, /CAPABILITY_DENIED/, refused);
    assert.match(refused, /exit=2/);
    assert.equal(git(s, "rev-parse", "refs/heads/main"), main);
  });
});
