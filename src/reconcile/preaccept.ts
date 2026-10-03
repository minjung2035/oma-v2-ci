/** DR10, P0-4: an artifact made before its acceptance outlives the process
 * that owned it. `PreacceptScope` owns it while the request runs; after a
 * crash nothing did, and the diagnostics could only call it unknown.
 *
 * The name is the registration. Every such name is derived from a random
 * operation id (domain/derived.ts), so the ledger says whether an accepted plan
 * names it: no row, or a row whose plan names something else, is proof that
 * nothing accepted owns it. This runs only in startup recovery, before any
 * request is admitted: no request of this broker can still be making one, and
 * the broker that made the others is gone -- its lock is this one's.
 *
 * What the broker writes itself is collected. Staging a child process
 * worked in -- a quarantine namespace, a context commit work tree -- is
 * collected only when its lease proves every child is gone (R6-04): the broker
 * lock does not reach a child, so this broker's start proves nothing of its
 * death (P0-5), but a lease every child inherited does. One whose lease is
 * held, or that has none (made before leases), is reported and kept. */
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { OperationRow, Store } from "../store.js";
import { parseMessageId, parseOperationId } from "../domain/identifiers.js";
import { submitBundlePathAt } from "../storage/paths.js";
import { removeOwnedFile, removeOwnedTree } from "../storage/directory.js";
import { collectLeasedTree } from "../storage/tree-lease.js";
import { namedMessages } from "../mail/materializer.js";

export interface PreacceptCollection {
  readonly removed: readonly string[];
  readonly kept: readonly { readonly path: string; readonly reason: string }[];
}
/** The one-time temporary a publication names `.<target>.<uuid>.tmp`, or
 * `.<target>.<uuid>.held.tmp` when it carries its writer's lock (P0V-111). */
const PUBLICATION_TEMPORARY = /^\..+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.held)?\.tmp$/;

function names(directory: string): string[] {
  try { return readdirSync(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

export function collectUnacceptedArtifacts(stateRoot: string, store: Pick<Store, "getOperationById">): PreacceptCollection {
  const removed: string[] = [];
  const kept: { path: string; reason: string }[] = [];
  const accepted = (id: string): OperationRow | null => store.getOperationById(id);
  const remove = (path: string, tree = false): void => {
    if (tree) removeOwnedTree(path); else removeOwnedFile(path);
    removed.push(path);
  };
  const leased = (path: string, what: string): void => {
    const found = collectLeasedTree(path);
    if (found.kind === "quiescent") { removed.push(path); return; }
    kept.push({ path, reason: found.kind === "active" ? `${what}; a process that works in it still holds its lease`
      : `${what}; its quiescence is not proven (${found.reason})` });
  };
  // Frozen message objects: the plan that owns one names its id.
  const objects = join(stateRoot, "mail", "objects");
  for (const name of names(objects)) {
    const path = join(objects, name);
    if (PUBLICATION_TEMPORARY.test(name)) { remove(path); continue; }
    const message = name.endsWith(".eml") ? parseMessageId(name.slice(0, -4)) : null;
    if (message === null || !lstatSync(path).isFile()) { kept.push({ path, reason: "not a name this broker derives" }); continue; }
    const operation = accepted(message.operationId);
    if (operation !== null && namedMessages(operation).some(message => message.id === name.slice(0, -4))) continue;
    remove(path);
  }
  // Publication temporaries beside archive and mailbox names.
  for (const directory of [join(stateRoot, "mail", "archive", "cur"), join(stateRoot, "mail", "workers", "cur"),
    ...names(join(stateRoot, "mail", "inboxes"))
    .flatMap(actor => ["new", "cur"].map(folder => join(stateRoot, "mail", "inboxes", actor, folder)))])
    for (const name of names(directory)) if (PUBLICATION_TEMPORARY.test(name)) remove(join(directory, name));
  // Staging: in-process names are collected, a child's by its lease.
  const staging = join(stateRoot, "staging");
  const present = new Set(names(staging));
  for (const name of present) {
    // A lease is decided with its tree; one whose tree is gone is collected
    // the same way (the tree's absence costs nothing to "remove").
    if (name.endsWith(".lease")) {
      const tree = name.slice(0, -".lease".length);
      if (present.has(tree)) continue;
      const context = tree.startsWith("context-") ? parseOperationId(tree.slice("context-".length)) : null;
      if (tree.startsWith("quarantine-ns-") || (context !== null && accepted(context) === null)) leased(join(staging, tree), "a preparation lease without its tree");
      continue;
    }
    const path = join(staging, name);
    if (name === "mail-objects" && lstatSync(path).isDirectory()) {
      for (const temporary of names(path)) if (temporary.endsWith(".tmp")) remove(join(path, temporary));
      continue;
    }
    if (/^rpc-[0-9a-f-]{36}\.wire$/.test(name)) { remove(path); continue; }
    const submit = name.startsWith("submit-") ? parseOperationId(name.slice("submit-".length)) : null;
    if (submit !== null && lstatSync(path).isDirectory()) {
      const operation = accepted(submit);
      if (operation?.kind === "git.submit" && operation.plan.bundle?.path === submitBundlePathAt(stateRoot, submit)) continue;
      remove(path, true);
      continue;
    }
    const context = name.startsWith("context-") ? parseOperationId(name.slice("context-".length)) : null;
    if (context !== null) {
      if (accepted(context) === null) leased(path, "unaccepted, and a native preparation may have worked in it");
      continue;
    }
    if (name.startsWith("quarantine-ns-")) { leased(path, "a quarantine namespace"); continue; }
    kept.push({ path, reason: "not a name this broker derives" });
  }
  // Context revision preparation trees (publishContextRevision's
  // `.prepare-<oid>-<operation id>` under world/context/revisions): written and
  // removed inside one broker call, so an unaccepted survivor under this
  // broker's lock has no writer left; it is removed as a tree (AV-19).
  const revisions = join(stateRoot, "world", "context", "revisions");
  for (const name of names(revisions)) {
    if (!name.startsWith(".prepare-")) continue;
    const path = join(revisions, name);
    const parsed = /^\.prepare-(?:[0-9a-f]{40}|[0-9a-f]{64})-(op-[0-9a-f-]{36})$/.exec(name);
    const operation = parsed === null ? null : parseOperationId(parsed[1]!);
    if (operation === null || !lstatSync(path).isDirectory()) {
      kept.push({ path, reason: "not a name this broker derives" });
      continue;
    }
    if (accepted(operation) !== null) { kept.push({ path, reason: "its operation is accepted" }); continue; }
    remove(path, true);
  }
  return Object.freeze({ removed: Object.freeze(removed), kept: Object.freeze(kept.map(entry => Object.freeze(entry))) });
}
