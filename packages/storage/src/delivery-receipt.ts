import { unlinkAt } from "@oma/file-descriptors";
import type { DeliveryReceipt, CheckedReceipt } from "@oma/contracts/runtime";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import type { Actor, PreparedBatch } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import { isValidBatchId, isValidMessageId } from "@oma/domain/identifiers";
import { parseJsonObject } from "@oma/protocol/frame";
import {
  collectDeadTemporaries,
  createLockedTemporary,
  ensureOwnedDurableDirectory,
  faultAt,
  fsyncHeldDir,
  isDurabilityFault,
  temporaryNameFor,
  type DurabilityObserver,
} from "./durable-fs.js";
import { linkDescriptor, openBeneath, openDirectory, openRegularBeneath, closeEvery } from "@oma/native/files";
import { runnerReceiptPathAt, sessionDirPathAt } from "@oma/domain/paths";

import { PI_ADAPTER_REVISION } from "@oma/protocol/delivery-boundary";
import type { DeliveryBoundary } from "@oma/contracts";
const issuedReceipts = new WeakSet<object>();
export function isCheckedReceipt(value: unknown): value is CheckedReceipt {
  return typeof value === "object" && value !== null && issuedReceipts.has(value);
}
/** Identity only: never session content, entry text or credentials.
 * `incarnation` is the latest delivery attempt the observer accepts and
 * `earliestIncarnation` the first (DR9); a publisher expects exactly its own. */
export interface ReceiptIdentity {
  readonly actor: string;
  readonly batchId: string;
  readonly incarnation: number;
  readonly earliestIncarnation: number;
  readonly adapterRevision: string;
  readonly messageIds: readonly string[];
}
/** DR9: the delivery attempts of one batch -- every run lease from the one it
 * was created in to the latest one it was granted to. A receipt is the batch's
 * evidence when its attempt lies in this range, whatever lease is current now. */
export interface DeliveryAttempts { readonly first: number; readonly last: number }
function attemptsOf(batch: PreparedBatch, attempts?: DeliveryAttempts): DeliveryAttempts {
  const range = attempts ?? { first: batch.incarnation, last: batch.incarnation };
  if (!Number.isSafeInteger(range.first) || !Number.isSafeInteger(range.last) || range.first < 0 || range.first > range.last)
    throw new StoreError("STORE_CORRUPT", "delivery attempt range is not an ordered pair of incarnations");
  return range;
}
export type ReceiptProblem =
  | "runner-root-unavailable" | "receipt-directory-unavailable" | "receipt-path-not-contained"
  | "receipt-unreadable" | "receipt-not-private-regular" | "receipt-changed-while-read" | "receipt-not-json"
  | "receipt-identity-differs" | "session-invalid";
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
/** P0V-107 (seventh review F-04), P0-1: the session a receipt names is a
 * name, checked as one -- an absolute, normalized `.jsonl` path beneath the
 * actor's session directory. What the file holds now is not asked. The
 * receipt was published only after its boundary entry was found in that
 * file in one resolution that follows no link and was flushed
 * (`makeBoundaryDurable`, DR11, AV4); from then on the receipt is the fact.
 * The session directory is the engine's -- for a Resident, the model's
 * sandbox writes it (SB-006) -- so a file there that later changed or went
 * away would otherwise change what an already durable delivery means. */
