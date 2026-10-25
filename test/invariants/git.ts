import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { GitObserver } from "@oma/git/observe";
import { type GitObservation } from "@oma/contracts/git";
import { GIT_ENV } from "@oma/process/policies";
import { contextRevisionPathAt } from "@oma/domain/paths";
import type { LedgerSnapshot, InvariantPhase } from "./store.js";
import { matchingFile } from "./mail.js";

export interface GitInvariantPaths { projectGit: string; contextGit: string; worldDir: string }
const observer = new GitObserver((args, input) => {
  const result = spawnSync("/usr/bin/git", [...args], { env: GIT_ENV, timeout: 30000,
    maxBuffer: 4 * 1024 * 1024, killSignal: "SIGKILL", ...(input === undefined ? {} : { input }) });
  return { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr,
    ...(result.error === undefined ? {} : { error: result.error }) };
});
function requirePresent<T>(value: GitObservation<T>, label: string): T {
  assert.equal(value.kind, "present", label);
  if (value.kind !== "present") throw new Error(label);
  return value.value;
}
export function assertGit(snapshot: LedgerSnapshot, paths: GitInvariantPaths, phase: InvariantPhase): readonly string[] {
  const incomplete: string[] = [];
  for (const operation of snapshot.operations) {
    const terminal = operation.state === "succeeded";
    if (operation.kind === "git.submit") {
      const plan = operation.plan;
      if (plan.bundle) matchingFile(plan.bundle.path, plan.bundle, true, "ACCEPTED_BUNDLE");
      const published = observer.ref(paths.projectGit, plan.publishedRef);
      if (published.kind === "present") {
        assert.equal(published.value, plan.candidate, `IMMUTABLE_PUBLISHED_REF:${operation.id}`);
        requirePresent(observer.commit(paths.projectGit, plan.candidate), "PUBLISHED_CANDIDATE_MISSING");
      } else if (terminal) requirePresent(published, "SUCCEEDED_PUBLISHED_REF_MISSING");
      else {
        assert.ok(published.kind === "absent" || phase === "unknown-external", "UNDECLARED_UNKNOWN_PUBLICATION");
        incomplete.push(`${operation.id}:published-${published.kind}`);
      }
    } else if (operation.kind === "git.integrate") {
      const plan = operation.plan;
      if (terminal) {
        requirePresent(observer.commit(paths.projectGit, plan.candidate), "HISTORICAL_INTEGRATION_OBJECT_MISSING");
        assert.equal(requirePresent(observer.ancestry(paths.projectGit, plan.base, plan.candidate), "INTEGRATION_ANCESTRY_UNKNOWN"), true, "INTEGRATION_NOT_DESCENDANT");
        // Historical receipt proves the past CAS. A later valid integrate may
        // advance main; never require today's main to equal every past candidate.
      } else if (operation.state === "pending" || operation.state === "unknown") {
        assert.ok(snapshot.recoverable.includes(operation.id), "PENDING_WRITER_NOT_RECOVERABLE");
        const current = observer.ref(paths.projectGit, plan.target);
        if (current.kind === "present" && (current.value === plan.base || current.value === plan.candidate))
          incomplete.push(`${operation.id}:main-${current.value === plan.base ? "base" : "candidate"}`);
        else { assert.equal(phase, "unknown-external", "UNDECLARED_EXTERNAL_REF_STATE"); incomplete.push(`${operation.id}:writer-blocked`); }
      }
    } else if (operation.kind === "context.publish") {
      const plan = operation.plan;
      const revision = contextRevisionPathAt(paths.worldDir, plan.candidate);
      const stat = lstatSync(revision, { throwIfNoEntry: false });
      if (terminal || stat) {
        assert.equal(stat?.isDirectory(), true, "CONTEXT_REVISION_TYPE");
        for (const entry of plan.entries) matchingFile(join(revision, entry.path), entry, true, "CONTEXT_REVISION_ENTRY");
        requirePresent(observer.commit(paths.contextGit, plan.candidate), "CONTEXT_CANDIDATE_MISSING");
      } else incomplete.push(`${operation.id}:context-snapshot-absent`);
    }
  }
  const currentLink = join(paths.worldDir, "context", "current");
  const link = lstatSync(currentLink, { throwIfNoEntry: false });
  if (link) {
    assert.equal(link.isSymbolicLink(), true, "CONTEXT_CURRENT_NOT_LINK");
    const target = readlinkSync(currentLink);
    const matching = snapshot.operations.filter(operation => operation.kind === "context.publish")
      .find(operation => operation.kind === "context.publish" && target === `revisions/${operation.plan.candidate}`);
    assert.ok(matching && matching.kind === "context.publish", "CONTEXT_CURRENT_NOT_ACCEPTED");
    if (matching?.kind === "context.publish") {
      const current = observer.ref(paths.contextGit, "refs/heads/main");
      if (current.kind === "present" && current.value === matching.plan.candidate) return incomplete;
      assert.notEqual(phase, "settled", "SETTLED_CONTEXT_LINK_REF_MISMATCH");
      incomplete.push("context-current-awaits-publication");
    }
  }
  return incomplete;
}
