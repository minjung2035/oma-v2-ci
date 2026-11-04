/** mail-v1 review loop end-to-end with a scripted Principal model.
 *
 * A real society runs (provisioned state, broker, PrincipalSession with the
 * trusted extension and typed client); Residents act through the
 * broker's dispatch (residentCall/residentPushes), the model through the
 * scripted provider. Assertions are durable facts: ledger rows, mailbox
 * files, receipts, provider-seen requests. (Resident *activation* is not part
 * of these scenarios; their effects are dispatched directly.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withScenario, SCENARIO_LIMITS, type Scenario } from "./fixtures/scenario.js";
import { call, lastUserText, text, toolResults, tools, type ChatRequest } from "./fixtures/scripted-provider.js";
import { projectGitPathAt, collaborationRecordRootPathAt } from "@oma/domain/paths";
import { inspectLedger } from "#oma-test/app/diagnostics/ledger";
import { readableBody } from "@oma/mail/display";
import { readDiagnosticSnapshot } from "@oma/storage";

const TIMEOUT = { timeout: 120_000 };
const LAST = "line.txt";

/** The newest tool result the engine handed the model. */
const lastResult = (request: ChatRequest | undefined): string => toolResults(request ?? { messages: [] }).at(-1)?.text ?? "";
const receiptIn = (result: string): { operation?: string; state?: string; result?: Record<string, unknown>; error?: { code?: string } } => {
  const envelope = JSON.parse(result);
  assert.equal(typeof envelope.invocation.key, "string");
  assert.ok(envelope.receipt, `no receipt in tool result: ${result.slice(0, 300)}`);
  return envelope.receipt;
};
/** A mail id's Maildir name ends in `:2,`; ids the model can name are without it. */
const nameOf = (file: string) => file.replace(/:2,.*$/, "");
const noticed = (value: string): string[] => [...new Set([...value.matchAll(/\/mail\/messages\/(m-[0-9a-f-]+-\d+)\.md/g)].map(match => match[1]!))];
const records = (s: Scenario) => collaborationRecordRootPathAt(s.root, "principal");
const requestOf = (s: Scenario, name: string) => {
  for (const row of s.operations()) {
    const op = s.store.getOperationById(row.id);
    if (op?.kind === "attest.record" && ["merge.open", "challenge.open"].includes(op.plan.fact.kind) && "name" in op.plan.fact && op.plan.fact.name === name) return op.id;
  }
  throw new Error(`No original request for ${name}`);
};
const mailRead = (s: Scenario, message: string) => tools(call("read", { path: `${records(s)}/mail/messages/${message}.md` }));
async function decide(s: Scenario, name: string, decision: "approve" | "reject" = "approve") {
  let index = "", status = "", result = "", target = "";
  s.script((request, step) => {
    if (step === 0) return tools(call("read", { path: `${records(s)}/mail/inbox.md` }));
    if (step === 1) { index = lastResult(request); return tools(call("read", { path: `${records(s)}/reviews/${requestOf(s, name)}/status.md` })); }
    if (step === 2) {
      status = lastResult(request); target = /review target: (\S+)/.exec(status)?.[1] ?? "";
      return tools(call("oma_review", { target, decision, reason: "Reviewed the exact permitted target and evidence." }));
    }
    result = lastResult(request); return text("Decision recorded.");
  });
  assert.equal((await s.deliver()).kind, "delivered");
  assert.ok(target, status); assert.equal(receiptIn(result).state, "succeeded", result);
  return { index, status, result, target };
}
/** The principal's pending approval mail for a request: other mail (notices,
 * human prompts) may ride in the same batch, so pick by content, not position. */
const pendingApproval = (s: Scenario, name: string): string => {
  const found = s.inbox("principal").map(nameOf).filter(id => {
    const eml = s.archived(id);
    return /X-Oma-Kind: approval_required/i.test(eml) && eml.includes(`[${name}]`);
  });
  assert.equal(found.length, 1, `expected exactly one pending approval for ${name}, got ${found}`);
  return found[0]!;
};
/** Every id the notice named is a mail actually addressed to the Principal —
 * a workers-audience mail leaking into its batch fails this. Asserted outside
 * the provider callback: a throw in there only reports "provider failed". */
const assertNoticedForPrincipal = (s: Scenario, ids: readonly string[], mustInclude: string): void => {
  for (const id of ids)
    assert.match(s.archived(id), /^To:.*principal@/m, `notice names ${id} which is not addressed to the Principal`);
  assert.ok(ids.includes(mustInclude), `the notice did not name ${mustInclude}: ${ids}`);
};

