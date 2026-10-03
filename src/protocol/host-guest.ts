/** MAC-2xx (docs/macos-platform.md): the private protocol between
 * the macOS host and the hidden Linux guest.
 *
 * Framing is the broker's own (IPC-001/002: uint32 BE length + strict JSON),
 * so one parser decides what a well-formed message is on both boundaries.
 * This module is pure: it names the channels, validates the handshake and the
 * envelopes, and owns the vocabulary a guest may use toward the host. It
 * opens nothing and reads no clock.
 *
 * The broker's wire (`contracts.ts`) is not changed by this protocol: the
 * host never speaks to a broker, only to the guest's services, and the codes
 * it adds are its own (`PlatformErrorCode`).
 */
import type { ErrorCode } from "../../implementation/contracts/errors.js";
import { isErrorCode } from "../domain/errors.js";
import { isPlatformUuid, isValidSocietyName } from "../domain/identifiers.js";
import { parseJsonObject } from "../frame.js";
import { isHostHistoryReference, parseHostHistoryReference } from "./host-history.js";
import { parseGuestHistoryReference } from "./guest-history.js";

/** One protocol version, raised whenever a message's shape or meaning changes
 * (MAC-250). A host speaks the version of the image it ships and the one
 * before it; a guest speaks one.
 * v5: `egress.placeholder` may carry `hold`, keeping the answered connection
 * open as the run's lease -- the run ends when it ends (AV-15). */
export const HOST_GUEST_PROTOCOL = 5;

/** The platform protocol's frame limit. A society's own limits
 * (`ProtocolLimits.frameBytes`) govern its broker; this governs the host-guest
 * connection, which carries no society payload larger than a status view. */
export const PLATFORM_FRAME_BYTES = 256 * 1024;

/** MAC-202: the guest's reserved vsock ports. Binding one takes
 * CAP_NET_BIND_SERVICE; in the guest only systemd holds it. */
export const GUEST_PORTS = Object.freeze({ control: 700, society: 701 });

/** One connection, one purpose (MAC-2xx §4.3). */
export const CHANNELS = Object.freeze(["control", "society", "terminal", "egress", "stream"] as const);
export type Channel = (typeof CHANNELS)[number];
/** Which port serves which channel. */
export function portOf(channel: Channel): number {
  return channel === "control" ? GUEST_PORTS.control : GUEST_PORTS.society;
}

/** The codes the platform adds to the broker's (§4.9). A guest may send any
 * broker code as well; nothing else is a code. */
export const PLATFORM_ERROR_CODES = Object.freeze([
  "ENGINE_UNAVAILABLE", "ENGINE_VERSION_SKEW", "STATE_NEWER_THAN_APP", "HOST_STORAGE_LOW",
] as const);
export type PlatformErrorCode = ErrorCode | (typeof PLATFORM_ERROR_CODES)[number];
export function isPlatformErrorCode(value: unknown): value is PlatformErrorCode {
  return isErrorCode(value) || (typeof value === "string" && (PLATFORM_ERROR_CODES as readonly string[]).includes(value));
}

export interface PlatformFailure {
  readonly code: PlatformErrorCode;
  readonly message: string;
  readonly retry: "never" | "same-key" | "after-repair";
}

export function isUuid(value: unknown): value is string { return isPlatformUuid(value); }
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const REQUEST_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function isRequestKey(value: unknown): value is string { return typeof value === "string" && REQUEST_KEY.test(value); }

export interface HelloParams {
  readonly channel: Channel;
  readonly protocol: { readonly min: number; readonly max: number };
  readonly hostVersion: string;
  readonly installationId: string;
  readonly instanceId: string;
  readonly expectImage: string;
  /** terminal: the society whose session to attach to. */
  readonly society?: string;
  /** terminal: take the attach from whoever holds it (MAC-220). */
  readonly takeover?: true;
}
export interface HelloResult {
  readonly protocol: number;
  readonly guestImage: string;
  readonly bootId: string;
  readonly stateSchema: { readonly written: number; readonly readable: readonly number[] };
  readonly capabilities: readonly string[];
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): string | null {
  for (const key of required) if (!Object.hasOwn(value, key)) return `missing ${key}`;
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) return `unknown field ${key}`;
  return null;
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const uint = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** MAC-230: the host reads every guest message as untrusted input, and the
 * guest reads the host's hello the same way; a message that is not exactly
 * one of these shapes is refused, not repaired. */
