/** Current typed collaboration through actual Principal SDK and owned native Workers.
 * Provider inference and the Principal host channel are scripted, never qualified here. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { withScenario, type Scenario } from "./fixtures/scenario.js";
import { call, tools, text, toolResults, type ChatRequest } from "./fixtures/scripted-provider.js";
import { projectGitPathAt, collaborationRecordRootPathAt } from "@oma/domain/paths";

const last = (request: ChatRequest) => toolResults(request).at(-1)?.text ?? "";
const main = (s: Scenario) => execFileSync("/usr/bin/git", ["--git-dir", projectGitPathAt(s.root), "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim();
async function assign(s: Scenario, actor: string) {
  s.script([tools(call("oma_send", { to: [actor], subject: "Current review task", content: { kind: "text", value: "Perform the assigned current collaboration task." } })), text("Assigned.")]);
  await s.prompt(`Assign the task to ${actor}.`);
}
async function publish(s: Scenario, tier: "LOW" | "MEDIUM" | "HIGH") {
  await assign(s, "alice");
  let result = "";
  s.script((request, index) => {
    if (index === 0) return tools(call("write", { path: "line.txt", content: "current native change\n" }));
    if (index === 1) return tools(call("bash", { command: "git add -- line.txt && git -c user.name=Alice -c user.email=alice@example.invalid commit -m current-review" }));
    if (index === 2) return tools(call("oma_merge", { tier, title: "Current native proposal", reason: "Review the exact committed change." }));
    result = last(request); return text("Proposed.");
  });
  const run = await s.activate("alice");
  assert.equal(run.code, 0, run.stderr);
  assert.match(result, /succeeded/, result);
  for (const row of s.operations("alice")) {
    const op = s.store.getOperationById(row.id);
    if (op?.kind === "attest.record" && op.plan.fact.kind === "merge.open") {
      assert.equal(op.plan.fact.version, 3);
      return { request: op.id, name: op.plan.fact.name, candidate: op.plan.fact.identity.candidate, result };
    }
  }
  assert.fail(`no current original open fact: ${result}`);
}
async function decide(s: Scenario, actor: string, request: string, decision: "approve" | "reject" = "approve") {
  if (actor !== "principal") await assign(s, actor);
  const root = actor === "principal" ? collaborationRecordRootPathAt(s.root, actor) : "/oma";
  let target = "", status = "", result = "";
  s.script((message, index) => {
    if (index === 0) return tools(call("read", { path: `${root}/reviews/${request}/status.md`, offset: 1, limit: 2000 }));
    if (index === 1) {
      status = last(message);
      target = /review target: (\S+)/.exec(status)?.[1] ?? "";
      return target ? tools(call("oma_review", { target, decision, reason: "Independent review of this exact target." })) : text("No permitted target was published.");
    }
    result = last(message); return text("Decision recorded.");
  });
  if (actor === "principal") assert.equal((await s.deliver()).kind, "delivered");
  else { const run = await s.activate(actor); assert.equal(run.code, 0, run.stderr); }
  assert.ok(target, `no permitted target: ${status}`);
  assert.match(result, /succeeded/, result);
  return { target, status, result };
}

test("001. Native published HIGH proposal and qualified Worker votes reach exact Principal approval and real Git CAS", { timeout: 120_000 }, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const base = main(s), opened = await publish(s, "HIGH");
    assert.equal(main(s), base);
    await decide(s, "bob", opened.request);
    assert.equal(main(s), base);
    await decide(s, "carol", opened.request);
    assert.equal(main(s), base, "qualified Worker quorum is not Principal approval");
    const principal = await decide(s, "principal", opened.request);
    assert.match(principal.status, /Approval identity:/);
    assert.doesNotMatch(principal.status, /proposal\.patch/);
    assert.equal(main(s), opened.candidate);
    const integrations = s.operations("alice").filter(row => row.kind === "git.integrate");
    assert.equal(integrations.length, 1); assert.equal(integrations[0]!.state, "succeeded");
  });
});

for (const tier of ["LOW", "MEDIUM"] as const) test(`002. Native commit and typed proposal reach original ${tier} eligibility and exactly one Git CAS`, { timeout: 120_000 }, async () => {
  await withScenario({ residents: ["alice", "bob"] }, async s => {
    const base = main(s), opened = await publish(s, tier);
    if (tier === "MEDIUM") { assert.equal(main(s), base); await decide(s, "bob", opened.request); }
    assert.equal(main(s), opened.candidate);
    assert.equal(s.operations("principal").filter(row => row.kind === "attest.record").length, 0);
    const submitted = s.operations("alice").filter(row => row.kind === "git.submit");
    assert.equal(submitted.length, 1); assert.match(submitted[0]!.request_key, /^inv1-[0-9a-f]{64}\.submit$/);
    assert.equal(s.operations("alice").filter(row => row.kind === "git.integrate").length, 1);
  });
});

test("003. Actual Principal decision preserves main and closes later Worker review without new facts", { timeout: 120_000 }, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const base = main(s), opened = await publish(s, "HIGH");
    const bob = await decide(s, "bob", opened.request);
    await decide(s, "carol", opened.request);
    await decide(s, "principal", opened.request, "reject");
    const before = s.store.acceptedOperationPage();
    await assign(s, "bob");
    const assigned = s.store.acceptedOperationPage();
    let result = "";
    s.script((request, index) => {
      if (index === 0) return tools(call("oma_review", { target: bob.target, decision: "approve", reason: "This must not reopen the final rejection." }));
      result = last(request); return text("Refusal observed.");
    });
    const run = await s.activate("bob"); assert.equal(run.code, 0, run.stderr);
    assert.match(result, /closed|stale|current|changed/i, result);
    assert.deepEqual(s.store.acceptedOperationPage(), assigned);
    assert.equal(assigned.items.length, before.items.length + 1, "the explicit assignment is the only new accepted operation");
    assert.equal(main(s), base);
    assert.equal(s.operations("alice").filter(row => row.kind === "git.integrate").length, 0);
  });
});