const canonicalMain = (s: Scenario): string =>
  execFileSync("git", ["rev-parse", "refs/heads/main"], { cwd: projectGitPathAt(s.root), encoding: "utf8" }).trim();

/** A merge request the trusted way: candidate published, then the open fact. */
async function openMerge(s: Scenario, key: string, tier: string, change: (work: string) => void): Promise<{ name: string; candidate: string; base: string }> {
  const { candidate, base } = await s.residentPushes("alice", key, change);
  const opened = await s.residentCall("alice", "attest.record",
    { kind: "merge.open", tier, title: `change ${key}`, reason: `the reason for ${key}`, candidate, base }, `${key}.open`) as { ok: boolean; result: { result: { request: string } } };
  assert.equal(opened.ok, true, `open refused: ${JSON.stringify(opened).slice(0, 400)}`);
  return { name: opened.result.result.request, candidate, base };
}
const vote = (s: Scenario, from: string, name: string, verdict: string, key: string, extra: Record<string, unknown> = {}) =>
  s.residentCall(from, "attest.record", { kind: "vote", name, verdict, body: `${from} ${verdict}d`, ...extra }, key);
const change = (label: string) => (work: string) => writeFileSync(join(work, LAST), `content ${label}\n`);

test("001. HIGH merge end-to-end: approval records, exact Principal decision, application and completion notice", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const { name, candidate } = await openMerge(s, "r01", "HIGH", change("r01"));
    for (const actor of ["bob", "carol"]) assert.equal((await vote(s, actor, name, "approve", `r01-${actor}`)).ok, true);
    await s.idle();
    const approval = pendingApproval(s, name);
    const observed = await decide(s, name);
    assert.deepEqual(noticed(observed.index), [approval], "the role-scoped inbox contains only its approval mail");
    assert.doesNotMatch(observed.status, /diff --git|\/mail\/workers\//, "Principal records must not expose Worker patch paths");
    await s.idle(); assert.equal(canonicalMain(s), candidate);
    assert.equal(s.operations("principal").filter(row => row.kind === "attest.record").length, 1);
    const after = s.inbox("principal").map(nameOf);
    assert.equal(after.length, 2, "the decision copy and completion notice must both arrive");
    assert.ok(after.some(id => /Subject: .*applied:/i.test(s.archived(id))));
    assert.ok(after.some(id => /Subject: .*decision recorded/i.test(s.archived(id))));
    s.script([text("Noted.")]); assert.equal((await s.deliver()).kind, "delivered");
    const report = inspectLedger(readDiagnosticSnapshot(s.root), { stateRoot: s.root, society: "demo" });
    assert.equal(report.report.status, "PASS", report.report.issues.map(issue => issue.code).join(","));
  });
});

test("002. The Principal's current surface refuses Worker actions and worker-mail paths before and after approval delivery", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const { name } = await openMerge(s, "r02", "HIGH", change("r02"));
    await vote(s, "bob", name, "approve", "r02-bob"); await s.idle();
    const workerDir = join(s.root, "mail/workers/cur"), workerId = nameOf(readdirSync(workerDir).sort()[0]!);
    const before = s.operations().length;
    s.script([
      tools(call("oma_spawn", { name: "forbidden", from: "HEAD", brief: { kind: "text", value: "Forbidden Principal orchestration" } })),
      tools(call("oma_review", { target: name, decision: "approve", reason: "A request name is not an exact target" })),
      tools(call("read", { path: `${records(s)}/mail/messages/${workerId}.md` })),
      tools(call("read", { path: join(workerDir, `${workerId}:2,`) })), text("Refused."),
    ]);
    await s.prompt("Check the authority boundary.");
    assert.equal(s.operations().length, before);
    const results = toolResults(s.provider.seen.at(-1)!.body);
    assert.match(results[0]!.text, /not found|not available/i);
    assert.match(results[1]!.text, /CAPABILITY_DENIED|INVALID_REQUEST|SOURCE_UNREADABLE|invalid.*target/i);
    for (const result of results.slice(2)) assert.match(result.text, /ENOENT|outside|denied|not found|unavailable/i);
    assert.equal(s.inbox("principal").length, 0);
    await vote(s, "carol", name, "approve", "r02-carol"); await s.idle();
    const approval = pendingApproval(s, name);
    s.script([tools(call("read", { path: join(workerDir, `${workerId}:2,`) })), mailRead(s, approval), text("Read my own approval.")]);
    assert.equal((await s.deliver()).kind, "delivered");
    const delivered = toolResults(s.provider.seen.at(-1)!.body).slice(-2);
    assert.match(delivered[0]!.text, /outside|denied/i);
    assert.match(delivered[1]!.text, /merge/); assert.doesNotMatch(delivered[1]!.text, /ENOENT/);
  });
});

