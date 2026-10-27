/** The shared read-only project-binding observation; no provisioning or repair. */
import { closeSync, fstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unobserved } from "@oma/domain/errors";
import { isValidSocietyName } from "@oma/domain/identifiers";
import { openRegularBeneath, withinDirectory } from "@oma/native/files";

/** D05/WP16.03: the host identity record that binds a society to exactly one
 * project. Closed fields, at most 4 KiB, 0600 in the 0700 state root,
 * published through a private temporary, file fsync, no-replace link and
 * parent fsync before anything else of the society is written. It is host
 * metadata for quiescent backup/restore -- not a ledger, wire or receipt
 * record -- and binaries older than it cannot enforce it. */
export const PROJECT_BINDING = "project-binding.json";
export const BINDING_KIND = "oma-project-binding-v1";
export const BINDING_MAX_BYTES = 4096;
export interface ProjectBinding {
  readonly kind: typeof BINDING_KIND;
  readonly society: string;
  readonly canonicalProjectPath: string;
}
export type ProjectBindingObservation =
  | { readonly kind: "absent" }
  | { readonly kind: "bound"; readonly binding: ProjectBinding }
  | { readonly kind: "unreadable"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly reason: string };

export function observeProjectBinding(stateRoot: string): ProjectBindingObservation {
  // FS-005 / INV09: one resolution of the state root; the entry checked is the one read.
  let text: string | null;
  try {
    text = withinDirectory(join(stateRoot, PROJECT_BINDING), (directory, name) => {
      let fd: number;
      try { fd = openRegularBeneath(directory, name); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
      try {
        if (fstatSync(fd).size > BINDING_MAX_BYTES) throw new Error("the project binding is not a small regular file");
        return readFileSync(fd, "utf8");
      } finally { closeSync(fd); }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    const unknown = unobserved(error, "the project binding");
    if (unknown !== null) return { kind: "unavailable", reason: unknown.message };
    return { kind: "unreadable", reason: error instanceof Error ? error.message : String(error) };
  }
  if (text === null) return { kind: "absent" };
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.join(",") !== "canonicalProjectPath,kind,society" || record.kind !== BINDING_KIND ||
        !isValidSocietyName(record.society) || typeof record.canonicalProjectPath !== "string" ||
        !record.canonicalProjectPath.startsWith("/"))
      throw new Error("not an oma-project-binding-v1 record");
    return { kind: "bound", binding: Object.freeze({ kind: BINDING_KIND, society: record.society,
      canonicalProjectPath: record.canonicalProjectPath }) };
  } catch (error) {
    return { kind: "unreadable", reason: error instanceof Error ? error.message : String(error) };
  }
}

