import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  readSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import type { Actor, PreparedBatch } from "../../implementation/contracts.js";
import { StoreError } from "../domain/errors.js";
import { isValidBatchId, isValidMessageId } from "../domain/identifiers.js";
import { parseJsonObject } from "../frame.js";
import {
  ensureDurableDirectory,
  faultAt,
  fsyncHeldDir,
  isDurabilityFault,
  type DurabilityObserver,
} from "./durable-fs.js";
import { entryAt, linkDescriptor, openBeneath, openDirectory, openRegularBeneath } from "./contained-fs.js";
import { runnerReceiptPathAt, sessionDirPathAt } from "./paths.js";

export const PI_ADAPTER_REVISION = "oma-pi-rpc-v1@0.87.1";
export const PI_BOUNDARY_PREFIX = "OMA_PI_BOUNDARY_V1 ";
export interface DeliveryBoundary {
  readonly batchId: string;
  readonly incarnation: number;
  readonly sessionPath: string;
  readonly entryId: string;
  readonly adapterRevision: string;
}
export interface DeliveryReceipt extends DeliveryBoundary {
  readonly schemaVersion: 1;
  readonly actor: Actor;
  readonly messageIds: readonly string[];
}
declare const checkedReceipt: unique symbol;
/** A receipt this module decoded against the batch it is expected to record.
 * The type names that check; only `decodeDeliveryReceipt` issues one, and
 * `isCheckedReceipt` asks this module instead of trusting a cast. */
export type CheckedReceipt = DeliveryReceipt & { readonly [checkedReceipt]: true };
const issuedReceipts = new WeakSet<object>();
export function isCheckedReceipt(value: unknown): value is CheckedReceipt {
  return typeof value === "object" && value !== null && issuedReceipts.has(value);
}
/** Identity only: never session content, entry text or credentials. */
export interface ReceiptIdentity {
  readonly actor: string;
  readonly batchId: string;
  readonly incarnation: number;
  readonly adapterRevision: string;
  readonly messageIds: readonly string[];
}
export type ReceiptProblem =
  | "runner-root-unavailable" | "receipt-directory-unavailable" | "receipt-path-not-contained"
  | "receipt-unreadable" | "receipt-not-private-regular" | "receipt-changed-while-read" | "receipt-not-json"
  | "receipt-identity-differs" | "session-absent" | "session-unavailable" | "session-invalid";
export interface ReceiptDiagnostic {
  readonly problem: ReceiptProblem;
  /** The errno-style code of the step that failed, or null. */
  readonly cause: string | null;
  readonly expected: ReceiptIdentity;
  /** What the stored receipt claims, when it parsed as a JSON object. */
  readonly observed: Partial<ReceiptIdentity> | null;
}
/** D01: the one observation every consumer of a receipt sees the same way.
 * Only `verified` may settle a batch and only `absent` may let a runner present
 * it again; `unavailable` and `conflicting` are neither. */
export type ReceiptObservation =
  | { readonly kind: "verified"; readonly receipt: CheckedReceipt }
  | { readonly kind: "absent"; readonly missing: "receipt" | "receipt-directory" }
  | { readonly kind: "unavailable"; readonly diagnostic: ReceiptDiagnostic }
  | { readonly kind: "conflicting"; readonly diagnostic: ReceiptDiagnostic };
interface Failed { readonly failed: "unavailable" | "conflicting"; readonly problem: ReceiptProblem; readonly cause: string | null }

function invalid(message: string): never {
  throw new StoreError("BATCH_CONFLICT", `delivery receipt: ${message}`);
}
function errnoOf(error: unknown): string | null {
  return error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
}
/** A containment refusal (link, escape, non-directory, non-regular) is a layout
 * that conflicts with the receipt path; another errno is an observation that
 * did not complete. Anything else is not an observation failure. */
