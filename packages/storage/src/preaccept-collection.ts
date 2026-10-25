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
import type { DecodedOperation as OperationRow } from "@oma/protocol/operation-codec";
import type { PreacceptCollection } from "@oma/contracts/runtime";
import { isValidFullOid, parseMessageId, parseOperationId } from "@oma/domain/identifiers";
import { submitBundlePathAt } from "@oma/domain/paths";
import { removeOwnedFile, removeOwnedTree, repairOwnedEntryMode } from "./directory.js";
import { collectLeasedTree } from "./tree-lease.js";
import { ownedMessages } from "@oma/domain/durable";

/** The one-time temporary a publication names `.<target>.<uuid>.tmp`, or
 * `.<target>.<uuid>.held.tmp` when it carries its writer's lock (P0V-111). */
const PUBLICATION_TEMPORARY = /^\..+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.held)?\.tmp$/;

function names(directory: string): string[] {
  // P0-8/DR32: every directory the sweep opens is oma's own under
  // `stateRoot`; a damaged leaf mode is repaired before it is listed, and a
  // listing that still fails refuses rather than reading as empty.
  repairOwnedEntryMode(directory);
  try { return readdirSync(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

export function collectUnacceptedArtifacts(stateRoot: string, store: { getOperationById(id: string): OperationRow | null }): PreacceptCollection {
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
    // A name that vanished between the listing and its stat has nothing left
    // to collect or keep -- the race answers, not an underivable residue.
    if (message === null) { kept.push({ path, reason: "not a name this broker derives" }); continue; }
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat === undefined) continue;
    if (!stat.isFile()) { kept.push({ path, reason: "not a name this broker derives" }); continue; }
    const operation = accepted(message.operationId);
    if (operation !== null && ownedMessages(operation.plan).some(message => message.id === name.slice(0, -4))) continue;
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
      if (tree.startsWith("quarantine-ns-") || (context !== null && accepted(context) === null))
        leased(join(staging, tree), "a preparation lease without its tree");
      // An unprovable name is reported and kept, like every other name this
      // collection does not derive: silently dropping it would hide residue.
      else kept.push({ path: join(staging, name), reason: context === null
        ? "not a name this broker derives" : "its operation is accepted" });
      continue;
    }
    const path = join(staging, name);
    const staged = lstatSync(path, { throwIfNoEntry: false });
    if (staged === undefined) continue;
    if (name === "mail-objects" && staged.isDirectory()) {
      for (const temporary of names(path)) if (temporary.endsWith(".tmp")) remove(join(path, temporary));
      continue;
    }
    if (/^rpc-[0-9a-f-]{36}\.wire$/.test(name)) { remove(path); continue; }
    const submit = name.startsWith("submit-") ? parseOperationId(name.slice("submit-".length)) : null;
    if (submit !== null && staged.isDirectory()) {
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
  // Context revision preparations (AV-20261003-19): publishContextRevision
  // stages `.prepare-<oid>-<operation id>` beside the revision before its
  // atomic rename, lease-owned from creation. An accepted fact names the
  // revision itself, never this temporary. A leftover is decided first by the
  // operation binding its name carries, then by its lease when one exists:
  // a free lease (or a lease whose tree is gone) collects it, a held one keeps
  // it. The writer is this broker, never a native child, so an unaccepted
  // leftover with no lease left is still proved dead by the startup broker
  // lock and collected; an unprovable name is reported and kept, like the
  // names the staging collection does not derive.
  const revisions = join(stateRoot, "world", "context", "revisions");
  const revisionEntries = new Set(names(revisions));
  for (const name of revisionEntries) {
    const tree = name.endsWith(".lease") ? name.slice(0, -".lease".length) : name;
    const prepared = /^\.prepare-([0-9a-f]+)-(.+)$/.exec(tree);
    const operation = prepared !== null && isValidFullOid(prepared[1]!) ? parseOperationId(prepared[2]!) : null;
    const path = join(revisions, tree);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    // A published revision is a directory named by its full oid -- the
    // product itself, not residue this collection may call underivable.
    // Anything else wearing an oid's name still reaches the checks below.
    if (stat?.isDirectory() === true && isValidFullOid(name)) continue;
    if (operation === null || stat?.isDirectory() !== true) {
      if (name.endsWith(".lease") && operation !== null && !revisionEntries.has(tree))
        leased(path, "a preparation lease without its tree");
      // A revision directory is named by its oid; anything else this block
      // reaches -- an orphaned lease of another shape, a name the grammar
      // does not derive, a stray file wearing an oid's name -- is unprovable
      // and is reported and kept rather than dropped invisibly.
      else
        kept.push({ path: join(revisions, name), reason: "not a name this broker derives" });
      continue;
    }
    if (name.endsWith(".lease")) continue; // the tree's own entry decides it and its lease
    if (accepted(operation) !== null) { kept.push({ path, reason: "its operation is accepted" }); continue; }
    if (revisionEntries.has(`${tree}.lease`)) { leased(path, "an unaccepted context revision preparation"); continue; }
    remove(path, true);
  }
  return Object.freeze({ removed: Object.freeze(removed), kept: Object.freeze(kept.map(entry => Object.freeze(entry))) });
}
