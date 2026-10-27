import { UrlElicitationRequiredError } from "@modelcontextprotocol/client";
import { disabledServerReason } from "./project-server-trust.js";
import { lazyConnect, clearFailure } from "./init.js";
import { describeFailure } from "./failure-backoff.js";
import { abortable, throwIfAborted } from "./abort.js";
import { formatSchema } from "./tool-metadata.js";
import { resolveMcpResultContent, transformMcpResourceContents } from "./tool-registrar.js";
import { guardMcpOutput, guardedMcpDetails, resolveMcpOutputGuardOptions, scriptPipeHint } from "./mcp-output-guard.js";
import { maybeStartUiSession, summarizeUiSessionResult } from "./ui-session.js";
import { isServerDisabled } from "./types.js";
import { authenticate, supportsOAuth } from "./mcp-auth-flow.js";
import { formatAuthRequiredMessage, normalizeToolArguments, omaUiSessionsRefused, resolveServerUrl, withToolCallIdMeta } from "./utils.js";
import { SessionRecoveryAuthRequiredError, withSessionRecovery } from "./session-recovery.js";
import { combineAbortSignals, isAbortError } from "./runtime-owner.js";
import { callToolViaTaskSession } from "./mcp-tasks.js";
import { callToolPausingForElicitation } from "./elicitation-handler.js";
import { observedOutputRecorder } from "./output-shape.js";
import { ensureToolCallApproved } from "./tool-approval.js";
import { getInputRequiredNeedsUiDetails } from "./errors.js";
export { DIRECT_TOOLS_ADVISORY_THRESHOLD, buildProxyDescription, getLargeDirectToolsAdvisory, getMissingConfiguredDirectToolServers, prepareDirectToolArguments, resolveDirectTools, } from "./direct-tool-surface.js";
function getDirectAuthRequiredMessage(state, serverName, defaultMessage = `MCP server "${serverName}" requires OAuth authentication. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`) {
    return formatAuthRequiredMessage(state.config, serverName, defaultMessage);
}
function getDirectAuthFailedMessage(state, serverName, message) {
    const customGuidance = state.config.settings?.authRequiredMessage;
    if (customGuidance) {
        return `OAuth authentication failed for "${serverName}": ${message}. ${getDirectAuthRequiredMessage(state, serverName)}`;
    }
    return `OAuth authentication failed for "${serverName}": ${message}. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`;
}
async function attemptDirectAutoAuth(state, serverName, signal) {
    if (state.config.settings?.autoAuth !== true) {
        return { status: "skipped" };
    }
    const definition = state.config.mcpServers[serverName];
    if (!definition || isServerDisabled(definition) || !supportsOAuth(definition)) {
        return { status: "skipped" };
    }
    let serverUrl;
    try {
        serverUrl = resolveServerUrl(definition);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: "failed", message: getDirectAuthFailedMessage(state, serverName, message) };
    }
    if (!serverUrl) {
        return { status: "skipped" };
    }
    const grantType = definition.oauth ? definition.oauth.grantType ?? "authorization_code" : "authorization_code";
    if (!state.ui && grantType !== "client_credentials") {
        return {
            status: "failed",
            message: getDirectAuthRequiredMessage(state, serverName, `MCP server "${serverName}" requires OAuth authentication. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`),
        };
    }
    try {
        if (state.authStorageOptions) {
            await authenticate(serverName, serverUrl, definition, signal
                ? { authStorageOptions: state.authStorageOptions, signal, runtime: state.oauthRuntime }
                : { authStorageOptions: state.authStorageOptions, runtime: state.oauthRuntime });
        }
        else {
            await authenticate(serverName, serverUrl, definition, {
                ...(signal ? { signal } : {}),
                runtime: state.oauthRuntime,
            });
        }
        return { status: "success" };
    }
    catch (error) {
        if (isAbortError(error, signal))
            throw error;
        const message = error instanceof Error ? error.message : String(error);
        return {
            status: "failed",
            message: getDirectAuthFailedMessage(state, serverName, message),
        };
    }
}
export function createDirectToolExecutor(getState, getInitPromise, spec, 
// Deferred tools (Pi 0.99+) keep the server's structuredContent.
structured = false) {
    const structuredContentOf = (result) => structured && result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent }
        : {};
    return async function execute(toolCallId, params, signal) {
        throwIfAborted(signal);
        let state = getState();
        const initPromise = getInitPromise();
        if (!state && initPromise) {
            try {
                state = await initPromise;
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: "text", text: `MCP initialization failed: ${message}` }],
                    details: { error: "init_failed", message },
                };
            }
        }
        if (!state) {
            return {
                content: [{ type: "text", text: "MCP not initialized" }],
                details: { error: "not_initialized" },
            };
        }
        const definition = state.config.mcpServers[spec.serverName];
        if (isServerDisabled(definition)) {
            const message = `MCP server "${spec.serverName}" is ${disabledServerReason(state.blockedProjectServers, spec.serverName)}`;
            return {
                content: [{ type: "text", text: message }],
                details: { error: "server_disabled", server: spec.serverName, message },
            };
        }
        const ownedSignal = combineAbortSignals(state.owner?.signal, signal);
        throwIfAborted(ownedSignal);
        let connected = await lazyConnect(state, spec.serverName, ownedSignal);
        let autoAuthAttempted = false;
        if (!connected && state.manager.getConnection(spec.serverName)?.status === "needs-auth") {
            autoAuthAttempted = true;
            const autoAuth = await attemptDirectAutoAuth(state, spec.serverName, ownedSignal);
            if (autoAuth.status === "failed") {
                return {
                    content: [{ type: "text", text: autoAuth.message }],
                    details: { error: "auth_required", server: spec.serverName, message: autoAuth.message },
                };
            }
            if (autoAuth.status === "success") {
                await state.manager.close(spec.serverName);
                clearFailure(state, spec.serverName);
                connected = await lazyConnect(state, spec.serverName, ownedSignal);
            }
        }
        if (!connected) {
            const authConnection = state.manager.getConnection(spec.serverName);
            if (authConnection?.status === "needs-auth") {
                const message = getDirectAuthRequiredMessage(state, spec.serverName);
                return {
                    content: [{ type: "text", text: message }],
                    details: { error: "auth_required", server: spec.serverName, message, autoAuthAttempted },
                };
            }
            const failure = describeFailure(state, spec.serverName);
            return {
                content: [{ type: "text", text: `MCP server "${spec.serverName}" not available${failure !== null ? ` (${failure})` : ""}` }],
                details: { error: "server_unavailable", server: spec.serverName },
            };
        }
        const connection = state.manager.getConnection(spec.serverName);
        if (!connection || connection.status !== "connected") {
            return {
                content: [{ type: "text", text: `MCP server "${spec.serverName}" not connected` }],
                details: { error: "not_connected", server: spec.serverName },
            };
        }
        const normalizedParams = spec.resourceUri ? params : normalizeToolArguments(params);
        // The spec is fixed at registration; approval must see the hints the server advertises now.
        const annotations = spec.resourceUri
            ? undefined
            : state.toolMetadata.get(spec.serverName)?.find(tool => !tool.resourceUri && tool.originalName === spec.originalName)?.annotations;
        let uiSession = null;
        const requestOptions = state.manager.getRequestOptions?.(spec.serverName, ownedSignal) ?? (ownedSignal ? { signal: ownedSignal } : undefined);
        const outputGuardOptions = resolveMcpOutputGuardOptions(state.config.settings);
        const recoverAuthConnection = async () => {
            const current = state.manager.getConnection(spec.serverName);
            if (current?.status === "connected")
                return current;
            if (!autoAuthAttempted) {
                autoAuthAttempted = true;
                const autoAuth = await attemptDirectAutoAuth(state, spec.serverName, ownedSignal);
                if (autoAuth.status === "failed") {
                    throw new SessionRecoveryAuthRequiredError(spec.serverName, autoAuth.message);
                }
                if (autoAuth.status === "success") {
                    const afterAuth = state.manager.getConnection(spec.serverName);
                    if (afterAuth?.status === "connected")
                        return afterAuth;
                    if (afterAuth?.status === "needs-auth") {
                        await state.manager.close(spec.serverName);
                    }
                    clearFailure(state, spec.serverName);
                    const reconnected = await lazyConnect(state, spec.serverName, ownedSignal);
                    return reconnected ? state.manager.getConnection(spec.serverName) : undefined;
                }
            }
            return state.manager.getConnection(spec.serverName);
        };
        let approval;
        try {
            // In flight from here so an idle check cannot close the server while the approval dialog is open.
            state.manager.touch(spec.serverName);
            state.manager.incrementInFlight(spec.serverName);
            approval = await ensureToolCallApproved(state, spec.serverName, {
                name: spec.prefixedName,
                originalName: spec.originalName,
                description: spec.description,
                ...(spec.inputSchema !== undefined ? { inputSchema: spec.inputSchema } : {}),
                ...(spec.resourceUri !== undefined ? { resourceUri: spec.resourceUri } : {}),
                ...(spec.uiResourceUri !== undefined ? { uiResourceUri: spec.uiResourceUri } : {}),
                ...(spec.uiStreamMode !== undefined ? { uiStreamMode: spec.uiStreamMode } : {}),
                ...(annotations !== undefined ? { annotations } : {}),
            }, normalizedParams, ownedSignal, spec.resourceUri ? "resource" : "direct");
            if (approval.ok === false) {
                const denied = approval.reason === "denied";
                const message = denied
                    ? `The user declined approval to run MCP tool "${spec.originalName}" on server "${spec.serverName}".`
                    : `MCP tool "${spec.originalName}" on server "${spec.serverName}" is approval-gated and requires an interactive session.`;
                return {
                    content: [{ type: "text", text: message }],
                    details: {
                        error: denied ? "approval_denied" : "approval_required",
                        server: spec.serverName,
                        tool: spec.originalName,
                    },
                };
            }
            if (spec.resourceUri) {
                const result = await withSessionRecovery({
                    manager: state.manager,
                    config: state.config,
                    ...(ownedSignal ? { signal: ownedSignal } : {}),
                    onNeedsAuth: recoverAuthConnection,
                }, spec.serverName, async (conn) => {
                    const refreshRead = await state.manager.prepareResourceUse?.(spec.serverName, spec.resourceUri, conn);
                    return conn.client.readResource({ uri: spec.resourceUri }, refreshRead ? { ...requestOptions, cacheMode: "refresh" } : requestOptions);
                });
                const content = transformMcpResourceContents(result.contents ?? [], state.owner?.signal);
                const guarded = await guardMcpOutput(content.length > 0 ? content : [{ type: "text", text: "(empty resource)" }], {
                    ...outputGuardOptions,
                    ...(state.config.settings?.directToolResultDetails === "bounded" ? { rawMcpResult: result } : {}),
                });
                return {
                    content: guarded.content,
                    details: { server: spec.serverName, resourceUri: spec.resourceUri, ...guardedMcpDetails(guarded) },
                };
            }
            // OMA divergence: an interactive-UI tool call refuses at
            // the boundary, before the UI machinery and the downstream call.
            if (spec.uiResourceUri && omaUiSessionsRefused()) {
                const message = `MCP tool "${spec.originalName}" on server "${spec.serverName}" advertises an interactive UI resource (${spec.uiResourceUri}); interactive UI sessions are refused at the OMA boundary.`;
                return {
                    content: [{ type: "text", text: message }],
                    details: { error: "ui_session_refused", server: spec.serverName, tool: spec.originalName, message },
                };
            }
            const hasUi = !!spec.uiResourceUri;
            uiSession = hasUi
                ? await maybeStartUiSession(state, {
                    serverName: spec.serverName,
                    toolName: spec.originalName,
                    toolArgs: normalizedParams,
                    uiResourceUri: spec.uiResourceUri,
                    ...(spec.uiStreamMode !== undefined ? { streamMode: spec.uiStreamMode } : {}),
                    ...(signal ? { signal } : {}),
                    onNeedsAuth: recoverAuthConnection,
                })
                : null;
            const requestMeta = withToolCallIdMeta(uiSession?.requestMeta, toolCallId);
            const recordOutput = observedOutputRecorder(state, spec.serverName, spec.originalName);
            const result = await withSessionRecovery({
                manager: state.manager,
                config: state.config,
                ...(ownedSignal ? { signal: ownedSignal } : {}),
                onNeedsAuth: recoverAuthConnection,
            }, spec.serverName, async (conn) => {
                await state.manager.ensureListen?.(spec.serverName, conn);
                if (conn.taskSession) {
                    return await callToolViaTaskSession(conn.taskSession, {
                        name: spec.originalName,
                        args: normalizedParams ?? {},
                        meta: requestMeta,
                        signal: ownedSignal,
                        requestTimeoutMs: requestOptions?.timeout,
                    });
                }
                return abortable(callToolPausingForElicitation(conn.client, {
                    name: spec.originalName,
                    arguments: normalizedParams,
                    _meta: requestMeta,
                }, requestOptions), ownedSignal);
            });
            uiSession?.sendToolResult(result);
            if (!result.isError)
                recordOutput(result);
            if (result.isError) {
                const content = resolveMcpResultContent(result, state.owner?.signal);
                const outputContent = content.length > 0 ? content : [{ type: "text", text: "(empty result)" }];
                const guarded = await guardMcpOutput(outputContent, {
                    ...outputGuardOptions,
                    prefix: "Error: ",
                    emptyTextFallback: "Tool execution failed",
                    ...(state.config.settings?.directToolResultDetails === "bounded" ? { rawMcpResult: result } : {}),
                });
                return {
                    content: guarded.content,
                    details: { error: "tool_error", server: spec.serverName, ...guardedMcpDetails(guarded) },
                    ...structuredContentOf(result),
                };
            }
            const content = resolveMcpResultContent(result, state.owner?.signal);
            const outputContent = content.length > 0 ? content : [{ type: "text", text: "(empty result)" }];
            if (hasUi) {
                const uiSummary = summarizeUiSessionResult(uiSession);
                const guarded = await guardMcpOutput(outputContent, {
                    ...outputGuardOptions,
                    suffix: `\n\n${uiSummary.message}`,
                    ...(state.config.settings?.directToolResultDetails === "bounded" ? { rawMcpResult: result } : {}),
                });
                return {
                    content: guarded.content,
                    details: {
                        server: spec.serverName,
                        tool: spec.originalName,
                        uiOpen: uiSummary.uiOpen,
                        uiViewer: uiSummary.uiViewer,
                        uiUrl: uiSummary.uiUrl,
                        ...guardedMcpDetails(guarded),
                    },
                    ...structuredContentOf(result),
                };
            }
            const guarded = await guardMcpOutput(outputContent, {
                ...outputGuardOptions,
                ...scriptPipeHint(state.scriptTool, outputContent),
                ...(state.config.settings?.directToolResultDetails === "bounded" ? { rawMcpResult: result } : {}),
            });
            return {
                content: guarded.content,
                details: { server: spec.serverName, tool: spec.originalName, ...guardedMcpDetails(guarded) },
                ...structuredContentOf(result),
            };
        }
        catch (error) {
            // Approval errors, such as an abort while the dialog is open, propagate unchanged.
            if (!approval)
                throw error;
            if (error instanceof SessionRecoveryAuthRequiredError) {
                const message = error.authMessage ?? getDirectAuthRequiredMessage(state, spec.serverName);
                uiSession?.sendToolCancelled(message);
                return {
                    content: [{ type: "text", text: message }],
                    details: { error: "auth_required", server: spec.serverName, message, autoAuthAttempted },
                };
            }
            if (error instanceof UrlElicitationRequiredError) {
                const action = await state.manager.handleUrlElicitationRequired(spec.serverName, error);
                const message = action === "accept"
                    ? "The original MCP tool did not run. Complete the opened browser interaction, then retry the tool."
                    : `The URL interaction was ${action === "decline" ? "declined" : "cancelled"}.`;
                uiSession?.sendToolCancelled(message);
                return {
                    content: [{ type: "text", text: message }],
                    details: { error: "url_elicitation_required", server: spec.serverName, action },
                };
            }
            const inputRequired = getInputRequiredNeedsUiDetails(error, spec.resourceUri
                ? { server: spec.serverName, resourceUri: spec.resourceUri }
                : { server: spec.serverName, tool: spec.originalName });
            if (inputRequired) {
                uiSession?.sendToolCancelled(inputRequired.message);
                return {
                    content: [{ type: "text", text: inputRequired.message }],
                    details: { ...inputRequired },
                };
            }
            const message = error instanceof Error ? error.message : String(error);
            const aborted = isAbortError(error, ownedSignal);
            if (!aborted) {
                await state.manager.close(spec.serverName).catch(() => { });
            }
            uiSession?.sendToolCancelled(message);
            const schemaText = spec.inputSchema ? `\n\nExpected parameters:\n${formatSchema(spec.inputSchema)}` : "";
            const guarded = await guardMcpOutput([{ type: "text", text: message }], { ...outputGuardOptions, prefix: "Failed to call tool: ", suffix: schemaText });
            return {
                content: guarded.content,
                details: { error: aborted ? "aborted" : "call_failed", server: spec.serverName, ...guardedMcpDetails(guarded) },
            };
        }
        finally {
            if (uiSession?.reused) {
                uiSession.close();
            }
            state.manager.decrementInFlight(spec.serverName);
            state.manager.touch(spec.serverName);
        }
    };
}
