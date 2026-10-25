/** mail-v1 review loop end-to-end with a scripted Principal model.
 *
 * A real society runs (provisioned state, broker, PrincipalSession with the
 * trusted extension and the model-facing CLI); Residents act through the
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
import { withScenario, type Scenario } from "./fixtures/scenario.js";
import { call, lastUserText, text, toolResults, tools, type ChatRequest } from "./fixtures/scripted-provider.js";
import { projectGitPathAt } from "@oma/domain/paths";
import { inspectLedger } from "#oma-test/app/diagnostics/ledger";
import { readableBody } from "@oma/mail/display";
import { readDiagnosticSnapshot } from "@oma/storage";

const TIMEOUT = { timeout: 120_000 };
const LAST = "line.txt";

/** The newest tool result the engine handed the model. */
const lastResult = (request: ChatRequest | undefined): string => toolResults(request ?? { messages: [] }).at(-1)?.text ?? "";
const receiptIn = (result: string): { operation?: string; state?: string; result?: Record<string, unknown>; error?: { code?: string } } => {
  const found = result.match(/\{"operation":"[^"]+".*\}/);
  assert.ok(found, `no receipt in tool result: ${result.slice(0, 300)}`);
  return JSON.parse(found[0]);
};
/** A mail id's Maildir name ends in `:2,`; ids the model can name are without it. */
const nameOf = (file: string) => file.replace(/:2,.*$/, "");
/** The ids a delivered batch notice names (its `path=` entries). */
const noticed = (text2: string): string[] => [...text2.matchAll(/\/mail\/archive\/cur\/(m-[0-9a-f-]+):2,/g)].map(match => match[1]!);
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

test("SCN-R01: HIGH merge end-to-end — approval mail, Principal diff and vote, application, completion notice", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const { name, candidate } = await openMerge(s, "r01", "HIGH", change("r01"));
    assert.equal((await vote(s, "bob", name, "approve", "r01-bob")).ok, true);
    assert.equal((await vote(s, "carol", name, "approve", "r01-carol")).ok, true);
    await s.idle();
    // Exactly one approval_required reached the Principal's mailbox — the
    // thread revisions went to Workers only.
    const pending = s.inbox("principal").map(nameOf);
    assert.equal(pending.length, 1);
    const approval = pending[0]!;
    const eml = s.archived(approval);
    assert.match(eml, /X-Oma-Kind: approval_required/i);
    // A merge-<uuid> subject runs past the header line width, so the stored
    // bytes carry it folded -- unfold as the reader does before matching.
    const unfolded = eml.replace(/\r\n[ \t]+/g, " ");
    assert.match(unfolded, new RegExp(`^Subject: \\[${name}\\] HIGH approval requested`, "m"));

    // Results are captured inside the provider callback and asserted after the
    // run: a throw in there only reaches the test as "provider failed".
    let seenIds: string[] = [];
    let diffResult = "";
    s.script((request, index) => {
      if (index === 0) {
        // The approval id is taken from the notice the model saw, not the
        // ledger: the mail path the batch notice printed names the message.
        seenIds = noticed(lastUserText(request));
        return tools(call("oma_merge", { action: "diff", name }));
      }
      if (index === 1) {
        diffResult = lastResult(request);
        return tools(call("oma_merge", { action: "vote", name, verdict: "approve", body: "Reviewed; approve.", approval }));
      }
      return text("Approved.");
    });
    assert.equal((await s.deliver()).kind, "delivered");
    assert.deepEqual(seenIds, [approval], "the batch notice names the approval mail and only it");
    const diff = JSON.parse(diffResult) as { sha256: string; text: string };
    assert.match(diff.text, /content r01/, "the tool read the real base→candidate patch");
    assert.match(diff.sha256, /^[0-9a-f]{64}$/);
    await s.idle();
    assert.equal(canonicalMain(s), candidate, "main advanced to the candidate");
    const voted = s.operations("principal").find(row => row.kind === "attest.record")!;
    assert.equal(voted.state, "succeeded");

    // The decision copy and the completion notice both reach the Principal.
    const after = s.inbox("principal").map(nameOf);
    assert.equal(after.length, 2, `decision copy + notice expected, got ${after}`);
    s.script([text("Noted.")]);
    assert.equal((await s.deliver()).kind, "delivered");
    // Neither new mail is the approval; identify each by its own content, not
    // by Maildir sort order.
    const fresh = after.filter(id => id !== approval);
    assert.equal(fresh.length, 2);
    const bodies = fresh.map(id => [id, s.archived(id)] as const);
    const describe = (id: string) => {
      const eml = s.archived(id);
      return `${id} [${eml.match(/X-Oma-Kind: [^\r\n]*/)?.[0] ?? "?"}] ${eml.match(/Subject: [^\r\n]*/)?.[0] ?? "?"}`;
    };
    const notice = bodies.find(([, eml]) => /Subject: .*applied:/i.test(eml))?.[0];
    const decision = bodies.find(([, eml]) => /Subject: .*decision recorded/i.test(eml))?.[0];
    assert.ok(notice && decision && notice !== decision,
      `expected a result notice and a decision copy, got: ${fresh.map(describe).join(" ;; ")}`);
    const report = inspectLedger(readDiagnosticSnapshot(s.root), { stateRoot: s.root, society: "demo" });
    assert.equal(report.report.status, "PASS", report.report.issues.map(issue => issue.code).join(","));
  });
});