export function helloParamsProblem(value: unknown): string | null {
  if (!object(value)) return "hello params must be an object";
  const shape = exactKeys(value, ["channel", "protocol", "hostVersion", "installationId", "instanceId", "expectImage"], ["society", "takeover"]);
  if (shape !== null) return shape;
  if (!(CHANNELS as readonly unknown[]).includes(value.channel)) return "unknown channel";
  const protocol = value.protocol;
  if (!object(protocol) || exactKeys(protocol, ["min", "max"]) !== null || !uint(protocol.min) || !uint(protocol.max) || protocol.min > protocol.max)
    return "protocol must be { min, max } with min <= max";
  if (typeof value.hostVersion !== "string" || !VERSION.test(value.hostVersion)) return "invalid hostVersion";
  if (typeof value.expectImage !== "string" || !VERSION.test(value.expectImage)) return "invalid expectImage";
  if (!isUuid(value.installationId) || !isUuid(value.instanceId)) return "installationId and instanceId must be UUIDs";
  if (value.channel === "terminal") {
    if (!isValidSocietyName(value.society)) return "a terminal names a valid society";
    if (value.takeover !== undefined && value.takeover !== true) return "takeover is true or absent";
  } else if (value.society !== undefined || value.takeover !== undefined) return "only a terminal names a society or a takeover in its hello";
  return null;
}

export function helloResultProblem(value: unknown): string | null {
  if (!object(value)) return "hello result must be an object";
  const shape = exactKeys(value, ["protocol", "guestImage", "bootId", "stateSchema", "capabilities"]);
  if (shape !== null) return shape;
  if (!uint(value.protocol)) return "invalid protocol";
  if (typeof value.guestImage !== "string" || !VERSION.test(value.guestImage)) return "invalid guestImage";
  if (!isUuid(value.bootId)) return "bootId must be a UUID";
  const schema = value.stateSchema;
  if (!object(schema) || exactKeys(schema, ["written", "readable"]) !== null || !uint(schema.written) ||
      !Array.isArray(schema.readable) || schema.readable.length === 0 || schema.readable.length > 16 || !schema.readable.every(uint))
    return "invalid stateSchema";
  if (!Array.isArray(value.capabilities) || value.capabilities.length > 32 ||
      !value.capabilities.every(item => typeof item === "string" && /^[a-z][a-z0-9.-]{0,47}$/.test(item)))
    return "invalid capabilities";
  return null;
}

/** MAC-211: the one protocol both ends speak, or null when their ranges do not
 * meet (the guest then refuses and closes). */
export function negotiate(host: { readonly min: number; readonly max: number }, guest: number): number | null {
  return guest >= host.min && guest <= host.max ? guest : null;
}

export interface Envelope {
  readonly id: string;
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly key?: string;
}
const ID = /^[A-Za-z0-9._:-]{1,64}$/;
const METHOD = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/;

/** A request on any JSON channel: `{ v: 1, id, method, params, key? }`. */
export function requestProblem(raw: Record<string, unknown>): string | null {
  const shape = exactKeys(raw, ["v", "id", "method", "params"], ["key"]);
  if (shape !== null) return shape;
  if (raw.v !== 1) return "unsupported envelope version";
  if (typeof raw.id !== "string" || !ID.test(raw.id)) return "invalid id";
  if (typeof raw.method !== "string" || !METHOD.test(raw.method) || raw.method.length > 64) return "invalid method";
  if (!object(raw.params)) return "params must be an object";
  if (raw.key !== undefined && !isRequestKey(raw.key)) return "invalid request key";
  return null;
}

/** A response: `{ v: 1, id, ok: true, result }` or `{ v: 1, id, ok: false, error }`. */
export function responseProblem(raw: Record<string, unknown>): string | null {
  if (raw.v !== 1) return "unsupported envelope version";
  if (typeof raw.id !== "string" || !ID.test(raw.id)) return "invalid id";
  if (raw.ok === true) return exactKeys(raw, ["v", "id", "ok", "result"]) ?? (object(raw.result) ? null : "result must be an object");
  if (raw.ok !== false) return "ok must be a boolean";
  const shape = exactKeys(raw, ["v", "id", "ok", "error"]);
  if (shape !== null) return shape;
  const error = raw.error;
  if (!object(error) || exactKeys(error, ["code", "message", "retry"]) !== null) return "invalid error";
  if (!isPlatformErrorCode(error.code)) return "unknown error code";
  if (typeof error.message !== "string" || error.message.length > 1024) return "invalid error message";
  if (error.retry !== "never" && error.retry !== "same-key" && error.retry !== "after-repair") return "invalid retry";
  return null;
}

/** §4.6: the terminal channel's frames, after its hello: `uint32 BE length`
 * of what follows, one kind byte, the payload. Bytes are carried as they are;
 * the few control messages are JSON. */