function openFailure(error: unknown, unavailable: ReceiptProblem): Failed {
  if (error instanceof StoreError && error.code === "STORE_CORRUPT")
    return { failed: "conflicting", problem: "receipt-path-not-contained", cause: null };
  const code = errnoOf(error);
  if (code === null || error instanceof StoreError) throw error;
  return { failed: "unavailable", problem: unavailable, cause: code };
}
function readBoundedFd(fd: number, maximum: number): Buffer | Failed {
  const before = fstatSync(fd);
  if (!before.isFile() || before.size < 1 || before.size > maximum || (before.mode & 0o777) !== 0o600)
    return { failed: "conflicting", problem: "receipt-not-private-regular", cause: null };
  const buffer = Buffer.alloc(before.size + 1);
  let total = 0;
  try {
    while (total < buffer.length) {
      const count = readSync(fd, buffer, total, buffer.length - total, total);
      if (count === 0) break;
      total += count;
    }
  } catch (error) {
    const code = errnoOf(error);
    if (code === null) throw error;
    return { failed: "unavailable", problem: "receipt-unreadable", cause: code };
  }
  const after = fstatSync(fd);
  if (total !== before.size || after.dev !== before.dev || after.ino !== before.ino ||
      after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
    return { failed: "unavailable", problem: "receipt-changed-while-read", cause: null };
  return buffer.subarray(0, total);
}
function requireBytes(bytes: Buffer | Failed): Buffer {
  if (Buffer.isBuffer(bytes)) return bytes;
  return invalid(bytes.problem === "receipt-changed-while-read" ? "file changed while being read" : "file is not a bounded private regular file");
}
function record(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}
/** FS-005, SB-006: the session directory is one the engine -- and so, for a Resident, the
 * model's sandbox -- writes. The named file is found beneath it in one
 * resolution that follows no link at any component, never by resolving the
 * path and then opening it again. */
function sessionPathCheck(stateRoot: string, actor: Actor, value: unknown): Failed | null {
  const bad: Failed = { failed: "conflicting", problem: "session-invalid", cause: null };
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0") || !value.endsWith(".jsonl") || normalize(value) !== value)
    return bad;
  const offset = relative(sessionDirPathAt(stateRoot, actor), value);
  if (offset === "" || offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) return bad;
  let directory: number | undefined;
  let fd: number | undefined;
  try {
    directory = openDirectory(sessionDirPathAt(stateRoot, actor));
    fd = openRegularBeneath(directory, offset);
    return fstatSync(fd).size > 0 ? null : bad;
  } catch (error) {
    if (error instanceof StoreError) return { failed: "conflicting", problem: "session-invalid", cause: error.code };
    const code = errnoOf(error);
    if (code === null) throw error;
    if (code === "ENOENT") return { failed: "conflicting", problem: "session-absent", cause: code };
    if (code === "ELOOP" || code === "ENOTDIR") return { failed: "conflicting", problem: "session-invalid", cause: code };
    return { failed: "unavailable", problem: "session-unavailable", cause: code };
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (directory !== undefined) closeSync(directory);
  }
}
function checkReceipt(raw: unknown, expected: PreparedBatch, stateRoot: string): CheckedReceipt | Failed {
  const value = record(raw);
  const differs: Failed = { failed: "conflicting", problem: "receipt-identity-differs", cause: null };
  if (value === null) return differs;
  const keys = [
    "schemaVersion",
    "adapterRevision",
    "batchId",
    "actor",
    "incarnation",
    "messageIds",
    "sessionPath",
    "entryId",
  ];
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    value.schemaVersion !== 1 ||
    value.adapterRevision !== PI_ADAPTER_REVISION ||
    value.batchId !== expected.id ||
    !isValidBatchId(value.batchId) ||
    value.actor !== expected.agent ||
    value.incarnation !== expected.incarnation ||
    !Number.isSafeInteger(value.incarnation) ||
    !Array.isArray(value.messageIds) ||
    value.messageIds.length !== expected.messageIds.length ||
    value.messageIds.some(
      (id, index) =>
        typeof id !== "string" ||
        !isValidMessageId(id) ||
        id !== expected.messageIds[index],
    ) ||
    typeof value.entryId !== "string" ||
    !/^[0-9a-f]{8}$/.test(value.entryId)
  )
    return differs;
  const session = sessionPathCheck(stateRoot, expected.agent, value.sessionPath);
  if (session !== null) return session;
  // Every field now equals the expected batch or passed its own check.
  const receipt: DeliveryReceipt = Object.freeze({
    schemaVersion: 1,
    adapterRevision: PI_ADAPTER_REVISION,
    batchId: expected.id,
    actor: expected.agent,
    incarnation: expected.incarnation,
    messageIds: Object.freeze([...expected.messageIds]),
    sessionPath: value.sessionPath as string,
    entryId: value.entryId,
  });
  issuedReceipts.add(receipt);
  return receipt as CheckedReceipt;
}
export function decodeDeliveryReceipt(
  raw: unknown,
  expected: PreparedBatch,
  stateRoot: string,
): CheckedReceipt {
  const checked = checkReceipt(raw, expected, stateRoot);
  if ("failed" in checked)
    return invalid("content does not match the prepared batch and pinned adapter");
  return checked;
}
function claimedIdentity(raw: unknown): Partial<ReceiptIdentity> | null {
  const value = record(raw);
  if (value === null) return null;
  return Object.freeze({
    ...(typeof value.actor === "string" ? { actor: value.actor } : {}),
    ...(typeof value.batchId === "string" ? { batchId: value.batchId } : {}),
    ...(Number.isSafeInteger(value.incarnation) ? { incarnation: value.incarnation as number } : {}),
    ...(typeof value.adapterRevision === "string" ? { adapterRevision: value.adapterRevision } : {}),
    ...(Array.isArray(value.messageIds) && value.messageIds.every(id => typeof id === "string")
      ? { messageIds: Object.freeze([...value.messageIds as string[]]) } : {}),
  });
}
/** D01/BATCH-004 observation of one batch's receipt, bounded and outside T.
 * Absence is observed only as a missing final name under an opened receipt
 * directory, or a missing receipt directory under the runner root the batch
 * was prepared beneath: publication creates that directory with the first
 * receipt. Any other failure is unavailable or conflicting, never absent. */