function sessionPathCheck(stateRoot: string, actor: Actor, value: unknown): Failed | null {
  const bad: Failed = { failed: "conflicting", problem: "session-invalid", cause: null };
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0") || !value.endsWith(".jsonl") || normalize(value) !== value)
    return bad;
  const offset = relative(sessionDirPathAt(stateRoot, actor), value);
  if (offset === "" || offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) return bad;
  return null;
}
function checkReceipt(raw: unknown, expected: PreparedBatch, stateRoot: string, attempts: DeliveryAttempts): CheckedReceipt | Failed {
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
    typeof value.incarnation !== "number" ||
    !Number.isSafeInteger(value.incarnation) ||
    value.incarnation < attempts.first ||
    value.incarnation > attempts.last ||
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
  // Every field now equals the expected batch or passed its own check; the
  // attempt is the receipt's own, one of the batch's attempts (DR9).
  const receipt: DeliveryReceipt = Object.freeze({
    schemaVersion: 1,
    adapterRevision: PI_ADAPTER_REVISION,
    batchId: expected.id,
    actor: expected.agent,
    incarnation: value.incarnation as number,
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
  const checked = checkReceipt(raw, expected, stateRoot, attemptsOf(expected));
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
  attempts?: DeliveryAttempts,
): ReceiptObservation {
  const range = attemptsOf(batch, attempts);
  const path = runnerReceiptPathAt(stateRoot, batch.agent, batch.id);
  const expected: ReceiptIdentity = Object.freeze({ actor: batch.agent, batchId: batch.id, incarnation: range.last,
    earliestIncarnation: range.first, adapterRevision: PI_ADAPTER_REVISION, messageIds: Object.freeze([...batch.messageIds]) });
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
      const checked = checkReceipt(raw, batch, stateRoot, range);
      return "failed" in checked ? failed(checked, claimedIdentity(raw)) : { kind: "verified", receipt: checked };
    } finally { closeSync(fd); }
  } finally { closeSync(parent); }
}
/** D01's decision table, P0-2: the one answer to "this batch's receipt was
 * observed -- what may happen now?". Every consumer asks this and only this:
 * the broker opening a run, the Resident's runner, the Principal's host.
 *
 *   verified    -> settle: the boundary is a past fact; record it, present nothing
 *   absent      -> present: no durable boundary exists, so the batch may be
 *                  presented (again, with the redelivery notice) -- absence of
 *                  evidence is not evidence of no earlier presentation (DR6)
 *   unavailable -> hold: observe again; nothing is presented or settled
 *   conflicting -> hold: preserve the evidence for repair
 *
 * What each consumer does with a decision is its own (lifetimes differ); what
 * the observation means is decided here once. The errors are the spec's:
 * BROKER_UNAVAILABLE an observation to repeat, BATCH_CONFLICT an ownership or
 * snapshot mismatch. */
export type DeliveryDecision =
  | { readonly action: "settle"; readonly receipt: CheckedReceipt }
  | { readonly action: "present"; readonly missing: "receipt" | "receipt-directory" }
  | { readonly action: "hold"; readonly error: StoreError };
export function deliveryDecision(observation: ReceiptObservation): DeliveryDecision {
  switch (observation.kind) {
    case "verified": return { action: "settle", receipt: observation.receipt };
    case "absent": return { action: "present", missing: observation.missing };
    case "unavailable":
      return { action: "hold", error: new StoreError("BROKER_UNAVAILABLE",
        `delivery receipt observation is unavailable: ${observation.diagnostic.problem}`, { cause: observation.diagnostic }) };
    case "conflicting":
      return { action: "hold", error: new StoreError("BATCH_CONFLICT",
        `delivery receipt conflicts with the batch; it is kept for diagnosis: ${observation.diagnostic.problem}`, { cause: observation.diagnostic }) };
  }
}
/** A completion needs evidence: the decision, where "present" means there is
 * none (SESSION_BOUNDARY_UNCONFIRMED, an insufficient receipt). */
export function requireVerifiedReceipt(observation: ReceiptObservation): CheckedReceipt {
  const decision = deliveryDecision(observation);
  switch (decision.action) {
    case "settle": return decision.receipt;
    case "present":
      throw new StoreError("SESSION_BOUNDARY_UNCONFIRMED", `no durable delivery receipt exists (${decision.missing} absent)`);
    case "hold": throw decision.error;
  }
}
export function readDeliveryReceipt(
  stateRoot: string,
  batch: PreparedBatch,
  maximum: number,
  attempts?: DeliveryAttempts,
): CheckedReceipt {
  return requireVerifiedReceipt(observeDeliveryReceipt(stateRoot, batch, maximum, attempts));
}
/** The boundary entry the trusted extension appends, as Pi writes it: a custom
 * entry of the adapter's type naming this batch, attempt and manifest. */