test("SCN-R02: the Principal's own surface refuses Worker actions and worker-mail paths", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const { name } = await openMerge(s, "r02", "HIGH", change("r02"));
    assert.equal((await vote(s, "bob", name, "approve", "r02-bob")).ok, true);
    await s.idle();
    // A worker thread revision id — delivered only under the workers archive.
    const workerDir = join(s.root, "mail", "workers", "cur");
    assert.ok(existsSync(workerDir), "no worker thread mail was materialized");
    const workerId = nameOf(readdirSync(workerDir).sort()[0]!);
    const opsBefore = s.operations().length;
    s.script([
      tools(call("oma_merge", { action: "open", tier: "LOW", title: "x", reason: "x" })),
      tools(call("oma_merge", { action: "status" })),
      tools(call("oma_merge", { action: "vote", name, verdict: "approve", body: "no approval" })),
      tools(call("oma_challenge", { action: "review", name: `challenge-${name}`, body: "no" })),
      tools(call("oma_mail_read", { messageId: workerId })),
      tools(call("oma_mail_read", { messageId: `/mail/workers/cur/${workerId}:2,` })),
      tools(call("read", { path: join(s.root, "mail", "workers", "cur") })),
      text("done"),
    ]);
    await s.prompt("Try the review actions.");
    const after = s.operations();
    assert.equal(after.length, opsBefore, `nothing was recorded: ${JSON.stringify(after.slice(opsBefore))}`);
    // The result of the tool call in reply i is seen in request i+1. Each is
    // the specific refusal of its path, so a call that succeeded or failed
    // differently fails this test.
    const resultAt = (index: number) => lastResult(s.provider.seen[index]!.body);
    assert.match(resultAt(1), /Validation failed for tool "oma_merge"[\s\S]*"action": "open"/,
      `open: ${resultAt(1).slice(0, 160)}`);
    assert.match(resultAt(2), /Validation failed for tool "oma_merge"[\s\S]*"action": "status"/,
      `status: ${resultAt(2).slice(0, 160)}`);
    assert.match(resultAt(3), /approval message id is not valid: undefined/, `vote w/o approval: ${resultAt(3).slice(0, 160)}`);
    assert.match(resultAt(4), /Validation failed for tool "oma_challenge"[\s\S]*"action": "review"/,
      `challenge review: ${resultAt(4).slice(0, 160)}`);
    // A workers-audience id does not exist under the public archive the tool resolves to.
    assert.match(resultAt(5), new RegExp(`ENOENT: no such file or directory, open '.*/mail/archive/cur/${workerId}:2,'`),
      `worker id read: ${resultAt(5).slice(0, 160)}`);
    assert.match(resultAt(6), /expected a message id or canonical archive path/,
      `worker path read: ${resultAt(6).slice(0, 160)}`);
    assert.match(resultAt(7), /tool path is outside the agent workspace/, `read: ${resultAt(7).slice(0, 160)}`);
    assert.equal(s.inbox("principal").length, 0, "the request still needs one more Worker vote");

    // After the approval mail is delivered the Principal legitimately knows the
    // request -- the same worker reads stay refused, while its own mail reads.
    assert.equal((await vote(s, "carol", name, "approve", "r02-carol")).ok, true);
    await s.idle();
    const approval = pendingApproval(s, name);
    let delivered: string[] = [];
    const results: string[] = [];
    s.script((request, index) => {
      if (index > 0) results.push(lastResult(request));
      if (index === 0) {
        delivered = noticed(lastUserText(request));
        return tools(call("oma_mail_read", { messageId: workerId }));
      }
      if (index === 1) return tools(call("oma_mail_read", { messageId: `/mail/workers/cur/${workerId}:2,` }));
      if (index === 2) return tools(call("oma_mail_read", { messageId: approval }));
      return text("Read my mail.");
    });
    const outcome = await s.deliver();
    assert.equal(outcome.kind, "delivered", JSON.stringify(outcome));
    assertNoticedForPrincipal(s, delivered, approval);
    assert.equal(results.length, 3);
    assert.match(results[0]!, new RegExp(`ENOENT.*mail/archive/cur/${workerId}`), `worker id read: ${results[0]!.slice(0, 160)}`);
    assert.match(results[1]!, /expected a message id or canonical archive path/, `worker path read: ${results[1]!.slice(0, 160)}`);
    assert.match(results[2]!, /merge/, `the Principal reads its own approval mail: ${results[2]!.slice(0, 160)}`);
    assert.doesNotMatch(results[2]!, /ENOENT/);
  });
});

