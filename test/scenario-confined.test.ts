/** Scenario tests: confined Residents and their Git work, with only the model scripted.
 *
 * The society declares its generated rootfs, so the product's runner starts a
 * Resident's engine under bubblewrap exactly as a deployment does: the
 * trusted extension and bash, no network, and
 * the provider reached only through the runner's relay, which swaps the
 * placeholder the sandbox holds for the key. The scripted provider speaks
 * TLS as one of the engine's own catalogue providers (fixtures/
 * scripted-provider.ts), and the broker has its Git module, so a Resident's
 * commit, typed candidate publication and merge open run through quarantine, review
 * and CAS. Not provider evidence (P0-5; INF-001).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withScenario, type Scenario } from "./fixtures/scenario.js";
import { SCRIPTED_KEY, call, continuesTurn, text, textOf, toolResults, tools, type ChatRequest } from "./fixtures/scripted-provider.js";
import { projectGitPathAt, collaborationRecordRootPathAt } from "@oma/domain/paths";
import { commitRoleSet, readSettings, readSettingsForEditing, roleSetOf, writeSettings } from "#oma-test/app/application/settings";

import { RESIDENT_TEST_OPTIONS as OPTIONS } from "./fixtures/resident.js";
const isResident = (request: ChatRequest): boolean => !(request.tools ?? []).some(tool => tool.function?.name === "oma_society");
const lastResult = (request: ChatRequest | undefined): string => toolResults(request ?? { messages: [] }).at(-1)?.text ?? "";
const git = (s: Scenario, ...args: string[]): string => execFileSync("git", ["--git-dir", projectGitPathAt(s.root), ...args], { encoding: "utf8" }).trim();
const bash = (command: string) => tools(call("bash", { command }));
const receiptIn = (result: string): { operation: string; state: string; result?: Record<string, string> } => {
  const envelope = JSON.parse(result);
  assert.equal(typeof envelope.invocation.key, "string");
  assert.ok(envelope.receipt, `the tool result carries no receipt: ${result}`);
  return envelope.receipt;
};
async function assign(s: Scenario, to: string, body: string, key: string): Promise<string> {
  const sent = await s.residentSends("principal", { to: [to], subject: "작업", body }, key) as { ok: boolean; result: { result: { message: string } } };
  assert.equal(sent.ok, true, JSON.stringify(sent));
  return sent.result.result.message;
}
const COMMIT = "cd /workspace && echo fixed > fix.txt && git add fix.txt && git -c user.name=worker -c user.email=w@example.invalid commit -qm fix";

test("001. A confined Resident commits and submits; the candidate is published, and the Principal gets the result mail", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    await assign(s, "worker-a", "fix.txt를 만들어 제출하세요.", "c01");
    s.script([
      tools(call("bash", { command: COMMIT })),
      tools(call("oma_send", { to: ["principal"], subject: "수정 제출", content: { kind: "text", value: "수정했습니다." }, attachments: [{ commit: "HEAD" }] })),
      text("제출했습니다."),
    ]);
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const receipt = receiptIn(lastResult(s.provider.seen.filter(entry => isResident(entry.body))[2]!.body));
    assert.equal(receipt.state, "succeeded", JSON.stringify(receipt));
    const sent = s.store.getOperationById(s.operations("worker-a").find(row => row.kind === "mail.send")!.id)!;
    assert.equal(sent.kind, "mail.send");
    const source = sent.plan.attachments!.sources[0]!;
    const published = source.publishedRef;
    assert.match(published, /^refs\/oma\/published\/worker-a\//);
    assert.equal(git(s, "rev-parse", published), source.commit);
    assert.equal(git(s, "show", `${published}:fix.txt`), "fixed");
    assert.equal(s.operations("worker-a").filter(row => row.kind === "mail.send").length, 1);
    // The result mail tells the Principal how to fetch the published candidate.
    const [result] = s.inbox("principal");
    assert.ok(result, "the Principal got no result mail");
    const principalRecords = collaborationRecordRootPathAt(s.root, "principal");
    s.script([tools(call("read", { path: join(principalRecords, "mail/messages", `${result}.md`) })),
      tools(call("read", { path: join(principalRecords, "mail/metadata", `${result}.json`) })), text("제출을 확인했습니다.")]);
    assert.equal((await s.deliver()).kind, "delivered");
    const observed = toolResults(s.provider.seen.at(-1)!.body).slice(-2);
    assert.ok(observed[0]!.text.includes("수정했습니다"), "the result mail body was not readable");
    assert.ok(observed[1]!.text.includes(published), "the permitted immutable attachment metadata must name its publication");
  });
});

test("002. Inside the sandbox the provider key is only a placeholder; the relay hands the provider the real one", OPTIONS, async () => {
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

test("003. Two distinct sends of the same commit preserve its original publication provenance", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    await assign(s, "worker-a", "두 번 제출해 보세요.", "c03");
    const submit = { to: ["principal"], subject: "반복", content: { kind: "text", value: "같은 후보입니다." }, attachments: [{ commit: "HEAD" }] };
    s.script([
      tools(call("bash", { command: COMMIT })),
      tools(call("oma_send", submit, "submit-first")),
      tools(call("oma_send", submit, "submit-repeat")),
      text("두 번 불렀습니다."),
    ]);
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const resident = s.provider.seen.filter(entry => isResident(entry.body));
    const first = receiptIn(lastResult(resident[2]!.body));
    const repeated = receiptIn(lastResult(resident[3]!.body));
    assert.equal(first.state, "succeeded", JSON.stringify(first));
    assert.equal(repeated.state, "succeeded");
    assert.notEqual(repeated.operation, first.operation, "a distinct original Pi call is a distinct intentional send");
    assert.equal(s.operations("worker-a").filter(row => row.kind === "mail.send").length, 2);
    assert.equal(git(s, "for-each-ref", "refs/oma/published/").split("\n").filter(Boolean).length, 1);
    assert.equal(s.inbox("principal").length, 2, "both intentional sends must reach the recipient");
  });
});

test("004. A Resident's LOW merge request applies itself; main moves exactly to its candidate", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    const before = git(s, "rev-parse", "refs/heads/main");
    await assign(s, "worker-a", "제출하고 통합하세요.", "c04");
    s.script([
      bash(COMMIT),
      tools(call("oma_merge", { change: { candidate: "HEAD" }, tier: "LOW", title: "통합", reason: "통합" })),
      text("통합했습니다."),
    ]);
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const opened = receiptIn(lastResult(s.provider.seen.filter(entry => isResident(entry.body))[2]!.body));
    assert.equal(opened.state, "succeeded", JSON.stringify(opened));
    const candidate = git(s, "for-each-ref", "--format=%(objectname)", "refs/oma/published/");
    assert.equal(git(s, "rev-parse", "refs/heads/main"), candidate, "main did not move to the candidate");
    assert.notEqual(git(s, "rev-parse", "refs/heads/main"), before);
    assert.equal(s.operations("worker-a").filter(row => row.kind === "git.integrate" && row.state === "succeeded").length, 1);
  });
});

test("005. A proposal on an earlier base is accepted and its changed integration context requires review", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    const main = git(s, "rev-parse", "refs/heads/main");
    await assign(s, "worker-a", "지난 기준으로 통합해 보세요.", "c05");
    // The workspace's origin/main stays at the fetched base; after the first
    // request applies, the second proposal retains that original base.
    s.script([
      bash(COMMIT),
      tools(call("oma_merge", { change: { candidate: "HEAD" }, tier: "LOW", title: "첫번째", reason: "첫번째" })),
      bash(COMMIT.replace("echo fixed", "echo second")),
      tools(call("oma_merge", { change: { candidate: "HEAD", base: "refs/remotes/origin/main" }, tier: "LOW", title: "두번째", reason: "두번째" })),
      text("통합 문맥 검토가 필요합니다."),
    ]);
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const resident = s.provider.seen.filter(entry => isResident(entry.body));
    const opened = receiptIn(lastResult(resident[2]!.body));
    assert.equal(opened.state, "succeeded", JSON.stringify(opened));
    const second = receiptIn(lastResult(resident[4]!.body));
    assert.equal(second.state, "succeeded", JSON.stringify(second));
    const after = git(s, "rev-parse", "refs/heads/main");
    assert.notEqual(after, main, "the first LOW merge should have applied");
    const integrated = s.operations("worker-a").filter(row => row.kind === "git.integrate" && row.state === "succeeded");
    assert.equal(integrated.length, 1, "the changed integration context cannot apply without review");
    const openedFacts = s.operations("worker-a").filter(row => row.kind === "attest.record" && row.state === "succeeded" &&
      s.store.getOperationById(row.id)?.kind === "attest.record");
    assert.equal(openedFacts.filter(row => { const op = s.store.getOperationById(row.id); return op?.kind === "attest.record" && op.plan.fact.kind === "merge.open"; }).length, 2, "both proposals are accepted independently of current main");
  });
});

test("006. The Principal publishes the shared context; a confined Resident reads it from /world", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    const goal = "# 목표\n로그인 오류를 없앤다.\n";
    s.script(request => (continuesTurn(request) ? text("게시했습니다.")
      : tools(call("oma_goal", { content: { kind: "text", value: goal }, expectedRevision: null }, "ctx-1"))));
    await s.prompt("목표를 게시해");
    const published = receiptIn(lastResult(s.provider.seen[1]!.body));
    assert.equal(published.state, "succeeded", JSON.stringify(published));
    await assign(s, "worker-a", "목표를 읽으세요.", "c06");
    s.script(request => (continuesTurn(request) ? text("읽었습니다.") : tools(call("read", { path: "/oma/goal/GOAL.md" }))));
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    assert.match(lastResult(s.provider.seen.at(-1)!.body), /로그인 오류를 없앤다/);
  });
});

test("007. Without git.submit a Resident's merge open is refused and main does not move (AUTH-001)", OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true, submit: false }, async s => {
    const main = git(s, "rev-parse", "refs/heads/main");
    await assign(s, "worker-a", "통합해 보세요.", "c07");
    s.script([
      bash(COMMIT),
      tools(call("oma_merge", { change: { candidate: "HEAD" }, tier: "LOW", title: "통합", reason: "이유" })),
      text("권한이 없습니다."),
    ]);
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const refused = lastResult(s.provider.seen.filter(entry => isResident(entry.body))[2]!.body);
    assert.match(refused, /CAPABILITY_DENIED/, refused);
    assert.equal(git(s, "rev-parse", "refs/heads/main"), main);
    assert.equal(s.operations("worker-a").filter(row => row.kind === "git.integrate").length, 0);
  });
});

test("008. A confined Resident's shell runs under the sandbox filter (the program vsock-seccomp holds to refusing vsock)", OPTIONS, async () => {
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

test("009. The human's later commit reaches a confined Resident through the read-only mirror, which it submits by the existing path", OPTIONS, async () => {
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
      s.script([
        tools(call("bash", { command: "cd /workspace && git fetch -q /git/project-mirror.git main:refs/heads/human && git log -1 --format=%s human" }, "fetch-human")),
        tools(call("oma_send", { to: ["principal"], subject: "사람 커밋", content: { kind: "text", value: "사람의 새 커밋입니다." }, attachments: [{ commit: "human" }] })),
        text("제출했습니다."),
      ]);
      const run = await s.activate("worker-a");
      assert.equal(run.code, 0, run.stderr);
      const resident = s.provider.seen.filter(entry => isResident(entry.body));
      const fetched = toolResults(resident[1]!.body).find(result => result.id === "fetch-human")!.text;
      assert.match(fetched, /human work/, `the Resident did not see the human's commit: ${fetched.slice(0, 300)}`);
      const receipt = receiptIn(lastResult(resident[2]!.body));
      assert.equal(receipt.state, "succeeded", JSON.stringify(receipt));
      const sent = s.store.getOperationById(s.operations("worker-a").find(row => row.kind === "mail.send")!.id)!;
      assert.equal(sent.kind, "mail.send");
      const source = sent.plan.attachments!.sources[0]!;
      assert.equal(source.commit, commit, "the submitted candidate is not the human's commit");
      assert.equal(git(s, "show", `${source.publishedRef}:human.txt`), "from the human");
      // The mirror is read-only inside: the sandbox's view of it cannot be written.
      assert.notEqual(git(s, "rev-parse", "refs/heads/main"), commit, "the canonical main moved without an integration (MAC-411)");
    } finally { rmSync(human, { recursive: true, force: true }); }
  });
});

// The store as the engine's package manager leaves it on Linux, and as the
// macOS engine keeps it: a link to the generation the Mac's packages arrived as.
for (const layout of ["directory", "link"] as const)
test(`010. A confined Resident's engine loads an installed package's extension from the read-only store (${layout}), and sees nothing else of the Human's`, OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    // The store beside every session, and the engine home beside it.
    const packages = join(dirname(s.root), ".packages");
    const files = layout === "directory" ? packages : join(dirname(s.root), ".packages-generations", `p-${"b".repeat(64)}`);
    if (layout === "link") { mkdirSync(files, { recursive: true }); symlinkSync(`.packages-generations/p-${"b".repeat(64)}`, packages); }
    const entry = "packages:npm/node_modules/oma-hello-ext/extensions/hello.ts";
    mkdirSync(join(files, dirname(entry.slice("packages:".length))), { recursive: true });
    writeFileSync(join(files, entry.slice("packages:".length)), "import { writeFileSync } from 'node:fs';\nexport default function (pi) {\n  pi.on(\"session_start\", () => writeFileSync(\"extension-loaded.txt\", \"loaded\"));\n  pi.registerTool({ name: \"hello_ext\", label: \"hello\", " +
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
    s.script((request, index) => {
      const offered = (request.tools ?? []).map(tool => tool.function?.name);
      assert.ok(offered.includes("hello_ext"), "a verified direct user extension must stay callable");
      assert.ok(!offered.includes("toolset"));
      return index === 0 ? tools(call("hello_ext", {}, "installed-hello"), call("bash", { command: "cat extension-loaded.txt; test -f /opt/oma-packages/npm/node_modules/oma-hello-ext/extensions/hello.ts && echo store-visible; " +
        "touch /opt/oma-packages/x 2>/dev/null && echo store-writable || echo store-read-only; " +
        "grep -c '[.]engine' /proc/self/mountinfo || true" }, "installed-containment")) : text("확인했습니다.");
    });
    const run = await s.activate("worker-a");
    assert.equal(run.code, 0, run.stderr);
    const requests = s.provider.seen.filter(item => isResident(item.body));
    const results = toolResults(requests[1]!.body);
    assert.equal(results.find(result => result.id === "installed-hello")?.text, "hello");
    const said = results.find(result => result.id === "installed-containment")?.text ?? "";
    assert.match(said, /loaded/);
    assert.match(said, /store-visible/);
    assert.match(said, /store-read-only/);
    assert.match(said.trim().split("\n").at(-1) ?? "", /^0$/, `the Human's login is visible inside: ${said}`);
  });
});