function isBoundaryEntry(line: string, batch: PreparedBatch, boundary: DeliveryBoundary): boolean {
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { return false; }
  const entry = record(raw); const data = record(entry?.data);
  if (entry === null || data === null) return false;
  const ids = data.messageIds;
  return entry.type === "custom" && entry.customType === "oma-delivery-boundary" && entry.id === boundary.entryId &&
    data.adapterRevision === PI_ADAPTER_REVISION && data.batchId === batch.id && data.incarnation === batch.incarnation &&
    Array.isArray(ids) && ids.length === batch.messageIds.length && ids.every((id, index) => id === batch.messageIds[index]);
}
/** DR11, BATCH-006 "durable session file": the entry a receipt names is on disk
 * before the receipt exists. Pi appends it with no flush, so the trusted
 * publisher finds it in the bounded end of the session file -- a boundary is
 * the session's last entry when its receipt is published -- and flushes the
 * file and the directory holding it. A boundary the file does not hold is no
 * boundary: nothing is published, and the batch stays for its next attempt. */
function makeBoundaryDurable(stateRoot: string, batch: PreparedBatch, boundary: DeliveryBoundary, maximum: number,
  faults?: DurabilityObserver): void {
  const root = sessionDirPathAt(stateRoot, batch.agent);
  const offset = relative(root, boundary.sessionPath);
  const directory = openDirectory(root);
  try {
    const holder = dirname(offset) === "." ? directory
      : openBeneath(directory, dirname(offset), constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      const fd = openRegularBeneath(holder, basename(offset));
      try {
        const size = fstatSync(fd).size;
        const window = Math.min(size, maximum);
        const bytes = Buffer.alloc(window);
        let filled = 0;
        while (filled < window) {
          const count = readSync(fd, bytes, filled, window - filled, size - window + filled);
          if (count === 0) break;
          filled += count;
        }
        const lines = bytes.subarray(0, filled).toString("utf8").split("\n");
        if (window < size) lines.shift(); // cut by the window, not an entry
        if (!lines.some(line => isBoundaryEntry(line, batch, boundary)))
          throw new StoreError("SESSION_BOUNDARY_UNCONFIRMED", "the session file holds no boundary entry for this batch attempt; no receipt is published");
        faultAt(faults, "evidence-fsync", "ambiguous", boundary.sessionPath);
        fsyncSync(fd);
      } finally { closeSync(fd); }
      fsyncSync(holder);
      faultAt(faults, "evidence-fsync", "after-visible", dirname(boundary.sessionPath));
    } finally { if (holder !== directory) closeSync(holder); }
  } finally { closeSync(directory); }
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
  makeBoundaryDurable(stateRoot, batch, boundary, maximum, faults);
  const encoded = `${JSON.stringify(candidate)}\n`;
  if (Buffer.byteLength(encoded) > maximum)
    return invalid("encoded receipt exceeds the configured frame limit");
  const path = runnerReceiptPathAt(stateRoot, batch.agent, batch.id);
  ensureOwnedDurableDirectory(dirname(path), stateRoot, 0o700, faults);
  const parent = openDirectory(dirname(path));
  const finalName = basename(path);
  const temporaryName = temporaryNameFor(finalName);
  const temporaryPath = join(dirname(path), temporaryName);
  let fd: number | undefined;
  let temporaryExists = false;
  let crashed = false;
  try {
    // P0V-96: a killed publication of this receipt left its temporary with a
    // free lock; the retry collects it, and locks its own until it is gone.
    collectDeadTemporaries(parent);
    faultAt(faults, "file-create", "before", temporaryPath);
    fd = createLockedTemporary(parent, temporaryName, constants.O_RDWR, 0o600);
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
    unlinkAt(parent, temporaryName);
    temporaryExists = false;
    faultAt(faults, "temporary-cleanup", "after-visible", temporaryPath);
    fsyncHeldDir(parent, dirname(path), faults);
    return result;
  } catch (error) {
    crashed = isDurabilityFault(error);
    if (!crashed && temporaryExists) {
      try {
        unlinkAt(parent, temporaryName);
        temporaryExists = false;
        faultAt(faults, "temporary-cleanup", "after-visible", temporaryPath);
        fsyncHeldDir(parent, dirname(path), faults);
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "receipt publication and temporary cleanup failed");
      }
    }
    throw error;
  } finally {
    closeEvery(fd, parent);
    void crashed;
  }
}
