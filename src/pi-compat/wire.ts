/** A7: the wire contract OMA shares with Pi 1.0.1, stated once.
 *
 * The transport stays OMA's (`runtime/pi-rpc.ts`): drain-based writes, poison
 * framing, frame bounds, owned child streams. These names describe only what
 * crosses that transport, taken from the engine's public surface instead of a
 * hand-mirrored union, so an upstream wire change fails here at typecheck
 * rather than drifting silently (A1/A2).
 */
export type {
  JsonAgentSessionEvent,
  RpcCommand,
  RpcExtensionUIRequest,
  RpcResponse,
} from "@earendil-works/pi-coding-agent";
import type {
  JsonAgentSessionEvent,
  RpcExtensionUIRequest,
  RpcResponse,
} from "@earendil-works/pi-coding-agent";

/** Pi's `--mode rpc` writes this on an extension failure. 1.0.1 emits it
 * (`rpc-mode.js`: `output({ type: "extension_error", ...err })`) but exports
 * no named type for it; the fields are the root-exported `ExtensionError`
 * body's, spelled out so the literal keeps its implicit index signature. */
export type RpcExtensionErrorEvent = {
  type: "extension_error";
  extensionPath: string;
  event: string;
  error: string;
  stack?: string;
};

/** Everything an engine in RPC mode can put on its stdout: command responses,
 * session events, extension UI requests, and extension errors. OMA's trusted
 * extension reaches `extension_ui_request` through `method: "notify"`.
 *
 * This is not every event this transport can deliver: the reader's own
 * frame-overflow marker (`SKIPPED_EVENT` in `runtime/pi-rpc.ts`) is OMA's,
 * and OMA-internal UI socket traffic is `PiEvent`, not this union. */
export type PiInboundEvent =
  | RpcResponse
  | JsonAgentSessionEvent
  | RpcExtensionUIRequest
  | RpcExtensionErrorEvent;
