/** Host metadata selecting the hot workspace or one immutable cold checkpoint.
 * It is never authority for ledger operations or proof of Resident death. */
import { closeSync, fstatSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { isValidActorName } from "@oma/domain/identifiers";
import type { Actor } from "@oma/contracts";
import { openRegularBeneath } from "@oma/native/files";
import { openOwnedDirectoryPath, repairOwnedEntryMode } from "@oma/storage/directory";

export interface StorageResident { readonly name: Actor; readonly incarnation: number }
export interface StorageCheckpoint {
  readonly snapshot: string;
  readonly roots: readonly string[];
  readonly residents: readonly StorageResident[];
  readonly digest: string;
  readonly ledger: readonly (string | null)[];
}
export interface SessionStorageState {
  readonly kind: "oma-session-storage-v1";
  readonly society: string;
  readonly project: string;
  readonly checkpoint: StorageCheckpoint | null;
}
const bad = (): never => { throw new StoreError("STORE_CORRUPT", "invalid session storage selection; existing data was retained"); };
const hash = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function keys(value: Record<string, unknown>, expected: string): void { if (Object.keys(value).sort().join(",") !== expected) bad(); }
export function readStorageText(path: string): string | null {
  const parent = openOwnedDirectoryPath(dirname(path));
  try {
    // Host metadata alone is repairable. A failed repair is not absence: the
    // checked open below must still establish either readable bytes or ENOENT.
    repairOwnedEntryMode(path);
    let fd: number;
    try { fd = openRegularBeneath(parent, basename(path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try {
      const stat = fstatSync(fd);
      if (stat.nlink !== 1 || !Number.isSafeInteger(stat.size) || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) bad();
      return readFileSync(fd, "utf8");
    } finally { closeSync(fd); }
  } finally { closeSync(parent); }
}
export function parseStorageState(text: string, society: string, project: string): SessionStorageState {
  const value: unknown = JSON.parse(text);
  if (!object(value)) return bad();
  keys(value, "checkpoint,kind,project,society");
  if (value.kind !== "oma-session-storage-v1" || value.society !== society || value.project !== project) return bad();
  const checkpoint = value.checkpoint;
  if (checkpoint === null) return value as unknown as SessionStorageState;
  if (!object(checkpoint)) return bad();
  keys(checkpoint, "digest,ledger,residents,roots,snapshot");
  if (!hash(checkpoint.snapshot) || !hash(checkpoint.digest) || !Array.isArray(checkpoint.ledger) || checkpoint.ledger.length !== 3 ||
      !hash(checkpoint.ledger[0]) || !checkpoint.ledger.every(item => item === null || hash(item)) || !Array.isArray(checkpoint.residents) || !Array.isArray(checkpoint.roots)) return bad();
  const actors = new Set<string>();
  for (const actor of checkpoint.residents) {
    if (!object(actor)) return bad();
    keys(actor, "incarnation,name");
    if (!isValidActorName(actor.name) || actors.has(actor.name) || !Number.isSafeInteger(actor.incarnation) || (actor.incarnation as number) < 0) return bad();
    actors.add(actor.name);
  }
  const allowed = new Set(["repos", "staging", ...[...actors].flatMap(name => [`agents/${name}/workspace`, `agents/${name}/home`])]);
  if (!checkpoint.roots.includes("repos") || new Set(checkpoint.roots).size !== checkpoint.roots.length || checkpoint.roots.some(root => !allowed.has(root))) return bad();
  return value as unknown as SessionStorageState;
}