test("003. A stale exact approval target is refused; the fresh approval target applies", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const { name, candidate } = await openMerge(s, "r03", "HIGH", change("r03"));
    for (const actor of ["bob", "carol"]) await vote(s, actor, name, "approve", `r03-${actor}`);
    await s.idle(); const first = pendingApproval(s, name);
    s.script([tools(call("read", { path: `${records(s)}/reviews/${requestOf(s, name)}/status.md` })), text("Hold this exact target.")]);
    assert.equal((await s.deliver()).kind, "delivered");
    const target = /review target: (\S+)/.exec(lastResult(s.provider.seen.at(-1)!.body))![1]!;
    await vote(s, "bob", name, "reject", "r03-reject"); await s.idle();
    s.script([tools(call("oma_review", { target, decision: "approve", reason: "This old approval must be fenced" })), text("Stale observed.")]);
    assert.equal((await s.deliver()).kind, "delivered");
    assert.match(lastResult(s.provider.seen.at(-1)!.body), /STALE_TARGET|APPROVAL_STALE/);
    assert.equal(s.operations("principal").filter(row => row.kind === "attest.record").length, 0);
    await vote(s, "bob", name, "approve", "r03-approve-again"); await s.idle();
    const second = pendingApproval(s, name); assert.notEqual(second, first);
    const observed = await decide(s, name); assert.deepEqual(noticed(observed.index), [second]);
    await s.idle(); assert.equal(canonicalMain(s), candidate);
  });
});

test("004. A Principal reject closes the request; later Worker votes are refused", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const { name } = await openMerge(s, "r04", "HIGH", change("r04")), before = canonicalMain(s);
    for (const actor of ["bob", "carol"]) await vote(s, actor, name, "approve", `r04-${actor}`);
    await s.idle(); const approval = pendingApproval(s, name);
    await decide(s, name, "reject"); await s.idle(); assert.equal(canonicalMain(s), before);
    const status = await s.residentCall("alice", "review.status", { name }, null) as { ok: boolean; result: { display: string; principal: { decision: string; decisionApproval: string } } };
    assert.equal(status.ok, true); assert.equal(status.result.display, "rejected");
    assert.equal(status.result.principal.decision, "reject"); assert.equal(status.result.principal.decisionApproval, approval);
    const late = await vote(s, "bob", name, "approve", "r04-late"); assert.equal(late.ok, false); assert.match(JSON.stringify(late), /REQUEST_CLOSED/);
  });
});

test("005. MEDIUM applies on one Worker approval; only its completion becomes visible to the Principal", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob"] }, async s => {
    const { name, candidate } = await openMerge(s, "r05", "MEDIUM", change("r05"));
    s.script([tools(call("read", { path: `${records(s)}/reviews/${requestOf(s, name)}/status.md` })), text("Not visible yet.")]);
    await s.prompt("Check permitted review records.");
    assert.match(lastResult(s.provider.seen.at(-1)!.body), /ENOENT|not found|unavailable/i);
    assert.equal(s.inbox("principal").length, 0);
    await vote(s, "bob", name, "approve", "r05-bob"); await s.idle(); assert.equal(canonicalMain(s), candidate);
    const [notice] = s.inbox("principal").map(nameOf); assert.ok(notice); assert.equal(s.inbox("principal").length, 1);
    s.script([mailRead(s, notice), tools(call("read", { path: `${records(s)}/reviews/${requestOf(s, name)}/status.md` })), text("Completed.")]);
    assert.equal((await s.deliver()).kind, "delivered");
    const results = toolResults(s.provider.seen.at(-1)!.body).slice(-2);
    assert.match(results[0]!.text, /content r05/); assert.match(results[1]!.text, /applied/);
    assert.doesNotMatch(results[1]!.text, /review target:|diff --git/);
    assert.equal((await s.deliver()).kind, "idle");
  });
});

test("006. An approval accepted while the engine is down delivers exactly once after restarts", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const { name } = await openMerge(s, "r06", "HIGH", change("r06"));
    await vote(s, "bob", name, "approve", "r06-bob"); await s.restartEngine();
    await vote(s, "carol", name, "approve", "r06-carol"); await s.restartBroker();
    const approval = pendingApproval(s, name); await decide(s, name); await s.idle();
    assert.equal(s.operations("principal").filter(row => row.kind === "attest.record" && row.state === "succeeded").length, 1);
    assert.equal(s.store.getDelivery(approval, "principal")?.presented, 1);
    s.script([text("Completion observed.")]); await s.deliver();
    assert.deepEqual(s.store.preparedBatches("principal"), []);
    assert.equal((await s.deliver()).kind, "idle");
  });
});