export const TERMINAL_FRAME_BYTES = 64 * 1024;
export const TERMINAL_KINDS = Object.freeze({
  /** host → guest */ input: 0x01, resize: 0x02, histories: 0x04,
  /** guesthost → session holder, first and once: `{ takeover?: true }` */ attach: 0x03,
  /** guest → host */ output: 0x81, exit: 0x82, detached: 0x83, refused: 0x84, historyQuery: 0x85,
} as const);
export type TerminalKind = keyof typeof TERMINAL_KINDS;
const KIND_OF = new Map<number, TerminalKind>(Object.entries(TERMINAL_KINDS).map(([name, byte]) => [byte, name as TerminalKind]));

export interface TerminalFrame { readonly kind: TerminalKind; readonly payload: Buffer }

export function encodeTerminalFrame(kind: TerminalKind, payload: Uint8Array = Buffer.alloc(0)): Buffer {
  if (payload.length + 1 > TERMINAL_FRAME_BYTES) throw new RangeError("a terminal frame exceeds its limit");
  const frame = Buffer.allocUnsafe(5 + payload.length);
  frame.writeUInt32BE(payload.length + 1, 0);
  frame.writeUInt8(TERMINAL_KINDS[kind], 4);
  frame.set(payload, 5);
  return frame;
}
export function encodeTerminalJson(kind: "attach" | "exit" | "detached" | "refused" | "historyQuery" | "histories", value: Record<string, unknown>): Buffer {
  return encodeTerminalFrame(kind, Buffer.from(JSON.stringify(value), "utf8"));
}

/** Splits a byte stream into terminal frames. A frame over the limit or of
 * an unknown kind poisons the stream: the caller closes it (IPC-002). */
export class TerminalFrameParser {
  private buffered = Buffer.alloc(0);
  feed(chunk: Uint8Array): TerminalFrame[] {
    this.buffered = this.buffered.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffered, chunk]);
    const frames: TerminalFrame[] = [];
    while (this.buffered.length >= 4) {
      const length = this.buffered.readUInt32BE(0);
      if (length === 0 || length > TERMINAL_FRAME_BYTES) throw new RangeError("a terminal frame has an invalid length");
      if (this.buffered.length < 4 + length) break;
      const kind = KIND_OF.get(this.buffered.readUInt8(4));
      if (kind === undefined) throw new RangeError("a terminal frame has an unknown kind");
      frames.push({ kind, payload: Buffer.from(this.buffered.subarray(5, 4 + length)) });
      this.buffered = this.buffered.subarray(4 + length);
    }
    return frames;
  }
  finish(): void {
    if (this.buffered.length !== 0) throw new RangeError("EOF inside a terminal frame");
  }
}

export function resizePayload(columns: number, rows: number): Buffer {
  const payload = Buffer.alloc(4);
  payload.writeUInt16BE(columns, 0);
  payload.writeUInt16BE(rows, 2);
  return payload;
}
/** A window size, or null when it is not one a terminal can have. */
export function parseResize(payload: Buffer): { readonly columns: number; readonly rows: number } | null {
  if (payload.length !== 4) return null;
  const columns = payload.readUInt16BE(0); const rows = payload.readUInt16BE(2);
  return columns > 0 && rows > 0 ? { columns, rows } : null;
}
/** A JSON control payload of exactly the given keys, or null. */
export function parseTerminalJson(payload: Buffer, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
  let value: unknown;
  try { value = JSON.parse(payload.toString("utf8")); } catch { return null; }
  if (!object(value) || exactKeys(value, required, optional) !== null) return null;
  return value;
}

/** MODE-006: exit is the only host handoff; no path, argv or guest cwd is
 * accepted. A requested new birth is valid only after a normal program end. */
export interface TerminalExit {
  readonly code: number | null;
  readonly signal: string | null;
  readonly next?: "new" | "resume";
  readonly history?: string;
}
export function parseTerminalExit(payload: Buffer): TerminalExit | null {
  let value: Record<string, unknown>;
  try { value = parseJsonObject(payload).raw; } catch { return null; }
  if (exactKeys(value, ["code", "signal"], ["next", "history"]) !== null ||
      !(value.code === null || uint(value.code)) ||
      !(value.signal === null || typeof value.signal === "string" && /^SIG[A-Z0-9]{1,16}$/.test(value.signal)) ||
      Object.hasOwn(value, "next") && (value.next !== "new" && value.next !== "resume" || value.code !== 0 || value.signal !== null)) return null;
  if (value.next === "resume") {
    try { checkedResumeHistoryReference(value.history as string); } catch { return null; }
  } else if (Object.hasOwn(value, "history")) return null;
  return value as unknown as TerminalExit;
}
export function isNewSessionHandoff(value: Record<string, unknown>): boolean {
  return exactKeys(value, ["next"]) === null && value.next === "new";
}
export function isResumeSessionHandoff(value: Record<string, unknown>): boolean {
  if (exactKeys(value, ["next", "history"]) !== null || value.next !== "resume") return false;
  try { checkedResumeHistoryReference(value.history as string); return true; } catch { return false; }
}
export function checkedResumeHistoryReference(value: string): void {
  if (isHostHistoryReference(value)) parseHostHistoryReference(value);
  else parseGuestHistoryReference(value);
}