test("SCN-R03: a stale approval id is refused; the fresh approval's id applies", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const { name } = await openMerge(s, "r03", "HIGH", change("r03"));
    await vote(s, "bob", name, "approve", "r03-bob1");
    await vote(s, "carol", name, "approve", "r03-carol");
    await s.idle();
    const first = pendingApproval(s, name);
    // The Principal is still holding the first approval; bob flips to reject.
    assert.equal((await vote(s, "bob", name, "reject", "r03-bob2")).ok, true);
    await s.idle();
    assert.ok(s.inbox("principal").map(nameOf).some(id => id !== first), "a withdrawn mail arrived");
    let staleResult = "";
    s.script((request, index) => {
      if (index === 0)
        return tools(call("oma_merge", { action: "vote", name, verdict: "approve", body: "again", approval: first }));
      if (index === 1) { staleResult = lastResult(request); return text("stale seen"); }
      return text("done");
    });
    await s.deliver();
    assert.match(staleResult, /APPROVAL_STALE: The named approval is no longer current/, `the stale id must be refused: ${staleResult}`);
    await s.idle();
    assert.equal(s.operations().filter(row => row.kind === "attest.record" && row.actor === "principal").length, 0);
    // bob re-approves -> a new approval mail with a fresh id.
    assert.equal((await vote(s, "bob", name, "approve", "r03-bob3")).ok, true);
    await s.idle();
    const second = pendingApproval(s, name);
    assert.notEqual(second, first, "the replacement approval mail has a fresh id");
    let delivered: string[] = [];
    s.script((request, index) => {
      if (index === 0) {
        // The id is taken from the notice the model saw, not the mailbox dir.
        delivered = noticed(lastUserText(request));
        return tools(call("oma_merge", { action: "vote", name, verdict: "approve", body: "approve now", approval: second }));
      }
      return text("voted");
    });
    assert.equal((await s.deliver()).kind, "delivered");
    assert.deepEqual(delivered, [second], "only the new approval was pending");
    await s.idle();
    assert.equal(s.operations().some(row => row.actor === "principal" && row.state === "succeeded"), true);
  });
});

test("SCN-R04: a Principal reject closes the request; later Worker votes are refused", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const { name, candidate } = await openMerge(s, "r04", "HIGH", change("r04"));
    const before = canonicalMain(s);
    await vote(s, "bob", name, "approve", "r04-bob");
    await vote(s, "carol", name, "approve", "r04-carol");
    await s.idle();
    const approval = pendingApproval(s, name);
    s.script([
      tools(call("oma_merge", { action: "vote", name, verdict: "reject", body: "No.", approval })),
      text("Rejected."),
    ]);
    assert.equal((await s.deliver()).kind, "delivered");
    await s.idle();
    assert.equal(canonicalMain(s), before, "main did not move");
    const status = await s.residentCall("alice", "review.status", { name }, null) as
      { ok: boolean; result: { display: string; principal: { decision: string | null; decisionApproval: string | null } } };
    assert.ok(status.ok, `review.status refused: ${JSON.stringify(status).slice(0, 300)}`);
    assert.equal(status.result.display, "rejected");
    assert.equal(status.result.principal.decision, "reject");
    assert.equal(status.result.principal.decisionApproval, approval);
    const late = await vote(s, "bob", name, "approve", "r04-late");
    assert.equal(late.ok, false);
    assert.match(JSON.stringify(late), /REQUEST_CLOSED/);
  });
});

