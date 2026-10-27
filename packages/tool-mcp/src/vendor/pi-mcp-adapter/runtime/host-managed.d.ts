import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type CallToolResult, type ReadResourceResult, type Tool, type Transport } from "@modelcontextprotocol/client";
export interface HostManagedMcpServer {
    /**
     * Called once by ready(). Return an unconnected transport. It must not carry
     * an auth provider or any behavior that replays a request; the adapter sends
     * each tools/call at most once on its own layer only.
     */
    createTransport(context: {
        server: string;
        signal: AbortSignal;
    }): Transport | Promise<Transport>;
    /** MCP tool names to expose. Omit to expose every tool the server lists. */
    tools?: readonly string[];
}
export interface HostManagedMcpToolCall {
    readonly server: string;
    /** MCP tool name. */
    readonly tool: string;
    /** Pi tool name the model called. */
    readonly toolName: string;
    readonly toolCallId: string;
    /** Opaque identity of the connection this call is bound to. */
    readonly connectionId: string;
    /** Deep-frozen arguments; exactly what dispatch() sends. */
    readonly arguments: Readonly<Record<string, unknown>>;
    /** Deep-frozen input schema that was registered with Pi. */
    readonly inputSchema: Tool["inputSchema"];
    /** Aborted by the Pi call or by close(). */
    readonly signal: AbortSignal;
    /**
     * Send the tools/call request once and return the validated raw result.
     * Rejects with HostManagedMcpError. Calling it twice throws.
     */
    dispatch(): Promise<CallToolResult>;
    /**
     * Approve and prepare a read of a `resource_link` URI from this call's
     * dispatched result, on the same connection. Throws unless dispatch()
     * resolved with that link. Rejects with HostManagedMcpError (`not_sent`)
     * when the broker does not allow the read or the call has settled.
     */
    linkedResource(uri: string): Promise<HostManagedMcpResourceRead>;
}
export interface HostManagedMcpResourceRead {
    readonly uri: string;
    readonly readId: string;
    readonly connectionId: string;
    readonly parentToolCallId: string;
    /**
     * Send the resources/read request once. Rejects with HostManagedMcpError,
     * including `not_sent` after the parent tool call settles. Calling it twice throws.
     */
    dispatch(): Promise<ReadResourceResult>;
}
export interface HostManagedMcpAdapterOptions {
    servers: Record<string, HostManagedMcpServer>;
    /**
     * Runs after approval for every tool call. Record the call, invoke
     * `call.dispatch()` at most once, and return the result to present to the
     * model through the normal output guard.
     */
    onToolCall(call: HostManagedMcpToolCall): Promise<CallToolResult>;
    /** Per-request timeout in milliseconds. The MCP SDK default applies when omitted. */
    requestTimeoutMs?: number;
}
export interface HostManagedMcpAdapter {
    /** Connect every server and freeze the tool catalog. Memoized; rejects and closes the adapter on any failure. */
    ready(): Promise<void>;
    /** Refuse new calls, abort in-flight calls, and close every transport, all within 5 s. Idempotent. */
    close(): Promise<void>;
    /** Pi extension factory. Throws before ready() resolves or after close(). */
    extensionFactory(pi: ExtensionAPI): void;
}
/**
 * - `not_sent`: the request never left the adapter; the tool did not run.
 * - `may_have_run`: the request was sent and its outcome is unknown.
 * - `server_error`: the server answered with a JSON-RPC error.
 * - `invalid_result`: the server answered, but the result failed validation.
 */
export type HostManagedMcpDelivery = "not_sent" | "may_have_run" | "server_error" | "invalid_result";
/** Fixed-message dispatch failure. The raw error is kept only as `cause`. */
export declare class HostManagedMcpError extends Error {
    readonly delivery: HostManagedMcpDelivery;
    readonly server: string;
    readonly protocolCode?: number;
    constructor(delivery: HostManagedMcpDelivery, server: string, options?: {
        cause?: unknown;
        protocolCode?: number;
    });
}
export declare function createHostManagedMcpAdapter(options: HostManagedMcpAdapterOptions): HostManagedMcpAdapter;
