/** DR51 execution observations. One append/fsync owner; closed, hash-chained
 * frames contain no commands, accepted work, credentials or replay authority.
 */
import { decodeUtf8 } from "@oma/domain/utf8";
import { closeSync, constants, fstatSync, fsyncSync, readSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { sha256Hex, canonicalJson } from "@oma/domain/canonical-json";
import { isValidActorName, UUID_V4_RE } from "@oma/domain/identifiers";
import { EXECUTION_JOURNAL_VERSION } from "@oma/protocol/persisted-formats";
import { uuidV4 } from "@oma/native/identity";
import { lockFileDescriptor } from "@oma/native/linux";
import { chmodPinned, pinBeneath, reopenPinned, withinDirectory } from "@oma/native/files";
import { withCleanup } from "@oma/native/cleanup";
import type { ExecutionWitness } from "@oma/process/execution-witness";
import { openOwnedDirectoryPath } from "./directory.js";
import { ensureOwnedDurableDirectory, publishNoReplace } from "./durable-fs.js";

export interface ExecutionJournalEntry {
  readonly slot: string; readonly execution: string;
  readonly witness: ExecutionWitness | null;
}
type Event = { kind: "initialize"; owner: string } |
  { kind: "opening"; slot: string; execution: string } |
  { kind: "witness"; slot: string; execution: string; witness: ExecutionWitness } |
  { kind: "closed"; slot: string; execution: string };
interface Frame { version: typeof EXECUTION_JOURNAL_VERSION; sequence: number; previous: string; event: Event; hash: string }
const ZERO = "0".repeat(64);
const BOOT = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: string[]): boolean { return Object.keys(value).sort().join() === expected.sort().join(); }
function slot(value: unknown): value is string { return typeof value === "string" &&
  (["candidate", "quarantine", "restic", "preparation"].includes(value) || value.startsWith("resident:") && isValidActorName(value.slice(9))); }
function identity(value: unknown): value is ExecutionWitness {
  if (!object(value) || typeof value.kind !== "string") return false;
  if (value.kind === "linux-namespace")
    return keys(value, ["kind", "pid", "bootId", "startTime", "namespaceDevice", "namespaceInode"]) &&
      typeof value.pid === "number" && Number.isSafeInteger(value.pid) && value.pid > 1 && value.pid <= 0x7fffffff &&
      typeof value.bootId === "string" && BOOT.test(value.bootId) &&
      [value.startTime, value.namespaceDevice, value.namespaceInode].every(v => typeof v === "string" && /^[0-9]{1,24}$/.test(v));
  if (value.kind === "darwin-audit-session")
    return keys(value, ["kind", "auditSession", "coalitionId", "pid", "pidVersion"]) &&
      typeof value.coalitionId === "string" && /^[0-9]{1,20}$/.test(value.coalitionId) &&
      [value.auditSession, value.pid, value.pidVersion].every(v => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 0xffffffff);
  return false;
}
function event(value: unknown): value is Event {
  if (!object(value)) return false;
  if (value.kind === "initialize") return keys(value, ["kind", "owner"]) && typeof value.owner === "string" && value.owner.startsWith("/");
  if (!["opening", "witness", "closed"].includes(String(value.kind)) || !slot(value.slot) ||
      typeof value.execution !== "string" || !UUID_V4_RE.test(value.execution)) return false;
  return value.kind === "witness" ? keys(value, ["kind", "slot", "execution", "witness"]) && identity(value.witness)
    : keys(value, ["kind", "slot", "execution"]);
}
function frame(sequence: number, previous: string, event: Event): Frame {
  const body = { version: EXECUTION_JOURNAL_VERSION, sequence, previous, event };
  return { ...body, hash: sha256Hex(canonicalJson(body)) };
}
function corrupt(message: string): never { throw new StoreError("STORE_CORRUPT", `execution journal ${message}`); }

export class ExecutionJournal {
  private readonly entriesBySlot = new Map<string, ExecutionJournalEntry>();
  private sequence = 0;
  private previous = ZERO;
  private closed = false;
  private poisoned = false;
  private constructor(private readonly fd: number, private readonly owner: string) { this.replay(); }

