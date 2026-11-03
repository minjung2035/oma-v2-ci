/** DR53 diagnostic JSONL spool. Full bytes are preserved separately from the
 * bounded public view. A partial crash tail is never an empty successful log. */
import { decodeUtf8 } from "@oma/domain/utf8";
import { closeSync, constants, fstatSync, fsyncSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { ResidentLogEntry, ResidentLogObservation } from "@oma/contracts/runtime";
import { isValidActorName } from "@oma/domain/identifiers";
import { canonicalJson } from "@oma/domain/canonical-json";
import { StoreError } from "@oma/domain/errors";
import { directoryNames } from "@oma/file-descriptors";
import { pinBeneath, chmodPinned, reopenPinned } from "@oma/native/files";
import { withCleanup } from "@oma/native/cleanup";
import { ensureOwnedDurableDirectory } from "./durable-fs.js";
import { openOwnedAppendFile, openOwnedDirectoryPath } from "./directory.js";

const INVOCATION = /^[0-9a-f]{32}$/, NAME = /^([0-9]{16})-([0-9a-f]{32})\.jsonl$/;
function refuse(): never { throw new StoreError("REF_STATE_UNKNOWN", "Resident diagnostic log is malformed or unobserved"); }
function actorDirectory(root: string, actor: string): string {
  if (!isValidActorName(actor)) throw new TypeError("invalid Resident log actor");
  return join(root, "logs", "resident", actor);
}
function valid(entry: ResidentLogEntry): boolean {
  return isValidActorName(entry.actor) && INVOCATION.test(entry.invocationId) && Number.isSafeInteger(entry.atMs) && entry.atMs >= 0 &&
    (entry.incarnation === null || Number.isSafeInteger(entry.incarnation) && entry.incarnation > 0) &&
    ["stdout", "stderr"].includes(entry.stream) && entry.bytes instanceof Uint8Array && entry.bytes.length > 0 && entry.bytes.length <= 65536;
}
/** A bounded observation of the existing JSONL spool, not an execution fact.
 * File capabilities are valid only until the files() iterator advances/closes. */
export interface ResidentLogFrame {
  readonly from: number;
  readonly through: number;
  readonly observation: ResidentLogObservation;
}
export interface ResidentLogFile {
  readonly name: string;
  readonly actor: string;
  readonly invocationId: string;
  readonly openedAtMs: number;
  readonly sourceBytes: number;
  readonly identity: string;
  readonly fingerprint: string;
  frames(): Generator<ResidentLogFrame>;
}
export type ResidentLogFileObservation = { readonly kind: "file"; readonly file: ResidentLogFile } |
  { readonly kind: "unavailable"; readonly name: string | null; readonly error: unknown };

function decodeEntry(line: Uint8Array, actor: string, invocationId: string): ResidentLogEntry {
  let raw: unknown; try { raw = JSON.parse(decodeUtf8(line)); } catch { refuse(); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) refuse();
  const frame = raw as Record<string, unknown>;
  if (Object.keys(frame).sort().join() !== "actor,atMs,data,incarnation,invocationId,stream,version" || frame.version !== 1 ||
      frame.actor !== actor || frame.invocationId !== invocationId || typeof frame.data !== "string" ||
      typeof frame.atMs !== "number" || !(frame.incarnation === null || typeof frame.incarnation === "number") ||
      !(frame.stream === "stdout" || frame.stream === "stderr")) refuse();
  const bytes = Buffer.from(frame.data, "base64");
  const entry: ResidentLogEntry = { actor, invocationId, atMs: frame.atMs, incarnation: frame.incarnation, stream: frame.stream, bytes };
  if (!valid(entry) || bytes.toString("base64") !== frame.data || !Buffer.from(canonicalJson(frame)).equals(line)) refuse();
  return entry;
}
export class ResidentLogStore {
  constructor(private readonly stateRoot: string) {}
  open(actor: string, invocationId: string, atMs = Date.now()): { append(entry: ResidentLogEntry): void; close(): void } {
    if (!INVOCATION.test(invocationId) || !Number.isSafeInteger(atMs) || atMs < 0) throw new TypeError("invalid log identity");
    const directory = actorDirectory(this.stateRoot, actor);
    ensureOwnedDurableDirectory(directory, this.stateRoot, 0o700);
    const parent = openOwnedDirectoryPath(directory);
    let acquired: number | undefined;
    try {
      withCleanup(() => { acquired = openOwnedAppendFile(parent, `${String(atMs).padStart(16, "0")}-${invocationId}.jsonl`); }, () => closeSync(parent));
      const stat = fstatSync(acquired!); if (!stat.isFile() || stat.nlink !== 1 || stat.size !== 0) refuse();
    } catch (error) { return withCleanup(() => { throw error; }, () => { if (acquired !== undefined) closeSync(acquired); }); }
    const fd = acquired!;
    let closed = false, failed = false, size = 0n;
    const verify = (): void => {
      const stat = fstatSync(fd, { bigint: true });
      if (!stat.isFile() || stat.nlink !== 1n || stat.size !== size) refuse();
    };
    return Object.freeze({ append(entry: ResidentLogEntry) {
      if (closed || failed || !valid(entry) || entry.actor !== actor || entry.invocationId !== invocationId) refuse();
      const bytes = Buffer.from(canonicalJson({ version: 1, actor, invocationId, incarnation: entry.incarnation,
        atMs: entry.atMs, stream: entry.stream, data: Buffer.from(entry.bytes).toString("base64") }) + "\n");
      try {
        verify();
        for (let offset = 0; offset < bytes.length;) { const n = writeSync(fd, bytes, offset, bytes.length - offset); if (n <= 0) refuse(); offset += n; size += BigInt(n); }
        verify();
      } catch (error) { failed = true; throw error; }
    }, close() {
      if (closed) return; closed = true;
      withCleanup(() => { verify(); fsyncSync(fd); if (failed) refuse(); }, () => closeSync(fd));
    } });
  }
  /** Each source is read only through its captured byte high-water. Appends are
   * not EOF/success evidence, and an incomplete tail remains explicitly unknown. */
  *files(actor: string): Generator<ResidentLogFileObservation> {
    let parent: number;
    try { parent = openOwnedDirectoryPath(actorDirectory(this.stateRoot, actor)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    try {
      for (const name of directoryNames(parent).sort()) {
        const match = NAME.exec(name);
        if (!match) { yield { kind: "unavailable", name: null, error: new StoreError("REF_STATE_UNKNOWN", "unrecognized Resident diagnostic log entry") }; continue; }
        let acquired: number | undefined, active = false, failure: unknown;
        try {
          const pin = pinBeneath(parent, name);
          withCleanup(() => {
            const stat = fstatSync(pin); if (!stat.isFile() || stat.nlink !== 1) refuse();
            if ((stat.mode & 0o400) === 0) chmodPinned(pin, stat.mode | 0o400);
            acquired = reopenPinned(pin, constants.O_RDONLY | constants.O_NONBLOCK);
          }, () => closeSync(pin));
          const fd = acquired!, before = fstatSync(fd, { bigint: true }), sourceBytes = Number(before.size);
          const openedAtMs = Number(match[1]), invocationId = match[2]!;
          if (!before.isFile() || before.nlink !== 1n || !Number.isSafeInteger(sourceBytes) || sourceBytes < 0 ||
              !Number.isSafeInteger(openedAtMs) || !Number.isFinite(new Date(openedAtMs).getTime())) refuse();
          const identity = canonicalJson([String(before.dev), String(before.ino), String(before.birthtimeNs)]);
          active = true;
          yield { kind: "file", file: Object.freeze({ name, actor, invocationId, openedAtMs, sourceBytes, identity,
            fingerprint: canonicalJson([identity, sourceBytes, String(before.mtimeNs), String(before.ctimeNs)]),
            *frames(): Generator<ResidentLogFrame> {
              if (!active) throw new StoreError("INTERNAL_ERROR", "Resident log file observation outlived its descriptor owner");
              const buffer = Buffer.alloc(8192); let position = 0, from = 0, pending = Buffer.alloc(0);
              while (position < sourceBytes) {
                if (!active) throw new StoreError("INTERNAL_ERROR", "Resident log file observation outlived its descriptor owner");
                const count = readSync(fd, buffer, 0, Math.min(buffer.length, sourceBytes - position), position);
                if (count <= 0) refuse();
                position += count; pending = Buffer.concat([pending, buffer.subarray(0, count)]);
                for (;;) {
                  const newline = pending.indexOf(10); if (newline < 0) break;
                  const line = pending.subarray(0, newline); pending = pending.subarray(newline + 1);
                  const through = from + newline + 1;
                  if (!active) throw new StoreError("INTERNAL_ERROR", "Resident log file observation outlived its descriptor owner");
                  yield { from, through, observation: { kind: "entry", entry: decodeEntry(line, actor, invocationId) } };
                  from = through;
                }
                if (pending.length > 90_000) refuse();
              }
              if (!active) throw new StoreError("INTERNAL_ERROR", "Resident log file observation outlived its descriptor owner");
              if (pending.length) yield { from, through: sourceBytes, observation: { kind: "incomplete" } };
              if (!active) throw new StoreError("INTERNAL_ERROR", "Resident log file observation outlived its descriptor owner");
              const after = fstatSync(fd, { bigint: true });
              if (!after.isFile() || after.nlink !== 1n || after.dev !== before.dev || after.ino !== before.ino || after.size < before.size ||
                  (after.size === before.size && (after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs))) refuse();
            } }) };
        } catch (error) { failure = error; }
        finally {
          active = false;
          if (acquired !== undefined) {
            try { closeSync(acquired); }
            catch (cleanup) { throw failure === undefined ? cleanup : new AggregateError([failure, cleanup], "Resident log observation and descriptor cleanup failed"); }
          }
        }
        if (failure !== undefined) yield { kind: "unavailable", name, error: failure };
      }
    } finally { closeSync(parent); }
  }
  *read(actor: string): Generator<ResidentLogObservation> {
    for (const observation of this.files(actor)) {
      if (observation.kind === "unavailable") throw observation.error;
      for (const frame of observation.file.frames()) yield frame.observation;
    }
  }
}
