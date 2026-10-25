import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildAllowAttribute, getToolUiResourceUri } from "./ui-app-bridge-helpers.js";
import { ContentBlockSchema } from "@modelcontextprotocol/core";
import { ServerError, wrapError } from "./errors.js";
import { extractToolAnnotations, formatAuthRequiredMessage, normalizeToolArguments } from "./utils.js";
import { buildHostHtmlTemplate, buildSandboxResourceCsp } from "./host-html-template.js";
import { buildSandboxProxyCsp, buildSandboxProxyHtml, SANDBOX_PROXY_PATH, SANDBOX_RESOURCE_PATH_PREFIX, } from "./sandbox-proxy-template.js";
import { logger } from "./logger.js";
import { SessionRecoveryAuthRequiredError, withSessionRecovery } from "./session-recovery.js";
import { ensureToolCallApproved, isToolCallApprovalRequired } from "./tool-approval.js";
import { callToolViaTaskSession } from "./mcp-tasks.js";
import { callToolPausingForElicitation } from "./elicitation-handler.js";
import { extractUiToolVisibility, isUiToolCallableByApp, isUiToolVisibleToModel } from "./ui-tool-visibility.js";
import { resourceNameToToolName } from "./resource-tools.js";
import { createUiModelContextUpdate, extractUiPromptText, getVisualizationStreamEnvelope, isServerDisabled, } from "./types.js";
const MAX_BODY_SIZE = 2 * 1024 * 1024;
const ABANDONED_GRACE_MS = 60_000;
const WATCHDOG_INTERVAL_MS = 5_000;
const MAX_EVENT_LOG = 128;
const MAX_CONTEXT_UPDATES = 20;
const MOSHI_DISCOVERY_PORT_START = 8377;
const MOSHI_DISCOVERY_PORT_END = 8396;
let nextMoshiDiscoveryPort = MOSHI_DISCOVERY_PORT_START;
export async function startUiServer(options) {
    const sessionToken = options.sessionToken ?? randomUUID();
    const sandboxResourcePath = `${SANDBOX_RESOURCE_PATH_PREFIX}${randomUUID()}`;
    const resourceAllow = buildAllowAttribute(options.resource.meta.permissions);
    const log = logger.child({
        component: "UiServer",
        server: options.serverName,
        tool: options.toolName,
        session: sessionToken.slice(0, 8),
    });
    log.debug("Starting UI server");
    const sseClients = new Set();
    let completed = false;
    let lastHeartbeatAt = Date.now();
    let watchdog = null;
    let currentDisplayMode = options.hostContext?.displayMode ?? "inline";
    let nextEventId = 1;
    const eventLog = [];
    let latestCheckpointEventId;
    let streamSummary;
    let server = null;
    let sandboxProxyServer = null;
    let sandboxProxyUrl = null;
    let closeTimer = null;
    let listenersClosed = false;
    // Track messages from UI for retrieval
    const sessionMessages = {
        prompts: [],
        notifications: [],
        intents: [],
        contexts: [],
    };
    const hostContext = {
        displayMode: currentDisplayMode,
        availableDisplayModes: ["inline", "fullscreen", "pip"],
        platform: "desktop",
        ...options.hostContext,
        // Only include toolInfo if caller provides full tool definition with inputSchema
        // The App validates toolInfo.tool.inputSchema as required object
    };
    const initialStreamContext = hostContext["pi-mcp-adapter/stream"];
    if (initialStreamContext && typeof initialStreamContext === "object") {
        const streamId = initialStreamContext.streamId;
        const mode = initialStreamContext.mode;
        if (typeof streamId === "string" && (mode === "eager" || mode === "stream-first")) {
            streamSummary = {
                streamId,
                mode,
                frames: 0,
                phases: [],
            };
        }
    }
    const isAppOnlyTool = (toolName) => {
        const toolDefinition = options.manager.getConnection(options.serverName)?.tools?.find((tool) => tool.name === toolName);
        if (!toolDefinition)
            return false;
        const visibility = extractUiToolVisibility(toolDefinition._meta);
        return isUiToolCallableByApp(visibility) && !isUiToolVisibleToModel(visibility);
    };
    const recordUiMessage = async (msgParams) => {
        const promptText = extractUiPromptText(msgParams);
        // Track messages by type (order: prompt → intent → notify)
        // Must match the order in index.ts onMessage handler
        if (promptText) {
            sessionMessages.prompts.push(promptText);
            log.debug("UI prompt received", { prompt: promptText.slice(0, 100) });
        }
        else if (msgParams.type === "intent" || msgParams.intent) {
            const intentName = msgParams.intent ?? "";
            if (intentName) {
                sessionMessages.intents.push({
                    intent: intentName,
                    ...(msgParams.params !== undefined ? { params: msgParams.params } : {}),
                });
                log.debug("UI intent received", { intent: intentName });
            }
        }
        else if (msgParams.type === "notify" || msgParams.message) {
            const notifyText = msgParams.message ?? "";
            if (notifyText) {
                sessionMessages.notifications.push(notifyText);
                log.debug("UI notification", { message: notifyText.slice(0, 100) });
            }
        }
        await options.onMessage?.(msgParams);
    };
    const touchHeartbeat = () => {
        lastHeartbeatAt = Date.now();
    };
    const updateStreamSummary = (eventId, payload) => {
        const envelope = getVisualizationStreamEnvelope(payload?.structuredContent);
        if (!envelope)
            return;
        if (envelope.frameType === "checkpoint" || envelope.frameType === "final") {
            latestCheckpointEventId = eventId;
        }
        if (!streamSummary) {
            streamSummary = {
                streamId: envelope.streamId,
                mode: "eager",
                frames: 0,
                phases: [],
            };
        }
        streamSummary.frames += 1;
        if (!streamSummary.phases.includes(envelope.phase)) {
            streamSummary.phases.push(envelope.phase);
        }
        streamSummary.finalStatus = envelope.status;
        if (envelope.message !== undefined)
            streamSummary.lastMessage = envelope.message;
        else
            delete streamSummary.lastMessage;
    };
    const serializeEvent = (eventId, name, payload) => {
        return `id: ${eventId}\nevent: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
    };
    const getLatestCheckpointIndex = () => {
        const firstEventId = eventLog[0]?.id;
        if (latestCheckpointEventId === undefined || firstEventId === undefined || latestCheckpointEventId < firstEventId)
            return -1;
        return latestCheckpointEventId - firstEventId;
    };
    const pruneEventLog = () => {
        if (eventLog.length <= MAX_EVENT_LOG)
            return;
        const latestCheckpointIndex = getLatestCheckpointIndex();
        if (latestCheckpointIndex > 0) {
            eventLog.splice(0, latestCheckpointIndex);
        }
        if (eventLog.length > MAX_EVENT_LOG) {
            eventLog.splice(0, eventLog.length - MAX_EVENT_LOG);
        }
    };
    const pushEvent = (name, payload) => {
        if (completed)
            return;
        const eventId = nextEventId++;
        eventLog.push({ id: eventId, name, payload });
        updateStreamSummary(eventId, payload);
        pruneEventLog();
        const chunk = serializeEvent(eventId, name, payload);
        for (const client of sseClients) {
            try {
                client.write(chunk);
            }
            catch {
                sseClients.delete(client);
            }
        }
    };
    const replayEvents = (res, lastEventIdHeader) => {
        const parsedLastId = lastEventIdHeader ? Number(lastEventIdHeader) : Number.NaN;
        const eventsToReplay = Number.isFinite(parsedLastId)
            ? eventLog.filter((entry) => entry.id > parsedLastId)
            : (() => {
                const latestCheckpointIndex = getLatestCheckpointIndex();
                return latestCheckpointIndex >= 0 ? eventLog.slice(latestCheckpointIndex) : eventLog;
            })();
        for (const entry of eventsToReplay) {
            try {
                res.write(serializeEvent(entry.id, entry.name, entry.payload));
            }
            catch {
                sseClients.delete(res);
                return;
            }
        }
    };
    const closeSse = () => {
        for (const client of sseClients) {
            try {
                client.end();
            }
            catch { }
        }
        sseClients.clear();
    };
    const stopWatchdog = () => {
        if (!watchdog)
            return;
        clearInterval(watchdog);
        watchdog = null;
    };
    const closeListeners = () => {
        if (listenersClosed)
            return;
        listenersClosed = true;
        stopWatchdog();
        if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }
        try {
            server?.close();
        }
        catch { }
        try {
            sandboxProxyServer?.close();
        }
        catch { }
        closeSse();
    };
    const scheduleListenerClose = () => {
        if (closeTimer || listenersClosed)
            return;
        closeTimer = setTimeout(() => {
            closeTimer = null;
            closeListeners();
        }, 20);
        closeTimer.unref();
    };
    const markCompleted = (reason) => {
        if (completed)
            return;
        log.debug("Session completed", { reason });
        pushEvent("session-complete", { reason });
        completed = true;
        stopWatchdog();
        options.onComplete?.(reason);
        scheduleListenerClose();
    };
    const hostServer = http.createServer(async (req, res) => {
        try {
            const method = req.method || "GET";
            const hostHeader = req.headers.host;
            if (!hostHeader) {
                sendText(res, 400, "Missing host");
                return;
            }
            const url = new URL(req.url || "/", `http://${hostHeader}`);
            if (!isAllowedHost(url.hostname)) {
                sendText(res, 403, "Invalid host");
                return;
            }
            if (method === "HEAD" && url.pathname === "/") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end();
                return;
            }
            if (method === "GET" && url.pathname === "/") {
                if (!url.searchParams.has("session")) {
                    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
                    res.end("<!doctype html><html><head><meta charset=\"utf-8\"><title>MCP UI</title></head>" +
                        "<body><p>Open the authenticated MCP UI URL shown by Pi.</p></body></html>");
                    return;
                }
                if (!validateTokenQuery(url, sessionToken, res))
                    return;
                touchHeartbeat();
                if (!sandboxProxyUrl) {
                    sendText(res, 503, "Sandbox proxy is not ready");
                    return;
                }
                const html = buildHostHtmlTemplate({
                    sessionToken,
                    serverName: options.serverName,
                    toolName: options.toolName,
                    toolArgs: options.toolArgs,
                    resource: options.resource,
                    allowAttribute: resourceAllow,
                    requireToolConsent: options.consentManager.requiresPrompt(options.serverName),
                    cacheToolConsent: options.consentManager.shouldCacheConsent(),
                    hostContext,
                    sandboxProxyUrl,
                });
                res.writeHead(200, {
                    "Content-Type": "text/html; charset=utf-8",
                    "Cache-Control": "no-store",
                });
                res.end(html);
                return;
            }
            if (method === "GET" && url.pathname === "/events") {
                if (!validateTokenQuery(url, sessionToken, res))
                    return;
                touchHeartbeat();
                log.debug("SSE client connected", { clientCount: sseClients.size + 1 });
                res.writeHead(200, {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache, no-transform",
                    Connection: "keep-alive",
                    "X-Accel-Buffering": "no",
                });
                res.write(": connected\n\n");
                sseClients.add(res);
                replayEvents(res, req.headers["last-event-id"] ? String(req.headers["last-event-id"]) : null);
                req.on("close", () => {
                    sseClients.delete(res);
                });
                return;
            }
            if (method === "GET" && url.pathname === "/health") {
                if (!validateTokenQuery(url, sessionToken, res))
                    return;
                sendJson(res, 200, { ok: true, result: { healthy: true } });
                return;
            }
            if (method === "GET" && url.pathname === "/app-bridge.bundle.js") {
                // Serve the pre-bundled AppBridge module
                const bundlePath = path.join(import.meta.dirname, "app-bridge.bundle.js");
                try {
                    const content = await fs.readFile(bundlePath, "utf-8");
                    res.writeHead(200, {
                        "Content-Type": "application/javascript",
                        "Cache-Control": "public, max-age=31536000",
                    });
                    res.end(content);
                }
                catch {
                    sendJson(res, 500, { ok: false, error: "Bundle not found" });
                }
                return;
            }
            if (method !== "POST") {
                sendJson(res, 404, { ok: false, error: "Not found" });
                return;
            }
            const body = await parseBody(req, res);
            if (!body)
                return;
            if (!validateTokenBody(body, sessionToken, res))
                return;
            const params = body.params ?? {};
            touchHeartbeat();
            if (url.pathname === "/proxy/tools/call") {
                options.consentManager.ensureApproved(options.serverName);
                const callParams = params;
                if (!callParams || typeof callParams.name !== "string" || !callParams.name.trim()) {
                    sendJson(res, 400, { ok: false, error: "Invalid tools/call params" });
                    return;
                }
                const connection = options.manager.getConnection(options.serverName);
                if (!connection || connection.status !== "connected") {
                    sendJson(res, 503, { ok: false, error: `Server "${options.serverName}" is not connected` });
                    return;
                }
                if (isServerDisabled(options.config?.mcpServers[options.serverName]) || isServerDisabled(connection.definition)) {
                    sendJson(res, 503, { ok: false, error: `Server "${options.serverName}" is disabled` });
                    return;
                }
                const toolDefinitions = Array.isArray(connection.tools) ? connection.tools : [];
                const toolDefinition = toolDefinitions.find((tool) => tool.name === callParams.name);
                if (!toolDefinition) {
                    sendJson(res, 403, { ok: false, error: `MCP tool "${callParams.name}" is not callable by apps` });
                    return;
                }
                const uiVisibility = extractUiToolVisibility(toolDefinition._meta);
                if (!isUiToolCallableByApp(uiVisibility)) {
                    sendJson(res, 403, { ok: false, error: `MCP tool "${callParams.name}" is not callable by apps` });
                    return;
                }
                let normalizedArguments;
                try {
                    normalizedArguments = normalizeToolArguments(callParams.arguments, `tool "${callParams.name}" arguments`);
                }
                catch (error) {
                    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
                    return;
                }
                const callArgs = {
                    name: callParams.name,
                    arguments: normalizedArguments,
                };
                let uiResourceUri;
                try {
                    uiResourceUri = getToolUiResourceUri({ _meta: toolDefinition._meta });
                }
                catch {
                    // Preserve the endpoint's existing behavior for malformed declarations.
                }
                const annotations = extractToolAnnotations(toolDefinition.annotations);
                const toolMeta = {
                    name: callParams.name,
                    originalName: callParams.name,
                    description: toolDefinition?.description ?? "",
                    ...(toolDefinition?.inputSchema !== undefined ? { inputSchema: toolDefinition.inputSchema } : {}),
                    ...(uiResourceUri !== undefined ? { uiResourceUri } : {}),
                    ...(uiVisibility !== undefined ? { uiVisibility } : {}),
                    ...(annotations !== undefined ? { annotations } : {}),
                };
                const approvalMetadata = new Map(options.state?.toolMetadata);
                const definition = options.config?.mcpServers[options.serverName] ?? options.state?.config.mcpServers[options.serverName];
                approvalMetadata.set(options.serverName, [
                    ...connection.tools.map(tool => ({
                        name: tool.name,
                        originalName: tool.name,
                        description: tool.description ?? "",
                    })),
                    ...(definition?.exposeResources !== false ? (connection.resources ?? []).map(resource => {
                        const originalName = `read_${resourceNameToToolName(resource.name)}`;
                        return {
                            name: originalName,
                            originalName,
                            description: resource.description ?? `Read resource: ${resource.uri}`,
                        };
                    }) : []),
                ]);
                try {
                    // In flight from here so an idle check cannot close the server while the approval dialog is open.
                    options.manager.touch(options.serverName);
                    options.manager.incrementInFlight(options.serverName);
                    const approval = options.state
                        ? await ensureToolCallApproved(options.state, options.serverName, toolMeta, callArgs.arguments, options.state.owner?.signal, "iframe", approvalMetadata)
                        : options.config && isToolCallApprovalRequired(options.config, options.serverName, toolMeta, approvalMetadata)
                            ? { ok: false, reason: "approval_required_headless" }
                            : { ok: true };
                    if (approval.ok === false) {
                        const denied = approval.reason === "denied";
                        const message = denied
                            ? `The user declined approval to run MCP tool "${callParams.name}" on server "${options.serverName}".`
                            : `MCP tool "${callParams.name}" on server "${options.serverName}" is approval-gated and requires an interactive session.`;
                        sendJson(res, 200, {
                            ok: true,
                            result: {
                                content: [{ type: "text", text: message }],
                                details: {
                                    error: denied ? "approval_denied" : "approval_required",
                                    server: options.serverName,
                                    tool: callParams.name,
                                },
                            },
                        });
                        return;
                    }
                    const callTool = async (conn) => {
                        await options.manager.ensureListen?.(options.serverName, conn);
                        const requestOptions = options.manager.getRequestOptions?.(options.serverName);
                        if (conn.taskSession) {
                            return callToolViaTaskSession(conn.taskSession, {
                                name: callArgs.name,
                                args: callArgs.arguments,
                                requestTimeoutMs: requestOptions?.timeout,
                                signal: requestOptions?.signal,
                            });
                        }
                        return callToolPausingForElicitation(conn.client, callArgs, requestOptions);
                    };
                    const result = options.config
                        ? await withSessionRecovery({
                            manager: options.manager,
                            config: options.config,
                            ...(options.onNeedsAuth ? { onNeedsAuth: options.onNeedsAuth } : {}),
                        }, options.serverName, callTool)
                        : await callTool(connection);
                    sendJson(res, 200, { ok: true, result });
                }
                finally {
                    options.manager.decrementInFlight(options.serverName);
                    options.manager.touch(options.serverName);
                }
                return;
            }
            if (url.pathname === "/proxy/ui/consent") {
                const approved = !!params.approved;
                options.consentManager.registerDecision(options.serverName, approved);
                sendJson(res, 200, { ok: true, result: { approved } });
                return;
            }
            if (url.pathname === "/proxy/ui/generated-tool-call-intent") {
                const tool = typeof params.tool === "string" ? params.tool : undefined;
                if (tool && isAppOnlyTool(tool)) {
                    log.debug("Ignored generated app-only tool call intent", { tool });
                }
                else {
                    await recordUiMessage({
                        type: "intent",
                        intent: "call_tool",
                        params: {
                            ...(tool !== undefined ? { tool } : {}),
                            ...(params.arguments !== undefined ? { arguments: params.arguments } : {}),
                            ...(params.isError !== undefined ? { isError: params.isError } : {}),
                        },
                    });
                }
                sendJson(res, 200, { ok: true, result: {} });
                return;
            }
            if (url.pathname === "/proxy/ui/message") {
                await recordUiMessage(params);
                sendJson(res, 200, { ok: true, result: {} });
                return;
            }
            if (url.pathname === "/proxy/ui/context") {
                const content = params.content;
                const structuredContent = params.structuredContent;
                if ((content !== undefined && (!Array.isArray(content) || content.some((block) => !ContentBlockSchema.safeParse(block).success))) ||
                    (structuredContent !== undefined && (!structuredContent || typeof structuredContent !== "object" || Array.isArray(structuredContent)))) {
                    sendJson(res, 400, { ok: false, error: "Invalid update-model-context params" });
                    return;
                }
                const ctxParams = {
                    ...(content !== undefined ? { content: content } : {}),
                    ...(structuredContent !== undefined ? { structuredContent: structuredContent } : {}),
                };
                const update = createUiModelContextUpdate(ctxParams);
                if (update) {
                    sessionMessages.contexts.push(update);
                    while (sessionMessages.contexts.length > MAX_CONTEXT_UPDATES) {
                        sessionMessages.contexts.shift();
                    }
                }
                log.debug("UI context update", { hasContent: !!ctxParams.content, hasUpdate: !!update });
                await options.onContextUpdate?.(ctxParams);
                sendJson(res, 200, { ok: true, result: {} });
                return;
            }
            if (url.pathname === "/proxy/ui/open-link") {
                const openParams = params;
                if (!openParams?.url || typeof openParams.url !== "string") {
                    sendJson(res, 400, { ok: false, error: "Invalid open-link params" });
                    return;
                }
                let result = {};
                try {
                    new URL(openParams.url);
                }
                catch {
                    result = { isError: true };
                }
                sendJson(res, 200, { ok: true, result });
                return;
            }
            if (url.pathname === "/proxy/ui/download-file") {
                sendJson(res, 200, { ok: true, result: { isError: true } });
                return;
            }
            if (url.pathname === "/proxy/ui/request-display-mode") {
                const displayParams = params;
                const requested = displayParams?.mode;
                const available = hostContext.availableDisplayModes ?? ["inline"];
                if (requested && available.includes(requested)) {
                    currentDisplayMode = requested;
                }
                hostContext.displayMode = currentDisplayMode;
                pushEvent("host-context", { displayMode: currentDisplayMode });
                const result = { mode: currentDisplayMode };
                sendJson(res, 200, { ok: true, result });
                return;
            }
            if (url.pathname === "/proxy/ui/heartbeat") {
                // An open page keeps its server from being idle-closed; once heartbeats stop, the normal idle timer applies.
                options.manager.touch(options.serverName);
                sendJson(res, 200, { ok: true, result: {} });
                return;
            }
            if (url.pathname === "/proxy/ui/complete") {
                const reason = typeof params.reason === "string"
                    ? params.reason
                    : "done";
                markCompleted(reason);
                sendJson(res, 200, { ok: true, result: {} });
                return;
            }
            sendJson(res, 404, { ok: false, error: "Not found" });
        }
        catch (error) {
            if (error instanceof SessionRecoveryAuthRequiredError) {
                const fallback = `Server "${options.serverName}" requires OAuth authentication. Run mcp({ action: "auth-start", server: "${options.serverName}" }) to get a browser URL, or /mcp-auth ${options.serverName} in an interactive local session.`;
                const message = error.authMessage ?? (options.config
                    ? formatAuthRequiredMessage(options.config, options.serverName, fallback)
                    : fallback);
                sendJson(res, 401, { ok: false, error: message });
                return;
            }
            const wrapped = wrapError(error, { server: options.serverName, tool: options.toolName });
            const status = /approval required|denied/i.test(wrapped.message) ? 403 : 500;
            if (status === 500) {
                log.error("Request handler error", error instanceof Error ? error : undefined);
            }
            sendJson(res, status, { ok: false, error: wrapped.message });
        }
    });
    // OMA divergence (applied by scripts/vendor-pi-mcp-adapter.mjs;
    // recorded under generated.divergences in manifest.json): a permanent
    // 'error' listener for the host server's whole life. The retry loop
    // below arms a fresh once-listener per candidate and onListening drops
    // it after a successful listen, so an accept-class error (EMFILE/
    // ENFILE) after that meets zero 'error' listeners and escapes its emit
    // as the hosting engine's death. The journal is best-effort -- a
    // logger that throws must not throw out of the emit either -- and the
    // socket stays bound for the kernel to retry.
    hostServer.on("error", (listenerError) => {
        try {
            log.error("UI server listener error", listenerError instanceof Error ? listenerError : undefined);
        }
        catch {
        }
    });
    server = hostServer;
    if (options.initialResultPromise) {
        options.initialResultPromise.then((result) => pushEvent("tool-result", result), (error) => {
            const reason = error instanceof Error ? error.message : String(error);
            pushEvent("tool-cancelled", { reason });
        });
    }
    watchdog = setInterval(() => {
        if (completed)
            return;
        if (Date.now() - lastHeartbeatAt <= ABANDONED_GRACE_MS)
            return;
        markCompleted("stale");
    }, WATCHDOG_INTERVAL_MS);
    watchdog.unref();
    return new Promise((resolve, reject) => {
        const candidates = resolvePortCandidates(options.port);
        let candidateIndex = 0;
        const startSandboxProxy = (parentOrigin) => {
            const proxy = http.createServer((req, res) => {
                try {
                    const method = req.method || "GET";
                    const hostHeader = req.headers.host;
                    if (!hostHeader) {
                        sendText(res, 400, "Missing host");
                        return;
                    }
                    const url = new URL(req.url || "/", `http://${hostHeader}`);
                    if (!isAllowedHost(url.hostname)) {
                        sendText(res, 403, "Invalid host");
                        return;
                    }
                    if ((method === "GET" || method === "HEAD") && url.pathname === SANDBOX_PROXY_PATH) {
                        res.writeHead(200, {
                            "Content-Type": "text/html; charset=utf-8",
                            "Cache-Control": "no-store",
                            "Content-Security-Policy": buildSandboxProxyCsp(),
                            "Referrer-Policy": "no-referrer",
                            "X-Content-Type-Options": "nosniff",
                        });
                        res.end(method === "HEAD" ? undefined : buildSandboxProxyHtml({
                            parentOrigin,
                            resourcePath: sandboxResourcePath,
                            allowAttribute: resourceAllow,
                        }));
                        return;
                    }
                    if ((method === "GET" || method === "HEAD") && url.pathname === sandboxResourcePath) {
                        res.writeHead(200, {
                            "Content-Type": "text/html; charset=utf-8",
                            "Cache-Control": "no-store",
                            "Content-Security-Policy": buildSandboxResourceCsp(options.resource.meta.csp),
                            "Referrer-Policy": "no-referrer",
                            "X-Content-Type-Options": "nosniff",
                        });
                        res.end(method === "HEAD" ? undefined : options.resource.html);
                        return;
                    }
                    sendJson(res, 404, { ok: false, error: "Not found" });
                }
                catch (error) {
                    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
                }
            });
            sandboxProxyServer = proxy;
            return new Promise((resolveProxy, rejectProxy) => {
                const onError = (error) => {
                    proxy.off("listening", onListening);
                    rejectProxy(error);
                };
                const onListening = () => {
                    proxy.off("error", onError);
                    const address = proxy.address();
                    if (!address || typeof address === "string") {
                        rejectProxy(new ServerError("invalid sandbox proxy address"));
                        return;
                    }
                    resolveProxy(address.port);
                };
                // OMA divergence: the same permanent 'error' listener on
                // the sandbox proxy -- onListening removes the startup
                // once-listener below, so a post-listen accept-class error
                // would otherwise escape its emit the same way.
                proxy.on("error", (listenerError) => {
                    try {
                        log.error("Sandbox proxy listener error", listenerError instanceof Error ? listenerError : undefined);
                    }
                    catch {
                    }
                });
                proxy.once("error", onError);
                proxy.listen(0, "127.0.0.1", onListening);
            });
        };
        const listen = () => {
            const candidate = candidates[candidateIndex];
            if (candidate === undefined) {
                const error = new ServerError("no UI server port candidates available");
                closeListeners();
                reject(error);
                return;
            }
            hostServer.once("error", onError);
            hostServer.listen(candidate, "127.0.0.1", onListening);
        };
        const onError = (error) => {
            hostServer.off("listening", onListening);
            if (error.code === "EADDRINUSE" && candidateIndex < candidates.length - 1) {
                candidateIndex += 1;
                listen();
                return;
            }
            log.error("Failed to start server", error);
            const port = candidates[candidateIndex];
            closeListeners();
            reject(new ServerError(error.message, {
                ...(port !== undefined ? { port } : {}),
                cause: error,
            }));
        };
        const onListening = () => {
            hostServer.off("error", onError);
            const address = hostServer.address();
            if (!address || typeof address === "string") {
                const err = new ServerError("invalid address");
                log.error("Invalid server address", err);
                closeListeners();
                reject(err);
                return;
            }
            const parentOrigin = `http://localhost:${address.port}`;
            void startSandboxProxy(parentOrigin).then((proxyPort) => {
                if (completed || listenersClosed) {
                    closeListeners();
                    reject(new ServerError("UI session completed before sandbox proxy was ready"));
                    return;
                }
                sandboxProxyUrl = `http://localhost:${proxyPort}${SANDBOX_PROXY_PATH}`;
                log.debug("Servers started", { port: address.port, proxyPort });
                rememberMoshiDiscoveryPort(address.port);
                const handle = {
                    url: `http://localhost:${address.port}/?session=${sessionToken}`,
                    port: address.port,
                    proxyUrl: sandboxProxyUrl,
                    proxyPort,
                    sessionToken,
                    serverName: options.serverName,
                    toolName: options.toolName,
                    close: (reason) => {
                        markCompleted(reason ?? "closed");
                        closeListeners();
                    },
                    sendToolInput: (args) => {
                        pushEvent("tool-input", { arguments: args });
                    },
                    sendToolResult: (result) => {
                        pushEvent("tool-result", result);
                    },
                    sendResultPatch: (result) => {
                        pushEvent("result-patch", result);
                    },
                    sendToolCancelled: (reason) => {
                        pushEvent("tool-cancelled", { reason });
                    },
                    sendResourceUpdated: (uri) => {
                        pushEvent("resource-updated", { uri });
                    },
                    sendHostContext: (context) => {
                        Object.assign(hostContext, context);
                        pushEvent("host-context", context);
                    },
                    getSessionMessages: () => ({ ...sessionMessages }),
                    getStreamSummary: () => streamSummary ? { ...streamSummary, phases: [...streamSummary.phases] } : undefined,
                };
                resolve(handle);
            }).catch((error) => {
                log.error("Failed to start sandbox proxy", error instanceof Error ? error : undefined);
                closeListeners();
                const wrapped = error instanceof ServerError
                    ? error
                    : new ServerError(error instanceof Error ? error.message : String(error), { cause: error });
                reject(wrapped);
            });
        };
        listen();
    });
}
async function parseBody(req, res) {
    try {
        const body = await readBody(req);
        if (!body || typeof body !== "object") {
            sendJson(res, 400, { ok: false, error: "Invalid request body" });
            return null;
        }
        return body;
    }
    catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid body" });
        return null;
    }
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_SIZE) {
                req.destroy();
                reject(new Error("Request body too large"));
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
            }
            catch (error) {
                reject(error);
            }
        });
        req.on("error", reject);
    });
}
function resolvePortCandidates(port) {
    if (port !== undefined)
        return [port];
    const candidates = [];
    const count = MOSHI_DISCOVERY_PORT_END - MOSHI_DISCOVERY_PORT_START + 1;
    for (let offset = 0; offset < count; offset += 1) {
        const candidate = MOSHI_DISCOVERY_PORT_START + ((nextMoshiDiscoveryPort - MOSHI_DISCOVERY_PORT_START + offset) % count);
        candidates.push(candidate);
    }
    candidates.push(0);
    return candidates;
}
function rememberMoshiDiscoveryPort(port) {
    if (port < MOSHI_DISCOVERY_PORT_START || port > MOSHI_DISCOVERY_PORT_END)
        return;
    nextMoshiDiscoveryPort = port >= MOSHI_DISCOVERY_PORT_END ? MOSHI_DISCOVERY_PORT_START : port + 1;
}
function isAllowedHost(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
function validateTokenQuery(url, expected, res, parameter = "session") {
    const token = url.searchParams.get(parameter);
    if (token !== expected) {
        sendJson(res, 403, { ok: false, error: "Invalid session" });
        return false;
    }
    return true;
}
function validateTokenBody(body, expected, res) {
    if (body.token !== expected) {
        sendJson(res, 403, { ok: false, error: "Invalid session" });
        return false;
    }
    return true;
}
function sendJson(res, status, payload) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(payload));
}
function sendText(res, status, text) {
    res.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
    });
    res.end(text);
}
