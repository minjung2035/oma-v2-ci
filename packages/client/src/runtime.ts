import type { Json, MutationMethod, Receipt, PublicMethod, PublicMethods, Failure, ProtocolLimits } from "@oma/contracts";
import type { PrincipalGrant } from "@oma/protocol/client-codecs";

export type Reply = { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly error: Failure };
export type Decoded<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };
export interface CachedRequest {
  key: string; method: MutationMethod; params: Json; createdAtMs: number;
  digest?: { bytes: number; sha256: string }; lastReceipt: Receipt | null;
}
export type Observation<T> = { readonly kind: "present"; readonly value: T } | { readonly kind: "absent" } |
  { readonly kind: "corrupt" | "unavailable"; readonly reason: string };
export interface CachePort {
  read(key: string): Observation<CachedRequest>;
  readBody(key: string, digest: { bytes: number; sha256: string }): Observation<Uint8Array>;
  freeze(input: Omit<CachedRequest, "lastReceipt">, body?: Uint8Array): { readonly kind: "created" | "existing"; readonly value: CachedRequest };
  updateReceipt(key: string, receipt: unknown): CachedRequest;
}
export interface ChannelPort {
  connect(path: string): Promise<void>;
  call(method: PublicMethod | "principal.attach", params: Record<string, unknown>, options?: { request?: string; streamBytes?: Uint8Array }): Promise<Reply>;
  close(error?: unknown): void;
}
export interface PreparedContext {
  entries: { path: string; bytes: number; sha256: string }[];
  content: Uint8Array; digest: { bytes: number; sha256: string };
}
export interface RuntimePort {
  readonly observationSeconds: number;
  readonly maximumReceiptBytes: number;
  /** Keep a complete oversized answer where the caller can read it whole;
   * returns the path. The inline answer carries its head and this path. */
  spoolOutput(home: string, bytes: Uint8Array): string;
  cache(home: string, budget: number): CachePort;
  cacheFailure(error: unknown): { code: string; message: string } | null;
  channel(limits: Pick<ProtocolLimits, "frameBytes" | "idleStreamSeconds" | "receiptWaitSeconds">): ChannelPort;
  snapshot(value: unknown): Json;
  paramsEqual(method: MutationMethod, left: unknown, right: unknown): boolean;
  intentConflict(method: MutationMethod, explicit: () => Record<string, unknown>, frozen: CachedRequest): string | null;
  decodeReceipt(value: unknown, options?: { expectedKind?: MutationMethod; allowNotFound?: boolean }): Decoded<Receipt>;
  decodeFailure(value: unknown): Decoded<Failure>;
  notFound(receipt: Receipt): boolean;
  mutation(method: PublicMethod): boolean;
  collectReceipt(key: string, maximum: number, read: (part: PublicMethods["operation.read"]["params"]) => Promise<PublicMethods["operation.read"]["result"]>): Promise<Receipt>;
  failureText(failure: Failure): string;
  failureExit(failure: Failure): 2 | 3 | 4;
  receiptText(receipt: Receipt, key: string): string;
  receiptExit(receipt: Receipt): 0 | 2 | 3 | 4;
  goal(file: string, expected: string | null): PreparedContext;
  reply(file: string, inheritSubject: boolean): { replyToMessage: string; inheritedSubject?: string };
  fullOid(value: unknown): value is string;
  resolveOid(revision: string): string;
  recordedBase(): string | null;
  workspaceDirty(): boolean;
  submit(candidate: string, key: string, known: PublicMethods["git.known"]["result"]): { exportRef: string; prerequisites: string[]; content?: Uint8Array };
  code(repository: string, input: { action: "merge-diff"; revision: string; base: string; path?: string }): { text: string };
}
const RUNTIME = Symbol.for("oma.client.runtime");
const shared = globalThis as { [RUNTIME]?: RuntimePort };
export function installRuntime(runtime: RuntimePort): void { shared[RUNTIME] = Object.freeze(runtime); }
export function runtime(): RuntimePort {
  if (!shared[RUNTIME]) throw new Error("OMA client runtime was not installed at engine startup");
  return shared[RUNTIME];
}
export type GrantProvider = () => PrincipalGrant | null;
