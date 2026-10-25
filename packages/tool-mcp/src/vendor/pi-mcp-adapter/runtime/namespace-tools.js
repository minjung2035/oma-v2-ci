import { Type } from "typebox";
import { isServerDisabled } from "./types.js";
import { isServerCacheValid } from "./metadata-cache.js";
import { createMcpProxyToolCallRenderer, createMcpToolResultRenderer, resolveMcpToolRenderOptions } from "./tool-result-renderer.js";
export { namespaceProxyName } from "./mcp-references.js";
import { hasCallableCachedTargets, isMcpServerDirectlyRegistered, namespaceProxyName } from "./mcp-references.js";
function namespaceProxyCandidate(config, cache, envOverride, existingDirectNames, serverName) {
    const definition = config.mcpServers[serverName];
    if (!definition || isServerDisabled(definition))
        return null;
    if (isMcpServerDirectlyRegistered(definition, config.settings, serverName, envOverride))
        return null;
    const entry = cache.servers?.[serverName];
    if (!entry || !isServerCacheValid(entry, definition) || !hasCallableCachedTargets(entry, definition))
        return null;
    const toolName = namespaceProxyName(serverName);
    if (existingDirectNames.has(toolName))
        return null;
    return {
        serverName,
        toolName,
        description: `Namespace-proxy for MCP server "${serverName}". ` +
            `Forwards \`{tool, args}\` through the adapter's executeCall, so it inherits ` +
            `the same auth / lifecycle / output-guard rules as the \`mcp\` proxy.`,
    };
}
function filterCollidingNamespaceProxyTools(candidates) {
    const names = new Map();
    for (const spec of candidates) {
        const colliding = names.get(spec.toolName) ?? [];
        colliding.push(spec);
        names.set(spec.toolName, colliding);
    }
    return candidates.filter((spec) => {
        const colliding = names.get(spec.toolName);
        if (colliding.length === 1)
            return true;
        if (colliding[0] === spec) {
            console.warn(`MCP: skipping namespace proxy "${spec.toolName}" because servers ${colliding.map(({ serverName }) => `"${serverName}"`).sort().join(", ")} normalize to the same name`);
        }
        return false;
    });
}
function resolveNamespaceProxyTools(config, cache, envOverride, existingDirectNames, unavailableServers) {
    if (!config || !cache || config.settings?.namespaceProxyTools === false)
        return [];
    return filterCollidingNamespaceProxyTools(Object.keys(config.mcpServers)
        .map((serverName) => namespaceProxyCandidate(config, cache, envOverride, existingDirectNames, serverName))
        .filter((spec) => spec !== null)).filter((spec) => !unavailableServers.has(spec.serverName));
}
function namespaceExecute(getState, getInitPromise, ensureRuntime, executeCall, serverName, getPiTools) {
    return async (toolCallId, params, signal, _onUpdate, ctx) => {
        if (typeof params.tool !== "string" || params.tool.length === 0) {
            return {
                content: [{ type: "text", text: `mcp__${serverName} requires a \`tool\` parameter naming the underlying MCP tool.` }],
                details: { error: "missing_tool", server: serverName },
            };
        }
        let state = getState();
        if (!state && ensureRuntime) {
            try {
                state = await ensureRuntime(ctx);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: "text", text: `MCP initialization failed for ${serverName}: ${message}` }],
                    details: { error: "init_failed", server: serverName, message },
                };
            }
        }
        if (!state) {
            const initPromise = getInitPromise();
            if (initPromise) {
                try {
                    state = await initPromise;
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: "text", text: `MCP initialization failed for ${serverName}: ${message}` }],
                        details: { error: "init_failed", server: serverName, message },
                    };
                }
            }
        }
        if (!state) {
            return {
                content: [{ type: "text", text: `MCP not initialized for ${serverName}.` }],
                details: { error: "not_initialized", server: serverName },
            };
        }
        return executeCall(state, params.tool, params.args ?? {}, serverName, getPiTools, signal, "proxy", undefined, toolCallId);
    };
}
const parameters = Type.Object({
    tool: Type.String({ description: "Underlying MCP tool name to call on this server." }),
    args: Type.Optional(Type.Object({}, {
        additionalProperties: true,
        description: "Arguments for the underlying tool. When mcp is available, use mcp({ search: '...' }) to inspect schemas; for unique names use mcp({ describe: 'tool_name' }) with the exact tool name returned by search.",
    })),
});
function createNamespaceRenderCall(renderOptions, serverName) {
    const renderCall = createMcpProxyToolCallRenderer(renderOptions);
    return (args, theme, context) => renderCall({
        ...(args.tool !== undefined ? { tool: args.tool } : {}),
        ...(args.args !== undefined ? { args: args.args } : {}),
        server: serverName,
    }, theme, context);
}
let defaultProxyModesPromise = null;
async function loadDefaultExecuteCall() {
    defaultProxyModesPromise ??= import("./proxy-modes.js").catch((error) => {
        defaultProxyModesPromise = null;
        throw error;
    });
    return (await defaultProxyModesPromise).executeCall;
}
function registerNamespaceProxyTool(input, spec, renderOptions, renderShell, renderResult) {
    const executeCall = input.executeCall ?? (async (...args) => {
        const expectedState = args[0];
        const loadedExecuteCall = await loadDefaultExecuteCall();
        if (input.getState() !== expectedState || expectedState.owner?.isActive() === false) {
            throw expectedState.owner?.signal.reason ?? new Error("MCP namespace operation belongs to a stale session");
        }
        return loadedExecuteCall(...args);
    });
    input.onToolRegistered?.(spec.toolName);
    input.guardReentrant?.();
    input.pi.registerTool({
        name: spec.toolName,
        label: `MCP: ${spec.serverName}`,
        description: spec.description,
        promptSnippet: `MCP namespace proxy for ${spec.serverName}`,
        parameters,
        renderShell,
        renderCall: createNamespaceRenderCall(renderOptions, spec.serverName),
        renderResult,
        execute: namespaceExecute(input.getState, input.getInitPromise, input.ensureRuntime, executeCall, spec.serverName, input.getPiTools),
    });
    input.guardReentrant?.();
    if (input.fallbackDeactivatedNames?.delete(spec.toolName)) {
        // Only undo a fallback deactivation the adapter still owns.
        input.guardReentrant?.();
        const activeTools = getActiveToolsIfReady(input.pi);
        input.guardReentrant?.();
        if (activeTools && !activeTools.includes(spec.toolName)) {
            input.pi.setActiveTools([...activeTools, spec.toolName]);
            input.guardReentrant?.();
        }
    }
}
function getActiveToolsIfReady(pi) {
    try {
        return pi.getActiveTools?.();
    }
    catch (error) {
        if (error instanceof Error && error.message.includes("Action methods cannot be called during extension loading"))
            return undefined;
        throw error;
    }
}
function getActiveToolsForStaleCleanup(pi, staleNames) {
    if (staleNames.length === 0)
        return undefined;
    return getActiveToolsIfReady(pi);
}
function deactivateStaleNamespaceTools(input, nextNames) {
    const activeDirectNames = input.activeDirectNames ?? new Set();
    const staleNames = [...input.existingNamespaceNames].filter((name) => !nextNames.has(name) && !activeDirectNames.has(name));
    const deactivated = [];
    const unregisterTool = input.pi.unregisterTool;
    for (const stale of staleNames) {
        input.guardReentrant?.();
        const removed = unregisterTool?.(stale);
        input.guardReentrant?.();
        if (removed)
            deactivated.push(stale);
    }
    input.guardReentrant?.();
    const activeTools = getActiveToolsForStaleCleanup(input.pi, staleNames);
    input.guardReentrant?.();
    if (!activeTools)
        return deactivated;
    const stale = new Set(staleNames);
    const fallbackRemoved = staleNames.filter((name) => !deactivated.includes(name) && activeTools.includes(name));
    const nextActiveTools = activeTools.filter((name) => !stale.has(name));
    if (nextActiveTools.length === activeTools.length)
        return deactivated;
    input.guardReentrant?.();
    input.pi.setActiveTools(nextActiveTools);
    input.guardReentrant?.();
    for (const name of fallbackRemoved)
        input.fallbackDeactivatedNames?.add(name);
    for (const name of staleNames) {
        if (!deactivated.includes(name))
            deactivated.push(name);
    }
    return deactivated;
}
/**
 * Idempotent sync of namespace-proxy tool registrations.
 */
export function syncNamespaceProxyTools(input) {
    const specs = resolveNamespaceProxyTools(input.config, input.cache, input.envOverride, input.existingDirectNames, input.unavailableServers ?? new Set());
    const nextNames = new Set(specs.map((s) => s.toolName));
    const result = { specs, added: [], updated: [], deactivated: [] };
    const renderOptions = input.renderOptions ?? resolveMcpToolRenderOptions();
    const renderShell = input.renderShell ?? (renderOptions.resultRendering === "compact" ? "self" : "default");
    const renderResult = input.renderResult ?? createMcpToolResultRenderer(renderOptions);
    for (const spec of specs) {
        registerNamespaceProxyTool(input, spec, renderOptions, renderShell, renderResult);
        (input.existingNamespaceNames.has(spec.toolName) ? result.updated : result.added).push(spec.toolName);
    }
    result.deactivated.push(...deactivateStaleNamespaceTools(input, nextNames));
    return result;
}