  /** Explicit initialization only, after the caller's fresh/quiescent boundary.
   * Ordinary open never creates a missing journal. Existing frames are preserved.
   */
  static initialize(stateRoot: string): void {
    const owner = resolve(stateRoot), root = join(owner, "execution");
    ensureOwnedDurableDirectory(root, owner, 0o700);
    const initial = frame(0, ZERO, { kind: "initialize", owner });
    publishNoReplace(join(root, "scopes.jsonl"), canonicalJson(initial) + "\n", 0o600);
  }
  static open(stateRoot: string): ExecutionJournal {
    const owner = resolve(stateRoot), parent = openOwnedDirectoryPath(join(owner, "execution"));
    let fd: number | undefined;
    try {
      withCleanup(() => {
        const pin = pinBeneath(parent, "scopes.jsonl");
        withCleanup(() => {
          const stat = fstatSync(pin);
          if (!stat.isFile() || stat.nlink !== 1) corrupt("is not an exclusively named regular file");
          chmodPinned(pin, (stat.mode & 0o7777) | 0o600);
          fd = reopenPinned(pin, constants.O_RDWR | constants.O_APPEND | constants.O_NONBLOCK);
        }, () => closeSync(pin));
      }, () => closeSync(parent));
      if (lockFileDescriptor(fd!).kind !== "held") throw new StoreError("BROKER_UNAVAILABLE", "execution journal has no exclusive owner");
      return new ExecutionJournal(fd!, owner);
    } catch (error) { return withCleanup(() => { throw error; }, () => { if (fd !== undefined) closeSync(fd); }); }
  }
  /** Read-only diagnostic snapshot. No lock acquisition, mode repair, append
   * or recovery effect. A concurrent/torn read remains unobserved to its caller. */
  static inspect(stateRoot: string): readonly ExecutionJournalEntry[] {
    let fd: number | undefined;
    return withCleanup(() => {
      withinDirectory(join(resolve(stateRoot), "execution", "scopes.jsonl"), (parent, name) => {
        const pin = pinBeneath(parent, name);
        withCleanup(() => {
          const stat = fstatSync(pin);
          if (!stat.isFile() || stat.nlink !== 1) corrupt("diagnostic snapshot is not an exclusively named regular file");
          fd = reopenPinned(pin, constants.O_RDONLY | constants.O_NONBLOCK);
        }, () => closeSync(pin));
      });
      return new ExecutionJournal(fd!, resolve(stateRoot)).entries();
    }, () => { if (fd !== undefined) closeSync(fd); });
  }
  entries(): readonly ExecutionJournalEntry[] { this.assertOpen(); return [...this.entriesBySlot.values()]; }
  reserve(name: string): { readonly execution: string; publish: (witness: ExecutionWitness) => void; retire: () => void } {
    this.assertOpen();
    if (!slot(name)) throw new TypeError("invalid execution slot");
    if (this.entriesBySlot.has(name)) throw new StoreError("RUN_TERMINATION_UNKNOWN", "previous execution scope is not retired");
    const execution = uuidV4(); this.append({ kind: "opening", slot: name, execution });
    return Object.freeze({
      execution,
      publish: (witness: ExecutionWitness) => {
        if (!identity(witness)) throw new TypeError("invalid kernel scope witness");
        this.append({ kind: "witness", slot: name, execution, witness });
      },
      retire: () => this.retire(name, execution),
    });
  }
  retire(name: string, execution: string): void { this.append({ kind: "closed", slot: name, execution }); }
  close(): void { if (this.closed) return; this.closed = true; closeSync(this.fd); }
  private assertOpen(): void {
    if (this.closed || this.poisoned) throw new StoreError("REF_STATE_UNKNOWN", "execution journal owner is closed or uncertain");
  }
  private append(value: Event): void {
    this.assertOpen(); this.validateTransition(value);
    const next = frame(this.sequence, this.previous, value), bytes = Buffer.from(canonicalJson(next) + "\n");
    try {
      for (let offset = 0; offset < bytes.length;) {
        const written = writeSync(this.fd, bytes, offset, bytes.length - offset);
        if (written <= 0) throw new Error("execution journal append made no progress");
        offset += written;
      }
      fsyncSync(this.fd); this.apply(next);
    } catch (error) { this.poisoned = true; throw error; }
  }
  private replay(): void {
    const before = fstatSync(this.fd, { bigint: true });
    const maximumFrame = Math.max(2048, Buffer.byteLength(canonicalJson(frame(0, ZERO, { kind: "initialize", owner: this.owner }))));
    const buffer = Buffer.alloc(8192); let pending = Buffer.alloc(0), position = 0;
    for (;;) {
      const count = readSync(this.fd, buffer, 0, buffer.length, position); if (count === 0) break;
      position += count; pending = Buffer.concat([pending, buffer.subarray(0, count)]);
      for (;;) {
        const newline = pending.indexOf(10); if (newline < 0) break;
        const bytes = pending.subarray(0, newline); pending = pending.subarray(newline + 1);
        let value: unknown; try { value = JSON.parse(decodeUtf8(bytes)); } catch { corrupt("contains an invalid frame"); }
        if (!object(value) || !keys(value, ["version", "sequence", "previous", "event", "hash"]) ||
            value.version !== EXECUTION_JOURNAL_VERSION || value.sequence !== this.sequence || value.previous !== this.previous ||
            !event(value.event) || value.hash !== frame(this.sequence, this.previous, value.event).hash ||
            !Buffer.from(canonicalJson(value)).equals(bytes)) corrupt("frame identity or hash chain differs");
        this.validateTransition(value.event); this.apply(value as unknown as Frame);
      }
      // One closed frame has a finite grammar; actor count/history is unbounded.
      if (pending.length > maximumFrame) corrupt("contains an oversized partial frame");
    }
    if (pending.length !== 0 || this.sequence === 0) corrupt("is empty or has an incomplete tail");
    const after = fstatSync(this.fd, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) corrupt("changed while being read");
  }
  private validateTransition(value: Event): void {
    if (this.sequence === 0) { if (value.kind !== "initialize" || value.owner !== this.owner) corrupt("has a different owner"); return; }
    if (value.kind === "initialize") corrupt("contains another initialization");
    const previous = this.entriesBySlot.get(value.slot);
    if (value.kind === "opening") { if (previous) corrupt("reopens an occupied slot"); }
    else if (!previous || previous.execution !== value.execution || (value.kind === "witness" && previous.witness !== null)) corrupt("has an invalid scope transition");
  }
  private apply(value: Frame): void {
    const e = value.event;
    if (e.kind === "opening") this.entriesBySlot.set(e.slot, Object.freeze({ slot: e.slot, execution: e.execution, witness: null }));
    if (e.kind === "witness") this.entriesBySlot.set(e.slot, Object.freeze({ slot: e.slot, execution: e.execution, witness: Object.freeze({ ...e.witness }) }));
    if (e.kind === "closed") this.entriesBySlot.delete(e.slot);
    this.sequence++; this.previous = value.hash;
  }
}