test("SCN-R05: MEDIUM applies on one Worker approval; the Principal sees only the completion notice", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob"] }, async s => {
    const { name, candidate } = await openMerge(s, "r05", "MEDIUM", change("r05"));
    // Before the request has applied, the Principal's diff of it is refused:
    // Worker review state is not its sightline.
    s.script([tools(call("oma_merge", { action: "diff", name })), text("seen")]);
    await s.prompt("Check the merge.");
    assert.match(lastResult(s.provider.seen[1]!.body),
      new RegExp(`CAPABILITY_DENIED: Insufficient permission`),
      `pre-application diff: ${lastResult(s.provider.seen[1]!.body).slice(0, 160)}`);
    assert.equal(s.inbox("principal").length, 0, "no request or review mail reached the Principal");
    assert.equal((await vote(s, "bob", name, "approve", "r05-bob")).ok, true);
    await s.idle();
    assert.equal(canonicalMain(s), candidate);
    const mail = s.inbox("principal").map(nameOf);
    assert.equal(mail.length, 1, "only the completion notice arrived");
    const notice = mail[0]!;
    assert.match(s.archived(notice), /X-Oma-Kind: result/i);
    let seenIds: string[] = [];
    const results: string[] = [];
    s.script((request, index) => {
      if (index > 0) results.push(lastResult(request));
      if (index === 0) {
        seenIds = noticed(lastUserText(request));
        return tools(call("oma_mail_read", { messageId: notice }));
      }
      if (index === 1) return tools(call("oma_merge", { action: "diff", name }));
      return text("Read.");
    });
    assert.equal((await s.deliver()).kind, "delivered");
    assert.deepEqual(seenIds, [notice]);
    assert.equal(results.length, 2);
    assert.match(results[0]!, /content r05/, "the notice body carries the applied diff");
    const diff = JSON.parse(results[1]!) as { text: string };
    assert.match(diff.text, /content r05/, "the Principal may diff a request whose notice reached it");
    assert.equal((await s.deliver()).kind, "idle");
  });
});

test("SCN-R06: an approval accepted while the engine is down delivers exactly once after restarts", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const { name } = await openMerge(s, "r06", "HIGH", change("r06"));
    await vote(s, "bob", name, "approve", "r06-bob");
    // Engine down for the second vote and the approval mail it produces.
    await s.restartEngine();
    await vote(s, "carol", name, "approve", "r06-carol");
    // A broker restart between the vote and the delivery: the prepared batch
    // survives and is presented once.
    await s.restartBroker();
    const approval = pendingApproval(s, name);
    s.script([tools(call("oma_merge", { action: "vote", name, verdict: "approve", body: "ok", approval })), text("voted")]);
    assert.equal((await s.deliver()).kind, "delivered");
    await s.idle();
    assert.equal(s.operations("principal").filter(row => row.state === "succeeded").length, 1);
    const outcome = await s.deliver();
    assert.ok(outcome.kind === "idle" || outcome.kind === "delivered");
    // Delivered once: the first batch completed, nothing queued again.
    assert.deepEqual(s.store.preparedBatches("principal"), []);
  });
});

test("SCN-R07: a completion notice over the body bound arrives in ordered parts the model reads", TIMEOUT, async () => {
  await withScenario({ residents: ["alice"], reviewBodyBytes: 8192 }, async s => {
    // A diff larger than ~3 × (bound − header) splits the notice document.
    const { name } = await openMerge(s, "r07", "LOW", work => {
      writeFileSync(join(work, "big.txt"), Array.from({ length: 900 }, (_, i) => `line ${i} ${"x".repeat(18)}`).join("\n"));
    });
    await s.idle();
    const parts = s.inbox("principal").map(nameOf);
    assert.ok(parts.length >= 3, `the notice should have split into parts, got ${parts.length}`);
    const first = readableBody(s.archived(parts[0]!));
    const sha = first.match(/sha256 ([0-9a-f]{64})/)![1]!;
    const bytes = Number(first.match(/document (\d+) bytes/)![1]);
    s.script((request, index) => {
      if (index === 0) return tools(call("oma_mail_read", { messageId: parts[0]! }));
      if (index < parts.length) return tools(call("oma_mail_read", { messageId: parts[index]! }));
      return text("Read all parts.");
    });
    assert.equal((await s.deliver()).kind, "delivered");
    // The document itself: every part read, chunks concatenated, sha256 proven.
    const bodies = parts.map(id => readableBody(s.archived(id)));
    const document = bodies.map(body => body.slice(body.indexOf("in order.\n") + "in order.\n".length)).join("");
    assert.equal(createHash("sha256").update(document, "utf8").digest("hex"), sha);
    assert.equal(Buffer.byteLength(document, "utf8"), bytes);
    assert.match(document, /diff --git a\/big\.txt/);
    assert.match(document, /Integration operation: op-/);
  });
});