export function observeDeliveryReceipt(
  stateRoot: string,
  batch: PreparedBatch,
  maximum: number,
): ReceiptObservation {
  const path = runnerReceiptPathAt(stateRoot, batch.agent, batch.id);
  const expected: ReceiptIdentity = Object.freeze({ actor: batch.agent, batchId: batch.id, incarnation: batch.incarnation,
    adapterRevision: PI_ADAPTER_REVISION, messageIds: Object.freeze([...batch.messageIds]) });
  const failed = (failure: Failed, observed: Partial<ReceiptIdentity> | null = null): ReceiptObservation => ({
    kind: failure.failed,
    diagnostic: Object.freeze({ problem: failure.problem, cause: failure.cause, expected, observed }),
  });
  let parent: number;
  try { parent = openDirectory(dirname(path)); }
  catch (error) {
    if (errnoOf(error) !== "ENOENT") return failed(openFailure(error, "receipt-directory-unavailable"));
    try { closeSync(openDirectory(dirname(dirname(path)))); }
    catch (rootError) { return failed(openFailure(rootError, "runner-root-unavailable")); }
    return { kind: "absent", missing: "receipt-directory" };
  }
  try {
    let fd: number;
    try { fd = openRegularBeneath(parent, basename(path)); }
    catch (error) {
      if (errnoOf(error) === "ENOENT") return { kind: "absent", missing: "receipt" };
      return failed(openFailure(error, "receipt-unreadable"));
    }
    try {
      const bytes = readBoundedFd(fd, maximum);
      if (!Buffer.isBuffer(bytes)) return failed(bytes);
      let raw: unknown;
      try { raw = parseJsonObject(bytes).raw; }
      catch { return failed({ failed: "conflicting", problem: "receipt-not-json", cause: null }); }
      const checked = checkReceipt(raw, batch, stateRoot);
      return "failed" in checked ? failed(checked, claimedIdentity(raw)) : { kind: "verified", receipt: checked };
    } finally { closeSync(fd); }
  } finally { closeSync(parent); }
}
/** The one mapping from an observation that cannot settle to the error its
 * consumer reports: missing evidence, an observation to repeat, or evidence to
 * preserve for repair (spec error table: SESSION_BOUNDARY_UNCONFIRMED is an
 * insufficient receipt, BATCH_CONFLICT an ownership/snapshot mismatch). */