/** §4.7: the first message on an egress connection, guest → host, in the
 * request envelope. `egress.placeholder` is answered and the connection
 * closes, unless `hold` keeps it open as the run's lease -- the run ends
 * when the lease does (AV-15). After `egress.open` the connection carries
 * the engine's HTTP. */
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;
export interface EgressRun { readonly society: string; readonly actor: string; readonly incarnation: number }
/** The credential the host keeps for the engine (MAC-704): the one a run's
 * placeholder stands for. Guest and host name it the same way. */
export const EGRESS_ENGINE_MANAGED = "engine-managed";
export interface EgressPlaceholderParams {
  readonly credentialRef: string; readonly provider: string; readonly model: string; readonly run: EgressRun;
  /** DR27: model silence, supplied by the run owner; absent only for v1 peers. */
  readonly inferenceSeconds?: number;
  /** v5: keep the connection after the answer, as the run's lease. The run
   * it issues ends when the held connection does, however it ends -- a run's
   * close, its death, a guest reboot. Absent, the answer ends the connection
   * and the run outlives it until the next boot (v4 behaviour). */
  readonly hold?: true;
}
export interface EgressOpenParams {
  readonly placeholderId: string; readonly society: string; readonly actor: string; readonly incarnation: number;
  readonly modelProfile: string;
}
export interface EgressPlaceholderResult {
  readonly placeholderId: string; readonly placeholder: string; readonly provider: string; readonly model: string;
}
function runProblem(value: unknown): string | null {
  if (!object(value) || exactKeys(value, ["society", "actor", "incarnation"]) !== null) return "run must be { society, actor, incarnation }";
  if (!isValidSocietyName(value.society)) return "invalid society";
  if (typeof value.actor !== "string" || !TOKEN.test(value.actor)) return "invalid actor";
  if (!uint(value.incarnation)) return "invalid incarnation";
  return null;
}
export function egressPlaceholderProblem(params: unknown): string | null {
  if (!object(params)) return "params must be an object";
  const shape = exactKeys(params, ["credentialRef", "provider", "model", "run"], ["inferenceSeconds", "hold"]);
  if (shape !== null) return shape;
  for (const key of ["credentialRef", "provider", "model"] as const)
    if (typeof params[key] !== "string" || !TOKEN.test(params[key] as string)) return `invalid ${key}`;
  if (Object.hasOwn(params, "inferenceSeconds") && (!uint(params.inferenceSeconds) || params.inferenceSeconds === 0 ||
    params.inferenceSeconds > Math.floor(Number.MAX_SAFE_INTEGER / 1000))) return "invalid inferenceSeconds";
  if (Object.hasOwn(params, "hold") && params.hold !== true) return "invalid hold";
  return runProblem(params.run);
}
export function egressOpenProblem(params: unknown): string | null {
  if (!object(params)) return "params must be an object";
  const shape = exactKeys(params, ["placeholderId", "society", "actor", "incarnation", "modelProfile"]);
  if (shape !== null) return shape;
  if (!isUuid(params.placeholderId)) return "invalid placeholderId";
  if (typeof params.modelProfile !== "string" || !TOKEN.test(params.modelProfile)) return "invalid modelProfile";
  return runProblem({ society: params.society, actor: params.actor, incarnation: params.incarnation });
}
export function egressPlaceholderResultProblem(result: unknown): string | null {
  if (!object(result) || exactKeys(result, ["placeholderId", "placeholder", "provider", "model"]) !== null) return "invalid placeholder answer";
  if (!isUuid(result.placeholderId)) return "invalid placeholderId";
  if (typeof result.placeholder !== "string" || result.placeholder.length < 16 || result.placeholder.length > 4096 || /[\s\u0000-\u001f]/.test(result.placeholder))
    return "invalid placeholder";
  if (typeof result.provider !== "string" || !TOKEN.test(result.provider) || typeof result.model !== "string" || !TOKEN.test(result.model))
    return "invalid provider or model";
  return null;
}
