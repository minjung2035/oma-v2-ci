/** Scenario tests: confined Residents and their Git work, with only the model scripted.
 *
 * The society declares its generated rootfs, so the product's runner starts a
 * Resident's engine under bubblewrap exactly as a deployment does: the
 * trusted extension, bash, the `oma` CLI on the pinned Node, no network, and
 * the provider reached only through the runner's relay, which swaps the
 * placeholder the sandbox holds for the key. The scripted provider speaks
 * TLS as one of the engine's own catalogue providers (fixtures/
 * scripted-provider.ts), and the broker has its Git module, so a Resident's
 * commit, `oma submit` and `oma merge open` run through quarantine, review
 * and CAS. Not provider evidence (P0-5; INF-001).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withScenario, type Scenario } from "./fixtures/scenario.js";
import { SCRIPTED_KEY, call, continuesTurn, text, textOf, toolResults, tools, type ChatRequest } from "./fixtures/scripted-provider.js";
import { projectGitPathAt } from "@oma/domain/paths";
import { commitRoleSet, readSettings, readSettingsForEditing, roleSetOf, writeSettings } from "#oma-test/app/application/settings";

import { RESIDENT_TEST_OPTIONS as OPTIONS } from "./fixtures/resident.js";
const isResident = (request: ChatRequest): boolean => !(request.tools ?? []).some(tool => tool.function?.name === "oma_society");
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
    capabilities: new Set(["mail.send"]), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } },
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
    for (const line of ["LANG=C.UTF-8", "LC_ALL=C.UTF-8", "TZ=UTC", "TERM=xterm-256color", "TMPDIR=/tmp", "SHELL=/bin/sh", "USER=agent", "LOGNAME=agent", "XDG_DATA_HOME=/home/agent/.local/share", "XDG_RUNTIME_DIR=/home/agent/.run"])
      assert.ok(inside.split("\n").includes(line), `missing normalized env: ${line}`);
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

test("SCN-C04: a Resident's LOW merge request applies itself; main moves exactly to its candidate", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    const before = git(s, "rev-parse", "refs/heads/main");
    await assign(s, "worker-a", "제출하고 통합하세요.", "c04");
    s.script((request, index) => {
      if (index === 0) return bash(`${COMMIT} && echo 통합 > /tmp/reason.md && oma merge open --tier LOW --title 통합 --file /tmp/reason.md --request mrg-c04`);
      return text("통합했습니다.");
    });
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const opened = receiptIn(lastResult(s.provider.seen.filter(entry => isResident(entry.body))[1]!.body));
    assert.equal(opened.state, "succeeded", JSON.stringify(opened));
    const candidate = git(s, "for-each-ref", "--format=%(objectname)", "refs/oma/published/");
    assert.equal(git(s, "rev-parse", "refs/heads/main"), candidate, "main did not move to the candidate");
    assert.notEqual(git(s, "rev-parse", "refs/heads/main"), before);
    assert.equal(s.operations("worker-a").filter(row => row.kind === "git.integrate" && row.state === "succeeded").length, 1);
  });
});

test("SCN-C05: a merge open on a base main has left is refused with the actual main, and changes nothing", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    const main = git(s, "rev-parse", "refs/heads/main");
    await assign(s, "worker-a", "지난 기준으로 통합해 보세요.", "c05");
    s.script((request, index) => {
      // The workspace's origin/main stays at the fetched base; after the first
      // request applies, opening on it is stale.
      if (index === 0) return bash(`${COMMIT} && echo 첫번째 > /tmp/r1.md && oma merge open --tier LOW --title 첫번째 --file /tmp/r1.md --request mrg-c05a`);
      if (index === 1) return bash(`${COMMIT.replace("echo fixed", "echo second")} && echo 두번째 > /tmp/r2.md && oma merge open --tier LOW --title 두번째 --file /tmp/r2.md --base refs/remotes/origin/main --request mrg-c05b; echo "exit=$?"`);
      return text("거절됐습니다.");
    });
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const refused = lastResult(s.provider.seen.filter(entry => isResident(entry.body))[2]!.body);
    assert.match(refused, /STALE_BASE/, refused);
    assert.match(refused, /exit=2/, "a refused open did not exit as a settled failure (CLI-003)");
    const after = git(s, "rev-parse", "refs/heads/main");
    assert.notEqual(after, main, "the first LOW merge should have applied");
    assert.equal(s.operations("worker-a").filter(row => row.kind === "attest.record" && row.state === "succeeded").length, 1,
      "only the fresh request was accepted");
  });
});

test("SCN-C06: the Principal publishes the shared context; a confined Resident reads it from /world", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    const goal = "# 목표\n로그인 오류를 없앤다.\n";
    s.script(request => (continuesTurn(request) ? text("게시했습니다.")
      : tools(call("oma_mail_send", { to: ["residents"], subject: "Goal", body: goal, intent: "goal", expectedRevision: "none", request: "ctx-1" }))));
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

test("SCN-C07: without git.submit a Resident's merge open is refused and main does not move (AUTH-001)", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true, submit: false }, async s => {
    const main = git(s, "rev-parse", "refs/heads/main");
    await assign(s, "worker-a", "통합해 보세요.", "c07");
    s.script((request, index) => {
      if (index === 0) return bash(`${COMMIT} && echo 이유 > /tmp/r.md && oma merge open --tier LOW --title 통합 --file /tmp/r.md --request mrg-c07; echo "exit=$?"`);
      return text("권한이 없습니다.");
    });
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const refused = lastResult(s.provider.seen.filter(entry => isResident(entry.body))[1]!.body);
    assert.match(refused, /CAPABILITY_DENIED/, refused);
    assert.match(refused, /exit=2/);
    assert.equal(git(s, "rev-parse", "refs/heads/main"), main);
  });
});

test("SCN-C08 / DR18 (D-5): a confined Resident's shell runs under the sandbox filter (the program vsock-seccomp holds to refusing vsock)", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    await assign(s, "worker-a", "필터를 확인하세요.", "c08");
    s.script(request => {
      const results = toolResults(request);
      if (results.length === 0) return bash("grep '^Seccomp:' /proc/self/status");
      return text("확인했습니다.");
    });
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const status = lastResult(s.provider.seen.at(-1)!.body);
    // 2 is SECCOMP_MODE_FILTER: a program is loaded (the sandbox filter).
    assert.match(status, /Seccomp:\s+2/, `the Resident's shell runs without the sandbox filter: ${status}`);
  });
});

test("SCN-C09 / DR18 (D-8): the human's later commit reaches a confined Resident through the read-only mirror, which it submits by the existing path", OPTIONS, async () => {
  const { refreshProjectMirror } = await import("#oma-test/app/runtime/provision");
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    // The human's project: the society's history and one more commit made after the society started.
    const human = mkdtempSync(join(tmpdir(), "oma-human-"));
    try {
      const env = { ...process.env, GIT_AUTHOR_NAME: "h", GIT_AUTHOR_EMAIL: "h@example.invalid", GIT_COMMITTER_NAME: "h", GIT_COMMITTER_EMAIL: "h@example.invalid" };
      execFileSync("git", ["clone", "-q", projectGitPathAt(s.root), human], { env });
      writeFileSync(join(human, "human.txt"), "from the human\n");
      execFileSync("git", ["-C", human, "add", "human.txt"], { env });
      execFileSync("git", ["-C", human, "commit", "-qm", "human work"], { env });
      const commit = execFileSync("git", ["-C", human, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      assert.equal(refreshProjectMirror(s.root, human), null);
      await assign(s, "worker-a", "사람의 새 커밋을 가져와 제출하세요.", "c09");
      s.script(request => (continuesTurn(request) ? text("제출했습니다.")
        : bash("cd /workspace && git fetch -q /git/project-mirror.git main:refs/heads/human && git log -1 --format=%s human && oma submit human --to principal --subject '사람 커밋' --request sub-c09")));
      const run = await s.activate("worker-a");
      assert.equal(run.code, 0, run.stderr);
      const result = lastResult(s.provider.seen.filter(entry => isResident(entry.body))[1]!.body);
      assert.match(result, /human work/, `the Resident did not see the human's commit: ${result.slice(0, 300)}`);
      const receipt = receiptIn(result);
      assert.equal(receipt.state, "succeeded", JSON.stringify(receipt));
      assert.equal(receipt.result!.candidate, commit, "the submitted candidate is not the human's commit");
      assert.equal(git(s, "show", `${receipt.result!.publishedRef!}:human.txt`), "from the human");
      // The mirror is read-only inside: the sandbox's view of it cannot be written.
      assert.notEqual(git(s, "rev-parse", "refs/heads/main"), commit, "the canonical main moved without an integration (MAC-411)");
    } finally { rmSync(human, { recursive: true, force: true }); }
  });
});

// The store as the engine's package manager leaves it on Linux, and as the
// macOS engine keeps it: a link to the generation the Mac's packages arrived as.
for (const layout of ["directory", "link"] as const)
test(`SCN-C10 / DR25: a confined Resident's engine loads an installed package's extension from the read-only store (${layout}), and sees nothing else of the Human's`, OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    // The store beside every session, and the engine home beside it.
    const packages = join(dirname(s.root), ".packages");
    const files = layout === "directory" ? packages : join(dirname(s.root), ".packages-generations", `p-${"b".repeat(64)}`);
    if (layout === "link") { mkdirSync(files, { recursive: true }); symlinkSync(`.packages-generations/p-${"b".repeat(64)}`, packages); }
    const entry = "packages:npm/node_modules/oma-hello-ext/extensions/hello.ts";
    mkdirSync(join(files, dirname(entry.slice("packages:".length))), { recursive: true });
    writeFileSync(join(files, entry.slice("packages:".length)), "export default function (pi) {\n  pi.registerTool({ name: \"hello_ext\", label: \"hello\", " +
      "description: \"Say hello from an installed package.\", parameters: { type: \"object\", properties: {} },\n" +
      "    async execute() { return { content: [{ type: \"text\", text: \"hello\" }], details: {} }; } });\n}\n");
    mkdirSync(join(dirname(s.root), ".engine"), { recursive: true });
    writeFileSync(join(dirname(s.root), ".engine", "auth.json"), "{\"secret\": \"login\"}\n");
    const current = readSettings(s.configPath);
    writeSettings(s.configPath, { ...current.config, installation: { ...current.config.installation, packages } });
    const inline = readSettingsForEditing(s.configPath);
    const roles = roleSetOf(inline.snapshot!);
    const worker = inline.workerProfile!;
    commitRoleSet(inline.snapshot!, inline.config, { ...roles, [worker]: { ...roles[worker]!, extensions: [...roles[worker]!.extensions, entry] } });
    await s.restartBroker();
    await assign(s, "worker-a", "설치된 확장을 확인하세요.", "c10");
    s.script(request => (continuesTurn(request) ? text("확인했습니다.")
      : bash("test -f /opt/oma-packages/npm/node_modules/oma-hello-ext/extensions/hello.ts && echo store-visible; " +
        "touch /opt/oma-packages/x 2>/dev/null && echo store-writable || echo store-read-only; " +
        "grep -c '[.]engine' /proc/self/mountinfo || true")));
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const requests = s.provider.seen.filter(item => isResident(item.body));
    assert.ok((requests[0]!.body.tools ?? []).some(tool => tool.function?.name === "hello_ext"),
      "the confined engine did not show the installed extension's tool");
    const said = lastResult(requests[1]!.body);
    assert.match(said, /store-visible/);
    assert.match(said, /store-read-only/);
    assert.match(said.trim().split("\n").at(-1) ?? "", /^0$/, `the Human's login is visible inside: ${said}`);
  });
});