export function requireVerifiedReceipt(observation: ReceiptObservation): CheckedReceipt {
  switch (observation.kind) {
    case "verified": return observation.receipt;
    case "absent":
      throw new StoreError("SESSION_BOUNDARY_UNCONFIRMED", `no durable delivery receipt exists (${observation.missing} absent)`);
    case "unavailable":
      throw new StoreError("BROKER_UNAVAILABLE", `delivery receipt observation is unavailable: ${observation.diagnostic.problem}`,
        { cause: observation.diagnostic });
    case "conflicting":
      throw new StoreError("BATCH_CONFLICT", `delivery receipt conflicts with the prepared batch: ${observation.diagnostic.problem}`,
        { cause: observation.diagnostic });
  }
}
export function readDeliveryReceipt(
  stateRoot: string,
  batch: PreparedBatch,
  maximum: number,
): CheckedReceipt {
  return requireVerifiedReceipt(observeDeliveryReceipt(stateRoot, batch, maximum));
}
export function publishDeliveryReceipt(
  stateRoot: string,
  batch: PreparedBatch,
  boundary: DeliveryBoundary,
  maximum: number,
  faults?: DurabilityObserver,
 ): CheckedReceipt {
  const candidate = decodeDeliveryReceipt({
    schemaVersion: 1,
    actor: batch.agent,
    messageIds: [...batch.messageIds],
    ...boundary,
  }, batch, stateRoot);
  const encoded = `${JSON.stringify(candidate)}\n`;
  if (Buffer.byteLength(encoded) > maximum)
    return invalid("encoded receipt exceeds the configured frame limit");
  const path = runnerReceiptPathAt(stateRoot, batch.agent, batch.id);
  ensureDurableDirectory(dirname(path), 0o700, faults);
  const parent = openDirectory(dirname(path));
  const finalName = basename(path);
  const temporaryName = `.${finalName}.${randomUUID()}.tmp`;
  const temporaryPath = join(dirname(path), temporaryName);
  let fd: number | undefined;
  let temporaryExists = false;
  let crashed = false;
  try {
    faultAt(faults, "file-create", "before", temporaryPath);
    fd = openBeneath(parent, temporaryName, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    temporaryExists = true;
    faultAt(faults, "file-create", "after-visible", temporaryPath);
    faultAt(faults, "file-write", "before", temporaryPath);
    writeFileSync(fd, encoded);
    faultAt(faults, "file-write", "ambiguous", temporaryPath);
    faultAt(faults, "file-fsync", "ambiguous", temporaryPath);
    fsyncSync(fd);
    faultAt(faults, "file-fsync", "after-visible", temporaryPath);
    decodeDeliveryReceipt(parseJsonObject(requireBytes(readBoundedFd(fd, maximum))).raw, batch, stateRoot);
    faultAt(faults, "publication-link", "before", path);
    try { linkDescriptor(fd, parent, finalName); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    faultAt(faults, "publication-link", "after-visible", path);
    faultAt(faults, "destination-validate", "before", path);
    const published = openRegularBeneath(parent, finalName);
    let result: CheckedReceipt;
    try { result = decodeDeliveryReceipt(parseJsonObject(requireBytes(readBoundedFd(published, maximum))).raw, batch, stateRoot); }
    finally { closeSync(published); }
    faultAt(faults, "destination-validate", "after-visible", path);
    unlinkSync(entryAt(parent, temporaryName));
    temporaryExists = false;
    faultAt(faults, "temporary-cleanup", "after-visible", temporaryPath);
    fsyncHeldDir(parent, dirname(path), faults);
    return result;
  } catch (error) {
    crashed = isDurabilityFault(error);
    if (!crashed && temporaryExists) {
      try {
        unlinkSync(entryAt(parent, temporaryName));
        temporaryExists = false;
        faultAt(faults, "temporary-cleanup", "after-visible", temporaryPath);
        fsyncHeldDir(parent, dirname(path), faults);
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "receipt publication and temporary cleanup failed");
      }
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
    closeSync(parent);
    void crashed;
  }
}
