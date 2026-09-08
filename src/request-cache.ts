// MUST [FS-003]/[IPC-006]: CLI preaccept cache under <home>/.local/state/oma/requests.
// Model-mutable; the broker always revalidates. Contains only the frozen
// request, body/bundle digest, and the last receipt. Not a queue or replay engine.
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Json, Receipt, RequestKey } from "../implementation/contracts.js";
import { isValidRequestKey } from "./ids.js";

export interface CachedRequest {
  key: RequestKey;
  method: string;
  /** frozen normalized payload (immutable after first freeze) */
  params: Json;
  /** stream digest when the request carries bytes, else absent */
  digest?: { bytes: number; sha256: string };
  createdAtMs: number;
  lastReceipt: Receipt | null;
}

function fsyncDir(dir: string): void {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function atomicWrite(
  target: string,
  tmp: string,
  data: string | Uint8Array,
): void {
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, target);
  fsyncDir(dirname(target));
}
const CACHE_FIELDS = ["key", "method", "params", "digest", "createdAtMs", "lastReceipt"] as const;
const DIGEST_FIELDS = ["bytes", "sha256"] as const;
const RECEIPT_FIELDS = ["operation", "state", "result", "error", "reason"] as const;
const FAILURE_FIELDS = ["code", "message", "retry", "details"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasOnly(record: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(record).every((key) => fields.includes(key));
}

function isJsonValue(v: unknown): v is Json {
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v) && Number.isSafeInteger(v);
  if (Array.isArray(v)) return v.every(isJsonValue);
  return isRecord(v) && Object.values(v).every(isJsonValue);
}

function isReceiptValue(v: unknown): v is Receipt {
  if (v === null) return true;
  if (!isRecord(v) || !hasOnly(v, RECEIPT_FIELDS)) return false;
  if (typeof v.operation !== "string" || v.operation.length === 0) return false;
  if (v.state !== "pending" && v.state !== "succeeded" && v.state !== "failed" && v.state !== "unknown") return false;
  if (v.result !== undefined && !isJsonValue(v.result)) return false;
  if (v.reason !== undefined && typeof v.reason !== "string") return false;
  if (v.error === undefined) return true;
  if (!isRecord(v.error) || !hasOnly(v.error, FAILURE_FIELDS)) return false;
  return typeof v.error.code === "string" && typeof v.error.message === "string" &&
    (v.error.retry === "never" || v.error.retry === "same-key" || v.error.retry === "after-repair") &&
    (v.error.details === undefined || isJsonValue(v.error.details));
}

function isCachedRecord(raw: unknown, key: RequestKey): raw is CachedRequest {
  if (!isRecord(raw)) return false;
  if (!hasOnly(raw, CACHE_FIELDS) || raw.key !== key || !isValidRequestKey(raw.key)) return false;
  if (typeof raw.method !== "string" || raw.method.length === 0 || !isJsonValue(raw.params)) return false;
  if (!Number.isSafeInteger(raw.createdAtMs) || (raw.createdAtMs as number) < 0) return false;
  if (!isReceiptValue(raw.lastReceipt)) return false;
  if (raw.digest !== undefined) {
    const digest = raw.digest;
    if (!isRecord(digest) || !hasOnly(digest, DIGEST_FIELDS) ||
      typeof digest.bytes !== "number" || !Number.isSafeInteger(digest.bytes) || digest.bytes < 0 ||
      typeof digest.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(digest.sha256)) return false;
  }
  return true;
}

export class RequestCache {
  constructor(readonly homeDir: string) {}

  private dir(): string {
    return join(this.homeDir, ".local", "state", "oma", "requests");
  }

  private path(key: RequestKey): string {
    if (!isValidRequestKey(key)) throw new Error("invalid request key");
    return join(this.dir(), `${key}.json`);
  }

  read(key: RequestKey): CachedRequest | null {
    if (!isValidRequestKey(key)) return null;
    const p = this.path(key);
    if (!existsSync(p)) return null;
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
      if (!isRecord(raw) || !isCachedRecord(raw, key)) return null;
      return raw;
    } catch {
      return null;
    }
  }

  /** MUST [FS-003]: fsync tmp file, atomic rename, then fsync parent dir. */
  write(entry: CachedRequest): void {
    if (!isCachedRecord(entry, entry.key)) {
      throw new Error("invalid cached request");
    }
    const dir = this.dir();
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${entry.key}.tmp`);
    atomicWrite(this.path(entry.key), tmp, JSON.stringify(entry));
  }

  /** MUST [IPC-008]: durable body path for streamed mutations — the exact bytes
   * frozen at preaccept are persisted so `--request` recovery reproduces the
   * SAME bytes instead of rebuilding them from mutable current state. */
  bodyPath(key: RequestKey): string {
    return this.path(key).replace(/\.json$/, ".body");
  }

  /** MUST [IPC-008/FS-003]: publish the exact body bytes durably. */
  persistBody(key: RequestKey, bytes: Uint8Array): void {
    const dir = this.dir();
    mkdirSync(dir, { recursive: true });
    const p = this.bodyPath(key);
    const tmp = join(dir, `.${key}.body.tmp`);
    atomicWrite(p, tmp, bytes);
  }

  readBody(key: RequestKey): Uint8Array | null {
    const p = this.bodyPath(key);
    if (!existsSync(p)) return null;
    try {
      return new Uint8Array(readFileSync(p));
    } catch {
      return null;
    }
  }
}
