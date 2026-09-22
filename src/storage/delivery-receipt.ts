import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
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

export const PI_ADAPTER_REVISION = "oma-pi-rpc-v1@0.85.1";
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
function invalid(message: string): never {
  throw new StoreError("BATCH_CONFLICT", `delivery receipt: ${message}`);
}
function readBoundedFd(fd: number, maximum: number): Buffer {
  const before = fstatSync(fd);
  if (!before.isFile() || before.size < 1 || before.size > maximum || (before.mode & 0o777) !== 0o600)
    return invalid("file is not a bounded private regular file");
  const buffer = Buffer.alloc(before.size + 1);
  let total = 0;
  while (total < buffer.length) {
    const count = readSync(fd, buffer, total, buffer.length - total, total);
    if (count === 0) break;
    total += count;
  }
  const after = fstatSync(fd);
  if (total !== before.size || after.dev !== before.dev || after.ino !== before.ino ||
      after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
    return invalid("file changed while being read");
  return buffer.subarray(0, total);
}

function readBounded(path: string, maximum: number): Buffer {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    return readBoundedFd(fd, maximum);
  } catch (cause) {
    if (cause instanceof StoreError) throw cause;
    throw new StoreError("BATCH_CONFLICT", "delivery receipt is unavailable", { cause });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return invalid("expected an object");
  return raw as Record<string, unknown>;
}
function validSessionPath(
  stateRoot: string,
  actor: Actor,
  value: unknown,
): value is string {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.includes("\0") ||
    !value.endsWith(".jsonl")
  )
    return false;
  let fd: number | undefined;
  try {
    const root = realpathSync(sessionDirPathAt(stateRoot, actor));
    const actual = realpathSync(value);
    const offset = relative(root, actual);
    fd = openSync(
      actual,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = fstatSync(fd);
    return (
      stat.isFile() &&
      stat.size > 0 &&
      offset !== "" &&
      offset !== ".." &&
      !offset.startsWith(`..${sep}`) &&
      !isAbsolute(offset) &&
      actual === value
    );
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export function decodeDeliveryReceipt(
  raw: unknown,
  expected: PreparedBatch,
  stateRoot: string,
): DeliveryReceipt {
  const value = record(raw);
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
    !validSessionPath(stateRoot, expected.agent, value.sessionPath) ||
    typeof value.entryId !== "string" ||
    !/^[0-9a-f]{8}$/.test(value.entryId)
  )
    return invalid(
      "content does not match the prepared batch and pinned adapter",
    );
  return Object.freeze({
    schemaVersion: 1,
    adapterRevision: value.adapterRevision,
    batchId: value.batchId,
    actor: value.actor,
    incarnation: value.incarnation,
    messageIds: Object.freeze([...value.messageIds]),
    sessionPath: value.sessionPath,
    entryId: value.entryId,
  }) as DeliveryReceipt;
}
export function readDeliveryReceipt(
  stateRoot: string,
  batch: PreparedBatch,
  maximum: number,
): DeliveryReceipt {
  const path = runnerReceiptPathAt(stateRoot, batch.agent, batch.id);
  return decodeDeliveryReceipt(
    parseJsonObject(readBounded(path, maximum)).raw,
    batch,
    stateRoot,
  );
}
export function observeDeliveryReceipt(
  stateRoot: string,
  batch: PreparedBatch,
  maximum: number,
): DeliveryReceipt | null {
  try {
    return readDeliveryReceipt(stateRoot, batch, maximum);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "ENOENT"
    )
      return null;
    throw error;
  }
}
export function publishDeliveryReceipt(
  stateRoot: string,
  batch: PreparedBatch,
  boundary: DeliveryBoundary,
  maximum: number,
  faults?: DurabilityObserver,
 ): DeliveryReceipt {
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
    decodeDeliveryReceipt(parseJsonObject(readBoundedFd(fd, maximum)).raw, batch, stateRoot);
    faultAt(faults, "publication-link", "before", path);
    try { linkDescriptor(fd, parent, finalName); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    faultAt(faults, "publication-link", "after-visible", path);
    faultAt(faults, "destination-validate", "before", path);
    const published = openRegularBeneath(parent, finalName);
    let result: DeliveryReceipt;
    try { result = decodeDeliveryReceipt(parseJsonObject(readBoundedFd(published, maximum)).raw, batch, stateRoot); }
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