test("007. A completion notice over the body bound arrives in ordered parts the model actually reads", TIMEOUT, async () => {
  await withScenario({ residents: ["alice"], reviewBodyBytes: 8192 }, async s => {
    await openMerge(s, "r07", "LOW", work => writeFileSync(join(work, "big.txt"), Array.from({ length: 900 }, (_, i) => `line ${i} ${"x".repeat(18)}`).join("\n")));
    await s.idle(); const parts = s.inbox("principal").map(nameOf); assert.ok(parts.length >= 3);
    const bodies = parts.map(id => readableBody(s.archived(id))), first = bodies[0]!;
    s.script((_request, index) => index < parts.length ? mailRead(s, parts[index]!) : text("Read every part."));
    assert.equal((await s.deliver()).kind, "delivered");
    const reads = toolResults(s.provider.seen.at(-1)!.body); assert.equal(reads.length, parts.length);
    for (const [index, read] of reads.entries()) {
      assert.doesNotMatch(read.text, /Tool .*not found|ENOENT/);
      assert.ok(read.text.includes(bodies[index]!.split("\n")[0]!), "the model did not receive the actual part");
    }
    const document = bodies.map(body => body.slice(body.indexOf("in order.\n") + "in order.\n".length)).join("");
    assert.equal(createHash("sha256").update(document).digest("hex"), /sha256 ([0-9a-f]{64})/.exec(first)![1]);
    assert.equal(Buffer.byteLength(document), Number(/document (\d+) bytes/.exec(first)![1]));
    assert.match(document, /diff --git a\/big\.txt/); assert.match(document, /Integration operation: op-/);
  });
});

test("008. A HIGH challenge exposes permitted correction records and applies the exact revert on the Principal's decision", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const { name } = await openMerge(s, "r08", "LOW", change("r08")); await s.idle(); const merged = canonicalMain(s);
    const opened = await s.residentCall("alice", "attest.record", { kind: "challenge.open", merge: name, tier: "HIGH", title: "revert it", reason: "regression" }, "r08.ch") as { ok: boolean; result: { result: { request: string } } };
    assert.equal(opened.ok, true); const challenge = opened.result.result.request;
    for (const actor of ["bob", "carol"]) await vote(s, actor, challenge, "approve", `r08-${actor}`);
    await s.idle(); const approval = pendingApproval(s, challenge), observed = await decide(s, challenge);
    assertNoticedForPrincipal(s, noticed(observed.index), approval);
    assert.doesNotMatch(observed.status, /diff --git|\/mail\/workers\//);
    await s.idle(); const head = canonicalMain(s); assert.notEqual(head, merged);
    const patch = execFileSync("git", ["diff", merged, head, "--", LAST], { cwd: projectGitPathAt(s.root), encoding: "utf8" });
    assert.match(patch, /-content r08/);
    const status = await s.residentCall("alice", "review.status", { name }, null) as { result: { display: string } };
    assert.equal(status.result.display, "applied", "a challenge never rewrites the original applied fact");
  });
});

test("009. A distinct second model vote on a consumed exact target is refused and records no second decision", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const { name, candidate } = await openMerge(s, "r09", "HIGH", change("r09"));
    for (const actor of ["bob", "carol"]) await vote(s, actor, name, "approve", `r09-${actor}`);
    await s.idle();
    s.script((request, index) => {
      if (index === 0) return tools(call("read", { path: `${records(s)}/reviews/${requestOf(s, name)}/status.md` }));
      if (index === 1) {
        const target = /review target: (\S+)/.exec(lastResult(request))![1]!;
        const input = { target, decision: "approve", reason: "Exact decision" };
        return tools(call("oma_review", input, "first-decision"), call("oma_review", input, "distinct-second-decision"));
      }
      return text("The original decision remains authoritative.");
    });
    assert.equal((await s.deliver()).kind, "delivered"); await s.idle();
    const results = toolResults(s.provider.seen.at(-1)!.body).slice(-2);
    assert.equal(receiptIn(results[0]!.text).state, "succeeded");
    assert.match(results[1]!.text, /STALE_TARGET|REQUEST_CLOSED|APPROVAL_STALE/);
    assert.equal(s.operations("principal").filter(row => row.kind === "attest.record").length, 1);
    assert.equal(canonicalMain(s), candidate);
  });
});
