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
  *read(actor: string): Generator<ResidentLogObservation> {
    let parent: number;
    try { parent = openOwnedDirectoryPath(actorDirectory(this.stateRoot, actor)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    try {
      for (const name of directoryNames(parent).sort()) {
        const match = NAME.exec(name); if (!match) refuse();
        const pin = pinBeneath(parent, name);
        let acquired: number | undefined;
        try { withCleanup(() => {
          const stat = fstatSync(pin); if (!stat.isFile() || stat.nlink !== 1) refuse();
          chmodPinned(pin, stat.mode | 0o400); acquired = reopenPinned(pin, constants.O_RDONLY | constants.O_NONBLOCK);
        }, () => closeSync(pin)); }
        catch (error) { withCleanup(() => { throw error; }, () => { if (acquired !== undefined) closeSync(acquired); }); }
        const fd = acquired!;
        try {
          const buffer = Buffer.alloc(8192); let position = 0, pending = Buffer.alloc(0);
          for (;;) {
            const count = readSync(fd, buffer, 0, buffer.length, position); if (!count) break;
            position += count; pending = Buffer.concat([pending, buffer.subarray(0, count)]);
            for (;;) {
              const newline = pending.indexOf(10); if (newline < 0) break;
              const line = pending.subarray(0, newline); pending = pending.subarray(newline + 1);
              let raw: unknown; try { raw = JSON.parse(decodeUtf8(line)); } catch { refuse(); }
              if (!raw || typeof raw !== "object" || Array.isArray(raw)) refuse();
              const frame = raw as Record<string, unknown>;
              if (Object.keys(frame).sort().join() !== "actor,atMs,data,incarnation,invocationId,stream,version" || frame.version !== 1 ||
                  frame.actor !== actor || frame.invocationId !== match[2] || typeof frame.data !== "string") refuse();
              const bytes = Buffer.from(frame.data, "base64");
              const entry = { actor, invocationId: frame.invocationId, atMs: frame.atMs, incarnation: frame.incarnation, stream: frame.stream, bytes } as ResidentLogEntry;
              if (!valid(entry) || bytes.toString("base64") !== frame.data || !Buffer.from(canonicalJson(frame)).equals(line)) refuse();
              yield { kind: "entry", entry };
            }
            if (pending.length > 90_000) refuse();
          }
          if (pending.length) yield { kind: "incomplete" };
        } finally { closeSync(fd); }
      }
    } finally { closeSync(parent); }
  }
}
