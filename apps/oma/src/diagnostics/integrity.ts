/** P6: read-only, phase-aware diagnostics. No Store writes or recovery imports. */
import { join } from "node:path";
import type { ExecutionObservation } from "@oma/contracts/runtime";
import type { ContextEntry } from "@oma/contracts/values";
import type { MessagePlan } from "@oma/contracts/durable";
import type { GitReadPort } from "@oma/git/read-port";
import type { GitObservation } from "@oma/contracts/git";
import type { AgentRow } from "@oma/contracts/ledger";
import { mailObjectPathAt, mailArchivePathAt, mailAudiencePathAt, mailInboxPathAt, contextRevisionPathAt } from "@oma/domain/paths";
import { contextRevisionLinkFor, maildirCurName } from "@oma/domain/derived";
import { isValidFullOid } from "@oma/domain/identifiers";
import { inspectLedger, type InspectionContext } from "./ledger.js";
import type { FileObservation, IntegrityFiles } from "./files.js";

export interface IntegrityOptions {
  readonly files: IntegrityFiles;
  readonly git?: GitReadPort & {
    contextTree?(repository: string, candidate: string, entries: readonly ContextEntry[]): FileObservation;
  };
  readonly units?: (agent: AgentRow) => FileObservation<ExecutionObservation>;
  readonly mode?: "offline" | "live";
  readonly maxRows?: number;
  readonly maxIssues?: number;
}
/** This report never authorizes an effect, promotes an operation, or proves a
 * process dead. Live DB/files/ref/unit observations are not one atomic snapshot.
 */
