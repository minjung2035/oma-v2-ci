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
 * Only what the broker writes itself is collected. Staging a child process
 * worked in -- a quarantine namespace, a context commit work tree, a workspace
 * clone -- is kept: the broker lock does not reach a child, so its death is not
 * proven by this broker's start (P0-5), and such a tree is reported, not
 * removed. */
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { OperationRow, Store } from "../store.js";
import { parseMessageId, parseOperationId } from "../domain/identifiers.js";
import { submitBundlePathAt } from "../storage/paths.js";
import { removeOwnedFile, removeOwnedTree } from "../storage/directory.js";
import { namedMessage } from "../mail/materializer.js";

export interface PreacceptCollection {
  readonly removed: readonly string[];
  readonly kept: readonly { readonly path: string; readonly reason: string }[];
}
/** The one-time temporary a publication names `.<target>.<uuid>.tmp`. */
const PUBLICATION_TEMPORARY = /^\..+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

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
  // Frozen message objects: the plan that owns one names its id.
  const objects = join(stateRoot, "mail", "objects");
  for (const name of names(objects)) {
    const path = join(objects, name);
    if (PUBLICATION_TEMPORARY.test(name)) { remove(path); continue; }
    const message = name.endsWith(".eml") ? parseMessageId(name.slice(0, -4)) : null;
    if (message === null || !lstatSync(path).isFile()) { kept.push({ path, reason: "not a name this broker derives" }); continue; }
    const operation = accepted(message.operationId);
    if (operation !== null && namedMessage(operation)?.id === name.slice(0, -4)) continue;
    remove(path);
  }
  // Publication temporaries beside archive and mailbox names.
  for (const directory of [join(stateRoot, "mail", "archive", "cur"), ...names(join(stateRoot, "mail", "inboxes"))
    .flatMap(actor => ["new", "cur"].map(folder => join(stateRoot, "mail", "inboxes", actor, folder)))])
    for (const name of names(directory)) if (PUBLICATION_TEMPORARY.test(name)) remove(join(directory, name));
  // Staging: in-process names are collected, a child's are kept.
  const staging = join(stateRoot, "staging");
  for (const name of names(staging)) {
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
      if (accepted(context) === null)
        kept.push({ path, reason: "unaccepted, but a native preparation may have worked in it; its quiescence is not proven" });
      continue;
    }
    if (name.startsWith("quarantine-ns-")) { kept.push({ path, reason: "a quarantine namespace; its commands' quiescence is not proven" }); continue; }
    kept.push({ path, reason: "not a name this broker derives" });
  }
  return Object.freeze({ removed: Object.freeze(removed), kept: Object.freeze(kept.map(entry => Object.freeze(entry))) });
}
