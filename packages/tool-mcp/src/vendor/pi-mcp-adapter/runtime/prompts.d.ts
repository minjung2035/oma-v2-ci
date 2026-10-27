import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { GetPromptResult } from "@modelcontextprotocol/client";
import type { McpExtensionState } from "./state.js";
import { type McpConfig, type PromptMetadata } from "./types.js";
import { formatPromptCommandName } from "./types.js";
/**
 * Resolve prompt metadata for slash-command registration at extension load
 * time. Mirrors `resolveDirectTools`: reads the persistent metadata cache so
 * commands are available before any server connects.
 */
export declare function resolveCachedPrompts(config: McpConfig): PromptMetadata[];
/**
 * Parse a slash-command argument string into positional and named MCP prompt
 * arguments. Supports bash-style quoting so callers can pass values with
 * spaces:
 *
 *   /mcp__demo__brief today "important tasks"
 *   /mcp__demo__brief day=today topic="important tasks"
 */
export declare function parsePromptArgs(input: string): {
    positional: string[];
    named: Record<string, string>;
};
export declare function completePromptArgs(metadata: PromptMetadata, input: string): Array<{
    value: string;
    label: string;
    description?: string;
}> | null;
export interface ResolvedPromptArgs {
    ok: boolean;
    /** Present when `ok === true`. */
    args?: Record<string, string>;
    /** Present when `ok === false`. */
    error?: string;
}
/**
 * Map positional and named arguments onto the prompt's declared argument
 * list. Named arguments win over positional when both target the same slot.
 * Missing required arguments produce a helpful usage message that the
 * command handler surfaces via `ctx.ui.notify`.
 */
export declare function resolvePromptArgs(metadata: PromptMetadata, parsed: {
    positional: string[];
    named: Record<string, string>;
}): ResolvedPromptArgs;
/**
 * Flatten a `GetPromptResult` into a single string suitable for
 * `pi.sendUserMessage`. MCP prompts can contain multiple messages with
 * mixed roles; we preserve role attribution as inline markers so the model
 * still sees the intended conversational shape without needing a
 * multi-message replay API on the pi side.
 */
export declare function formatPromptResult(result: GetPromptResult): string;
/**
 * Build the pi command definition for a single MCP prompt. Registered once
 * per prompt at extension load time from the metadata cache; the same
 * factory is reused by tests to invoke the handler without a running pi.
 */
export interface PromptRuntimeDependencies {
    ensureState?: (ctx: ExtensionCommandContext) => Promise<McpExtensionState | null>;
    lazyConnect?: (state: McpExtensionState, serverName: string, signal?: AbortSignal) => Promise<boolean>;
    isStateCurrent?: (state: McpExtensionState) => boolean;
}
export declare function createPromptCommand(pi: ExtensionAPI, getState: () => McpExtensionState | null, metadata: PromptMetadata, runtime?: PromptRuntimeDependencies): {
    description: string;
    getArgumentCompletions: (prefix: string) => {
        value: string;
        label: string;
        description?: string;
    }[] | null;
    handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
};
/**
 * Public helper used by `/mcp-adapter prompts` to render the list of prompts known
 * to the adapter, whether from a live connection or the metadata cache.
 */
export declare function listAllPromptMetadata(state: McpExtensionState): PromptMetadata[];
export { formatPromptCommandName };