test("SCN-R08: a HIGH challenge prepares the revert; the Principal sees both patches and applies it", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const { name } = await openMerge(s, "r08", "LOW", change("r08"));
    await s.idle();
    assert.equal(canonicalMain(s), await Promise.resolve().then(() => canonicalMain(s)));
    const merged = canonicalMain(s);
    const opened = await s.residentCall("alice", "attest.record",
      { kind: "challenge.open", merge: name, tier: "HIGH", title: "revert it", reason: "regression" }, "r08.ch") as
      { ok: boolean; result: { result: { request: string } } };
    assert.equal(opened.ok, true, JSON.stringify(opened).slice(0, 300));
    const challenge = opened.result.result.request;
    await vote(s, "bob", challenge, "approve", "r08-bob");
    await vote(s, "carol", challenge, "approve", "r08-carol");
    await s.idle();
    const approval = pendingApproval(s, challenge);
    let delivered: string[] = [];
    const results: string[] = [];
    s.script((request, index) => {
      if (index > 0) results.push(lastResult(request));
      if (index === 0) {
        // The completed merge's notice may ride in the same batch.
        delivered = noticed(lastUserText(request));
        return tools(call("oma_challenge", { action: "diff", name: challenge, view: "revert" }));
      }
      if (index === 1) return tools(call("oma_challenge", { action: "diff", name: challenge, view: "original" }));
      if (index === 2) return tools(call("oma_challenge", { action: "vote", name: challenge, verdict: "approve", body: "revert", approval }));
      return text("Reverted.");
    });
    assert.equal((await s.deliver()).kind, "delivered");
    assertNoticedForPrincipal(s, delivered, approval);
    assert.equal(results.length, 3);
    const revert = JSON.parse(results[0]!) as { text: string };
    assert.match(revert.text, /-content r08/, "the revert patch removes the change");
    const original = JSON.parse(results[1]!) as { text: string };
    assert.match(original.text, /\+content r08/, "the original patch adds the change");
    await s.idle();
    // The revert commit is on main; the original merge still reports applied.
    const head = canonicalMain(s);
    assert.notEqual(head, merged);
    const treeShow = execFileSync("git", ["diff", merged, head, "--", "line.txt"], { cwd: projectGitPathAt(s.root), encoding: "utf8" });
    assert.match(treeShow, /-content r08/);
    const status = await s.residentCall("alice", "review.status", { name }, null) as { result: { display: string } };
    assert.equal(status.result.display, "applied", "the original merge stays applied");
  });
});

test("SCN-R09: a same-key model vote retry returns the same receipt and records once", TIMEOUT, async () => {
  await withScenario({ residents: ["alice", "bob", "carol"] }, async s => {
    const { name, candidate } = await openMerge(s, "r09", "HIGH", change("r09"));
    await vote(s, "bob", name, "approve", "r09-bob");
    await vote(s, "carol", name, "approve", "r09-carol");
    await s.idle();
    const approval = pendingApproval(s, name);
    const voteParams = { action: "vote", name, verdict: "approve", body: "yes", approval, request: "principal-vote-r09" };
    s.script([
      tools(call("oma_merge", voteParams), call("oma_merge", voteParams)),
      text("Voted once."),
    ]);
    assert.equal((await s.deliver()).kind, "delivered");
    await s.idle();
    // Two calls, one frozen request key: one operation, one receipt id.
    const results = toolResults(s.provider.seen[1]!.body);
    assert.equal(results.length, 2);
    const receipts = results.map(r => receiptIn(r.text));
    assert.equal(receipts[0]!.state, "succeeded");
    assert.equal(receipts[0]!.operation, receipts[1]!.operation);
    assert.equal(s.operations("principal").filter(row => row.kind === "attest.record").length, 1);
    assert.equal(canonicalMain(s), candidate);
  });
});