export function inspectIntegrity(snapshot: unknown, context: InspectionContext, options: IntegrityOptions) {
  const result = inspectLedger(snapshot, context, options), { facts, ledger, scanned } = result;
  const mode = options.mode ?? "offline";
  let physicalChecks = 0, pendingPublications = 0;
  const finish = () => Object.freeze({ ...ledger.report(facts, scanned), mode, physicalChecks, pendingPublications,
    scope: "read-only bounded observations; not release, provider, whole-scope death or power-loss proof" });
  if (result.report.status !== "PASS") return finish(); // Bad durable input never reaches a physical observer.
  const observe = <T>(work: () => FileObservation<T>): FileObservation<T> => {
    physicalChecks++;
    try { return work(); } catch { return { kind: "unknown", reason: "OBSERVER_FAILED" }; }
  };
  const fileResult = (value: FileObservation<unknown>, tag: string, identity: string | null, required = false) => {
    if (value.kind === "corrupt") ledger.add("corrupt", `${tag}_INVALID`, "filesystem", identity);
    else if (value.kind === "unknown") ledger.add("unknown", `${tag}_UNAVAILABLE`, "filesystem", identity);
    else if (value.kind === "absent" && required) ledger.add("corrupt", `${tag}_MISSING`, "filesystem", identity);
  };
  const { files, git } = options;
  const actorNames = new Set(facts.agents.map(agent => agent.name));
  const expectedObjects = new Set<string>(), expectedArchives = new Set<string>(), expectedWorkers = new Set<string>();
  const inboxes = new Map(facts.agents.map(agent => [agent.name, { new: new Set<string>(), cur: new Set<string>() }]));
  const publishedMail = new Set<string>();
  for (const operation of facts.operations) {
    // mail-v1: the messages an operation owns follow its plan's union — a review
    // attest.record owns its thread/approval/etc. mail and a merge integration
    // its notice parts. A legacy attest.record's publication mail keeps today's
    // coverage (none here) exactly as before.
    let messages: readonly MessagePlan[];
    switch (operation.kind) {
      case "attest.record": messages = "messages" in operation.plan ? operation.plan.messages : []; break;
      case "mail.send": case "agent.continue": case "git.submit": case "context.publish": messages = [operation.plan.message]; break;
      case "agent.create": messages = operation.plan.initialMessage === null ? [] : [operation.plan.initialMessage]; break;
      case "git.integrate": messages = operation.plan.merge === undefined ? [] : operation.plan.merge.notice; break;
      default: messages = [];
    }
    if (messages.length === 0) continue;
    let archiveAbsent = false;
    for (const message of messages) {
      const expectation = { bytes: message.bytes, sha256: message.sha256 };
      expectedObjects.add(`${message.id}.eml`);
      (message.audience === "workers" ? expectedWorkers : expectedArchives).add(maildirCurName(message.id));
      fileResult(observe(() => files.file(mailObjectPathAt(context.stateRoot, message.id), { ...expectation, mail: { message, society: context.society, actorNames } })), "MAIL_OBJECT", operation.id, true);
      const archive = observe(() => files.file(mailAudiencePathAt(context.stateRoot, message), expectation));
      fileResult(archive, "MAIL_ARCHIVE", operation.id, operation.state === "succeeded");
      if (archive.kind === "present") publishedMail.add(operation.id);
      else if (archive.kind === "absent") {
        archiveAbsent = true;
        if (operation.state !== "failed") pendingPublications++;
      }
      for (const delivery of facts.deliveries.filter(row => row.operationId === operation.id && row.messageId === message.id)) {
        inboxes.get(delivery.recipient)?.new.add(message.id);
        inboxes.get(delivery.recipient)?.cur.add(maildirCurName(message.id));
        const current = observe(() => files.file(mailInboxPathAt(context.stateRoot, delivery.recipient, message.id, "cur"), expectation));
        const fresh = observe(() => files.file(mailInboxPathAt(context.stateRoot, delivery.recipient, message.id, "new"), expectation));
        fileResult(current, "INBOX_CUR", message.id); fileResult(fresh, "INBOX_NEW", message.id);
        if (current.kind === "present" || fresh.kind === "present") publishedMail.add(operation.id);
        if (current.kind === "present" && fresh.kind === "present") ledger.add("corrupt", "DUPLICATE_MAILBOX_NAMES", "filesystem", message.id);
        if (delivery.materialized === 1 && current.kind === "absent" && fresh.kind === "absent") ledger.add("corrupt", "MATERIALIZED_FILE_MISSING", "filesystem", message.id);
        if (delivery.presented === 1 && current.kind === "absent") ledger.add("corrupt", "PRESENTED_CUR_MISSING", "filesystem", message.id);
        if (operation.state === "succeeded" && delivery.materialized !== 1) ledger.add("corrupt", "SUCCESS_WITH_UNMATERIALIZED_DELIVERY", "deliveries", message.id);
      }
    }
    if (archiveAbsent && publishedMail.has(operation.id)) ledger.add("corrupt", "DELIVERY_WITHOUT_ARCHIVE", "filesystem", operation.id);
    if (operation.state === "failed" && publishedMail.has(operation.id)) ledger.add("corrupt", "FAILED_PARENT_PUBLICATION", "filesystem", operation.id);
    if (operation.kind === "agent.create" && publishedMail.has(operation.id) && facts.agents.find(agent => agent.name === operation.plan.spec.name)?.desired === "provisioning")
      ledger.add("corrupt", "CREATE_MAIL_BEFORE_READY", "filesystem", operation.id);
  }
  const names = (path: string, expected: ReadonlySet<string>, tag: string, unowned: "corrupt" | "unknown" = "corrupt") => {
    const entries = observe(() => files.names(path)); fileResult(entries, tag, null);
    if (entries.kind === "present") for (const entry of entries.value) {
      if (entry.type !== "file") ledger.add("corrupt", `${tag}_TYPE`, "filesystem");
      else if (!expected.has(entry.name)) ledger.add(unowned, `${tag}_UNOWNED`, "filesystem");
    }
  };
  names(join(context.stateRoot, "mail/objects"), expectedObjects, "OBJECT_DIRECTORY", "unknown"); // Preaccept orphans are not silently repaired.
  names(join(context.stateRoot, "mail/archive/cur"), expectedArchives, "ARCHIVE_DIRECTORY");
  names(join(context.stateRoot, "mail/archive/new"), new Set(), "ARCHIVE_NEW_DIRECTORY");
  // mail-v1: worker-only review mail lives under its own archive; a message's
  // audience decides which directory's expected names it is counted under.
  names(join(context.stateRoot, "mail/workers/cur"), expectedWorkers, "WORKERS_DIRECTORY");
  names(join(context.stateRoot, "mail/workers/new"), new Set(), "WORKERS_NEW_DIRECTORY");
  const mailboxNames = observe(() => files.names(join(context.stateRoot, "mail/inboxes")));
  fileResult(mailboxNames, "MAILBOX_DIRECTORY", null);
  if (mailboxNames.kind === "present") for (const entry of mailboxNames.value)
    if (entry.type !== "directory" || !inboxes.has(entry.name)) ledger.add("corrupt", "UNKNOWN_MAILBOX", "filesystem");
  for (const [actor, expected] of inboxes) {
    names(join(context.stateRoot, "mail/inboxes", actor, "new"), expected.new, "INBOX_DIRECTORY");
    names(join(context.stateRoot, "mail/inboxes", actor, "cur"), expected.cur, "INBOX_DIRECTORY");
  }
  const gitResult = <T>(value: GitObservation<T>, tag: string, id: string, required = false): void => {
    if (value.kind === "unknown") ledger.add("unknown", `${tag}_UNAVAILABLE`, "git", id);
    else if (value.kind === "corrupt" || (required && value.kind === "absent")) ledger.add("corrupt", `${tag}_INVALID`, "git", id);
  };
  const gitCall = <T>(work: () => GitObservation<T>): GitObservation<T> => {
    physicalChecks++;
    try { return work(); } catch { return { kind: "unknown", reason: "OBSERVER_FAILED", evidence: { status: null, signal: null, stdout: null, stderr: null } }; }
  };
  const project = join(context.stateRoot, "repos/project.git"), contextRepo = join(context.stateRoot, "repos/context.git");
  const contextOperations = facts.operations.filter(operation => operation.kind === "context.publish");
  for (const operation of facts.operations) {
    if (operation.kind !== "git.submit" && operation.kind !== "git.integrate" && operation.kind !== "context.publish") continue;
    if (!git) { ledger.add("unknown", "GIT_NOT_OBSERVED", "git", operation.id); continue; }
    const repository = operation.kind === "context.publish" ? contextRepo : project;
    const commit = gitCall(() => git.commit(repository, operation.plan.candidate));
    gitResult(commit, "CANDIDATE", operation.id, operation.state === "succeeded" || publishedMail.has(operation.id));
    if (operation.kind === "git.submit") {
      const ref = gitCall(() => git.ref(project, operation.plan.publishedRef));
      gitResult(ref, "PUBLISHED_REF", operation.id, operation.state === "succeeded" || publishedMail.has(operation.id));
      if (ref.kind === "present" && operation.state === "failed") ledger.add("corrupt", "FAILED_SUBMISSION_REF", "git", operation.id);
      if (ref.kind === "present" && ref.value !== operation.plan.candidate) ledger.add("corrupt", "PUBLISHED_REF_MISMATCH", "git", operation.id);
    } else if (operation.kind === "git.integrate" && operation.state === "succeeded") {
      const main = gitCall(() => git.ref(project, "refs/heads/main")); gitResult(main, "MAIN_REF", operation.id, true);
      if (main.kind === "present") {
        if (!isValidFullOid(main.value)) { ledger.add("corrupt", "INVALID_MAIN_OID", "git", operation.id); continue; }
        const ancestry = gitCall(() => git.ancestry(project, operation.plan.candidate, main.value));
        gitResult(ancestry, "INTEGRATED_ANCESTRY", operation.id, true);
        if (ancestry.kind === "present" && !ancestry.value) ledger.add("corrupt", "INTEGRATED_CANDIDATE_LOST", "git", operation.id);
      }
    }
  }
  for (const operation of contextOperations) {
    if (git && (operation.state === "succeeded" || publishedMail.has(operation.id))) {
      if (!git.contextTree) ledger.add("unknown", "CONTEXT_GIT_TREE_NOT_OBSERVED", "git", operation.id);
      else {
        const canonical = observe(() => git.contextTree!(contextRepo, operation.plan.candidate, operation.plan.entries));
        if (canonical.kind === "corrupt" || canonical.kind === "absent") ledger.add("corrupt", "CONTEXT_GIT_TREE_MISMATCH", "git", operation.id);
        else if (canonical.kind === "unknown") ledger.add("unknown", "CONTEXT_GIT_TREE_UNAVAILABLE", "git", operation.id);
      }
    }
    const tree = observe(() => files.contextTree(contextRevisionPathAt(join(context.stateRoot, "world"), operation.plan.candidate), operation.plan.entries));
    fileResult(tree, "CONTEXT_SNAPSHOT", operation.id, operation.state === "succeeded" || publishedMail.has(operation.id));
  }
  if (contextOperations.length && git) {
    const current = gitCall(() => git.ref(contextRepo, "refs/heads/main"));
    gitResult(current, "CONTEXT_MAIN", "context", contextOperations.some(operation => operation.state === "succeeded"));
    if (current.kind === "present" && isValidFullOid(current.value)) {
      const unresolved = contextOperations.some(operation => operation.state === "pending" || operation.state === "unknown");
      const link = observe(() => files.symlink(join(context.stateRoot, "world/context/current")));
      fileResult(link, "CONTEXT_CURRENT", "context", !unresolved);
      if (link.kind === "present" && link.value !== contextRevisionLinkFor(current.value)) {
        ledger.add(unresolved ? "unknown" : "corrupt", "CONTEXT_CURRENT_MISMATCH", "filesystem", "context");
      }
      if (!unresolved && !contextOperations.some(operation => operation.state === "succeeded" && operation.plan.candidate === current.value))
        ledger.add("corrupt", "CONTEXT_MAIN_WITHOUT_ACCEPTED_SUCCESS", "git", "context");
    } else if (current.kind === "present") ledger.add("corrupt", "INVALID_CONTEXT_OID", "git", "context");
  }
  if (mode === "live") for (const agent of facts.agents.filter(row => row.role === "resident")) {
    if (!options.units) { ledger.add("unknown", "UNIT_NOT_OBSERVED", "units", agent.name); continue; }
    const unit = observe(() => options.units!(agent));
    if (unit.kind !== "present" || unit.value.activeState === "unknown") ledger.add("unknown", "UNIT_UNAVAILABLE", "units", agent.name);
    else if (agent.desired === "stopped" && !["inactive", "failed"].includes(unit.value.activeState)) ledger.add("unknown", "STOP_INTENT_NOT_CONVERGED", "units", agent.name);
  }
  return finish();
}
