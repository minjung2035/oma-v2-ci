/** `/society`: whether this Personal session's project can start its Society.
 *
 * The slot judged is the project's own Society root, `<data>/<project>` — the
 * same root the re-entered `oma --society <project>` will bind and provision.
 * It is free only while nothing durable stands there: the test is the same
 * pair a Society start itself computes (the observed binding plus
 * `stateRootHasSociety`, which is also what unused-cleanup decides removal
 * on). A bound slot is the durable fact the command must report, an
 * unreadable or unavailable record is never promoted to absent, and a slot
 * with content but no binding is a start that never became durable — the
 * `oma --society` entry refuses it as "predates project bindings", so the
 * gate says so while the session is still alive instead of exiting first.
 * The check writes nothing; killing between it and the re-entry leaves no
 * Society record, so the next `/society` observes the same slot again. */
import { join } from "node:path";
import { sha256Hex } from "@oma/domain/canonical-json";
import { defaultSocietyFor } from "@oma/config/defaults";
import { observeProjectBinding } from "./project-binding.js";
import { stateRootHasSociety } from "./provision.js";
import { newSessionBirth, readSessionBirth, type SessionBirth } from "./session-mode.js";

/** DR24: the project's own society name — the name its settings are kept
 * under, which its first society also had. */
export function projectSociety(canonicalProjectPath: string): string {
  return defaultSocietyFor(canonicalProjectPath, sha256Hex(canonicalProjectPath));
}

export type SocietySlotCheck =
  | { readonly kind: "free"; readonly society: string }
  | { readonly kind: "refused"; readonly reason: string };

/** Read-only admission for `/society`: `free` only when the project's Society
 * slot holds no binding and no Society content; otherwise `refused` carries
 * the durable record (or the unverifiable observation) that stands in the way,
 * in words the session can show before anything exits. */
export function checkSocietySlot(dataRoot: string, canonicalProjectPath: string): SocietySlotCheck {
  const society = projectSociety(canonicalProjectPath), root = join(dataRoot, society);
  const binding = observeProjectBinding(root);
  if (binding.kind === "bound") {
    if (binding.binding.society !== society)
      return { kind: "refused", reason: `This Society root is bound to ${binding.binding.society}, not ${society}` };
    if (binding.binding.canonicalProjectPath !== canonicalProjectPath)
      return { kind: "refused", reason: `Society ${society} already belongs to the project at ${binding.binding.canonicalProjectPath}` };
    return { kind: "refused", reason: `Society ${society} is already on for this project — reopen it with \`oma --society ${society}\` or /resume` };
  }
  if (binding.kind === "unreadable")
    return { kind: "refused", reason: `This project's Society record exists but cannot be read: ${binding.reason}` };
  if (binding.kind === "unavailable")
    return { kind: "refused", reason: `Whether this project already has a Society cannot be verified now: ${binding.reason}` };
  if (stateRootHasSociety(root))
    return { kind: "refused", reason: `This project's Society root already holds records without a binding. Review ${root}; if it belongs to this project, run \`oma --society ${society} --bind-project\` once` };
  // stateRootHasSociety deliberately overlooks a lone birth record (that is
  // what lets unused cleanup remove a never-used root). For birth it is still
  // a durable record: one identical to what the re-entry publishes is a
  // crashed start's residue and resumes; any other answers for itself here.
  let saved: SessionBirth | null;
  try { saved = readSessionBirth(root); }
  catch (error) { return { kind: "refused", reason: `This project's Society record cannot be read: ${error instanceof Error ? error.message : String(error)}` }; }
  const expected = newSessionBirth(root, "society", canonicalProjectPath);
  if (saved !== null && JSON.stringify(saved) !== JSON.stringify(expected))
    return { kind: "refused", reason: `This project's Society root already records a different session (${saved.mode} ${saved.id}). Review ${root} before deciding` };
  return { kind: "free", society };
}
