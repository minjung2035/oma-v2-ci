// host-managed.ts - MCP tools for an embedding application that owns the
// transport, credentials, approval, dispatch record, and instance lifetime.
//
// Unlike the ordinary extension, this profile reads no config files, never
// touches OAuth or the keyring, registers no commands, UI, or proxy tools, and
// never reconnects, recovers a session, or resends a tools/call request.
import { randomUUID } from "node:crypto";
import { Client, ProtocolError, SdkError, SdkErrorCode, } from "@modelcontextprotocol/client";
import { createJsonSchemaValidator } from "./json-schema-validator.js";
import { guardMcpOutput, guardedMcpDetails, resolveMcpOutputGuardOptions } from "./mcp-output-guard.js";
import { combineAbortSignals } from "./runtime-owner.js";
import { abortable } from "./abort.js";
import { requestBrokerApproval } from "./tool-approval.js";
import { toToolParameters } from "./tool-parameters.js";
import { cleanupMaterializedBinaryResources, resolveMcpResultContent } from "./tool-registrar.js";
import { formatToolName } from "./types.js";
import { normalizeDirectToolInputSchema, normalizeToolArguments, stableStringify, truncateAtWord, withToolCallIdMeta } from "./utils.js";
const CLOSE_TIMEOUT_MS = 5_000;
const DELIVERY_MESSAGES = {
    not_sent: "the request was not sent",
    may_have_run: "the request failed after it was sent; the tool may have run",
    server_error: "the server returned an error response",
    invalid_result: "the server returned an invalid result; the tool may have run",
};
/** Fixed-message dispatch failure. The raw error is kept only as `cause`. */
export class HostManagedMcpError extends Error {
    delivery;
    server;
    protocolCode;
    constructor(delivery, server, options = {}) {
        super(`MCP server "${server}": ${DELIVERY_MESSAGES[delivery]}`, options.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = "HostManagedMcpError";
        this.delivery = delivery;
        this.server = server;
        if (options.protocolCode !== undefined)
            this.protocolCode = options.protocolCode;
    }
}
function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value))
            deepFreeze(child);
    }
    return value;
}
function classifyDispatchError(server, cause) {
    if (cause instanceof HostManagedMcpError)
        return cause;
    // Output-schema validation runs in this module, so a ProtocolError here is a
    // JSON-RPC error response from the server.
    if (cause instanceof ProtocolError)
        return new HostManagedMcpError("server_error", server, { cause, protocolCode: cause.code });
    if (cause instanceof SdkError && cause.code === SdkErrorCode.InvalidResult) {
        return new HostManagedMcpError("invalid_result", server, { cause });
    }
    if (cause instanceof SdkError && cause.code === SdkErrorCode.NotConnected) {
        return new HostManagedMcpError("not_sent", server, { cause });
    }
    return new HostManagedMcpError("may_have_run", server, { cause });
}
function textResult(text, details) {
    return { content: [{ type: "text", text }], details };
}
function isAllowed(decision) {
    return decision === "allow_once" || decision === "allow_for_session";
}
function dispatchFailureResult(tool, error, catalogChanged = false) {
    const name = tool.definition.name;
    if (catalogChanged && error.delivery === "not_sent") {
        return textResult(`MCP tool "${name}" on server "${tool.server}" was not run: its definition changed after it was loaded, so the call was not sent. Start a new session to use the new definition.`, { error: "catalog_changed", server: tool.server, tool: name });
    }
    const details = { error: error.delivery, server: tool.server, tool: name };
    const unknownOutcome = "Do not retry automatically; check its effects first.";
    switch (error.delivery) {
        case "not_sent":
            return textResult(`MCP tool "${name}" on server "${tool.server}" was not run: the request was not sent because the call was cancelled or the MCP connection is closed.`, details);
        case "may_have_run":
            return textResult(`MCP tool "${name}" on server "${tool.server}" failed after the request was sent, so it may have run. ${unknownOutcome}`, details);
        case "server_error": {
            const code = error.protocolCode !== undefined ? ` (JSON-RPC code ${error.protocolCode})` : "";
            if (error.protocolCode !== undefined)
                details.protocolCode = error.protocolCode;
            return textResult(`MCP server "${tool.server}" returned an error for tool "${name}"${code}.`, details);
        }
        case "invalid_result":
            return textResult(`MCP tool "${name}" on server "${tool.server}" returned an invalid result, so it may have run. ${unknownOutcome}`, details);
    }
}
export function createHostManagedMcpAdapter(options) {
    const servers = Object.entries(options.servers);
    const timeout = options.requestTimeoutMs !== undefined && options.requestTimeoutMs > 0 ? options.requestTimeoutMs : undefined;
    const guardOptions = resolveMcpOutputGuardOptions(undefined);
    const lifetime = new AbortController();
    const connections = new Map();
    const inFlight = new Set();
    let catalog;
    let readyPromise;
    let closePromise;
    let closed = false;
    const requestOptions = (signal) => (timeout !== undefined ? { signal, timeout } : { signal });
    // Re-list after tools/list_changed, one request at a time; a notification
    // during a re-list schedules one more. A selected tool whose definition
    // changed or disappeared, or any re-list failure, retires it for good.
    function requestCatalogRefresh(connection) {
        connection.refreshRequested = true;
        const selected = connection.selected;
        if (!selected || connection.refresh)
            return;
        connection.refresh = (async () => {
            while (connection.refreshRequested) {
                connection.refreshRequested = false;
                try {
                    const { tools } = await connection.client.listTools(undefined, { ...requestOptions(lifetime.signal), cacheMode: "refresh" });
                    const current = new Map(tools.map((tool) => [tool.name, stableStringify(tool)]));
                    for (const tool of selected) {
                        if (current.get(tool.definition.name) !== tool.fingerprint)
                            connection.retired.add(tool.definition.name);
                    }
                }
                catch {
                    for (const tool of selected)
                        connection.retired.add(tool.definition.name);
                }
            }
            connection.refresh = undefined;
        })();
    }
    async function isRetired(connection, name) {
        while (connection.refresh)
            await connection.refresh;
        return connection.retired.has(name);
    }
    async function connectServer(server, definition, validators) {
        let connection;
        let listed;
        try {
            const pending = Promise.resolve().then(() => definition.createTransport({ server, signal: lifetime.signal }));
            // A factory that ignores the abort must not hold ready() open after
            // close(); a transport it delivers late is closed, never adopted.
            void pending.then((late) => { if (closed)
                void late.close().catch(() => { }); }, () => { });
            const transport = await abortable(pending, lifetime.signal);
            const client = new Client({ name: `pi-mcp-${server}`, version: "1.0.0" }, 
            // No client capabilities, and no multi-round-trip auto-fulfilment: that
            // driver would resend the original tools/call with collected input.
            { capabilities: {}, jsonSchemaValidator: validators, inputRequired: { autoFulfill: false } });
            // Raw transport errors can carry credentials; the adapter never logs them.
            client.onerror = () => { };
            const created = {
                id: randomUUID(), client, transport, open: true,
                selected: undefined, retired: new Set(), refresh: undefined, refreshRequested: false,
            };
            connection = created;
            client.onclose = () => { created.open = false; };
            // Registered directly rather than through ClientOptions.listChanged so
            // the change is known synchronously (no debounce) even when the server
            // does not advertise tools.listChanged.
            client.setNotificationHandler("notifications/tools/list_changed", () => requestCatalogRefresh(created));
            connections.set(server, created);
            if (closed) {
                // close() already swept the connections it could see.
                await transport.close().catch(() => { });
                throw new HostManagedMcpError("not_sent", server);
            }
            await client.connect(transport, requestOptions(lifetime.signal));
            listed = (await client.listTools(undefined, requestOptions(lifetime.signal))).tools;
        }
        catch (cause) {
            throw new Error(`Host-managed MCP server "${server}" failed to start`, { cause });
        }
        const byName = new Map(listed.map((tool) => [tool.name, tool]));
        const selected = definition.tools ? [...new Set(definition.tools)] : [...byName.keys()];
        const tools = selected.map((name) => {
            const tool = byName.get(name);
            if (!tool)
                throw new Error(`Host-managed MCP server "${server}" does not list tool "${name}"`);
            const frozen = deepFreeze(structuredClone(tool));
            const { outputSchema, ...withoutOutputSchema } = frozen;
            let validateOutput;
            if (outputSchema) {
                try {
                    validateOutput = validators.getValidator(structuredClone(outputSchema));
                }
                catch (cause) {
                    throw new Error(`Host-managed MCP tool "${name}" on server "${server}" has an invalid outputSchema`, { cause });
                }
            }
            return {
                server,
                toolName: formatToolName(name, server, "server"),
                definition: frozen,
                fingerprint: stableStringify(frozen),
                // The SDK reports its own output-schema failures as ProtocolError,
                // indistinguishable from a server error response; validate here instead.
                sdkDefinition: Object.freeze(withoutOutputSchema),
                validateOutput,
            };
        });
        connection.selected = tools;
        // A notification that arrived before selection still gets its re-list.
        if (connection.refreshRequested)
            requestCatalogRefresh(connection);
        return tools;
    }
    async function start() {
        try {
            const validators = createJsonSchemaValidator();
            const perServer = await Promise.all(servers.map(([server, definition]) => connectServer(server, definition, validators)));
            const tools = perServer.flat();
            const owners = new Map();
            for (const tool of tools) {
                const owner = owners.get(tool.toolName);
                if (owner) {
                    throw new Error(`Host-managed MCP tools "${owner.server}/${owner.definition.name}" and "${tool.server}/${tool.definition.name}" both map to Pi tool "${tool.toolName}"`);
                }
                owners.set(tool.toolName, tool);
            }
            if (closed)
                throw new Error("Host-managed MCP adapter closed before it was ready");
            catalog = Object.freeze(tools);
        }
        catch (error) {
            await close();
            throw error;
        }
    }
    async function executeTool(pi, tool, toolCallId, params, piSignal) {
        const name = tool.definition.name;
        const connection = connections.get(tool.server);
        if (closed || !connection?.open)
            return dispatchFailureResult(tool, new HostManagedMcpError("not_sent", tool.server));
        let args;
        try {
            args = deepFreeze(normalizeToolArguments(params));
        }
        catch (error) {
            return textResult(error instanceof Error ? error.message : String(error), { error: "invalid_arguments", server: tool.server, tool: name });
        }
        const signal = combineAbortSignals(lifetime.signal, piSignal) ?? lifetime.signal;
        let decision;
        try {
            decision = await requestBrokerApproval(pi.events, tool.server, { name: tool.toolName, originalName: name }, args, "direct", signal);
        }
        catch {
            return dispatchFailureResult(tool, new HostManagedMcpError("not_sent", tool.server));
        }
        if (decision === "deny") {
            return textResult(`The user declined approval to run MCP tool "${name}" on server "${tool.server}".`, { error: "approval_denied", server: tool.server, tool: name });
        }
        if (!isAllowed(decision)) {
            return textResult(`MCP tool "${name}" on server "${tool.server}" was not run: no approval handler allowed it.`, { error: "approval_required", server: tool.server, tool: name });
        }
        if (closed || !connection.open || signal.aborted)
            return dispatchFailureResult(tool, new HostManagedMcpError("not_sent", tool.server));
        if (await isRetired(connection, name))
            return dispatchFailureResult(tool, new HostManagedMcpError("not_sent", tool.server), true);
        let dispatched = false;
        let sent = false;
        let settled = false;
        let dispatchedResult;
        const unavailable = () => settled || closed || !connection.open || signal.aborted;
        const send = async () => {
            const retired = await isRetired(connection, name);
            if (unavailable() || retired)
                throw new HostManagedMcpError("not_sent", tool.server);
            sent = true;
            let result;
            try {
                const meta = withToolCallIdMeta(undefined, toolCallId);
                result = await connection.client.callTool({ name, arguments: args, ...(meta ? { _meta: meta } : {}) }, { ...requestOptions(signal), toolDefinition: tool.sdkDefinition });
            }
            catch (cause) {
                throw classifyDispatchError(tool.server, cause);
            }
            if (tool.validateOutput && !result.isError) {
                let valid = false;
                try {
                    valid = result.structuredContent !== undefined && tool.validateOutput(result.structuredContent).valid;
                }
                catch {
                    valid = false;
                }
                if (!valid)
                    throw new HostManagedMcpError("invalid_result", tool.server);
            }
            dispatchedResult = result;
            return result;
        };
        const readLinkedResource = async (uri) => {
            if (unavailable())
                throw new HostManagedMcpError("not_sent", tool.server);
            let decision;
            try {
                decision = await requestBrokerApproval(pi.events, tool.server, { name: tool.toolName, originalName: name }, Object.freeze({ uri }), "resource", signal);
            }
            catch {
                decision = "abstain";
            }
            if (!isAllowed(decision) || unavailable())
                throw new HostManagedMcpError("not_sent", tool.server);
            let readDispatched = false;
            const sendRead = async () => {
                if (unavailable())
                    throw new HostManagedMcpError("not_sent", tool.server);
                try {
                    return await connection.client.readResource({ uri }, { ...requestOptions(signal), cacheMode: "bypass" });
                }
                catch (cause) {
                    throw classifyDispatchError(tool.server, cause);
                }
            };
            return Object.freeze({
                uri,
                readId: randomUUID(),
                connectionId: connection.id,
                parentToolCallId: toolCallId,
                dispatch() {
                    if (readDispatched)
                        throw new Error(`dispatch() was already called for MCP resource read "${uri}"`);
                    readDispatched = true;
                    return sendRead();
                },
            });
        };
        const call = Object.freeze({
            server: tool.server,
            tool: name,
            toolName: tool.toolName,
            toolCallId,
            connectionId: connection.id,
            arguments: args,
            inputSchema: tool.definition.inputSchema,
            signal,
            dispatch() {
                if (dispatched)
                    throw new Error(`dispatch() was already called for MCP tool call "${toolCallId}"`);
                dispatched = true;
                return send();
            },
            linkedResource(uri) {
                const linked = dispatchedResult?.content.some((block) => block.type === "resource_link" && block.uri === uri);
                if (!linked)
                    throw new Error(`"${uri}" is not a resource_link in the dispatched result of MCP tool call "${toolCallId}"`);
                return readLinkedResource(uri);
            },
        });
        let result;
        try {
            result = await options.onToolCall(call);
        }
        catch (error) {
            // After a successful dispatch, a HostManagedMcpError comes from other
            // host work (such as a linked read), and the tool itself may have run.
            if (error instanceof HostManagedMcpError && dispatchedResult === undefined) {
                return dispatchFailureResult(tool, error, connection.retired.has(name));
            }
            const details = { error: "host_error", server: tool.server, tool: name, sent };
            return sent
                ? textResult(`The host failed while handling MCP tool "${name}" on server "${tool.server}" after the request was sent, so it may have run. Do not retry automatically; check its effects first.`, details)
                : textResult(`The host rejected MCP tool "${name}" on server "${tool.server}"; it was not run.`, details);
        }
        finally {
            settled = true;
        }
        const content = resolveMcpResultContent(result, lifetime.signal);
        const outputContent = content.length > 0 ? content : [{ type: "text", text: "(empty result)" }];
        if (result.isError) {
            const guarded = await guardMcpOutput(outputContent, { ...guardOptions, prefix: "Error: ", emptyTextFallback: "Tool execution failed" });
            return { content: guarded.content, details: { error: "tool_error", server: tool.server, ...guardedMcpDetails(guarded) } };
        }
        const guarded = await guardMcpOutput(outputContent, guardOptions);
        return { content: guarded.content, details: { server: tool.server, tool: name, ...guardedMcpDetails(guarded) } };
    }
    function track(execution) {
        inFlight.add(execution);
        void execution.finally(() => inFlight.delete(execution)).catch(() => { });
        return execution;
    }
    async function shutdown() {
        closed = true;
        lifetime.abort();
        // One deadline bounds both the drain and the host's transport.close() calls.
        let timer;
        const deadline = new Promise((resolve) => { timer = setTimeout(resolve, CLOSE_TIMEOUT_MS); });
        await Promise.race([Promise.allSettled([...inFlight]), deadline]);
        const closing = Promise.allSettled([...connections.values()].map(async (connection) => {
            connection.open = false;
            await connection.transport.close();
        }));
        await Promise.race([closing, deadline]);
        clearTimeout(timer);
        connections.clear();
        cleanupMaterializedBinaryResources(lifetime.signal);
    }
    function close() {
        closePromise ??= shutdown();
        return closePromise;
    }
    return {
        ready() {
            readyPromise ??= closed ? Promise.reject(new Error("Host-managed MCP adapter is closed")) : start();
            return readyPromise;
        },
        close,
        extensionFactory(pi) {
            if (closed)
                throw new Error("Host-managed MCP adapter is closed");
            if (!catalog)
                throw new Error("Host-managed MCP adapter is not ready; await ready() before loading extensionFactory");
            for (const tool of catalog) {
                const description = tool.definition.description ?? "";
                pi.registerTool({
                    name: tool.toolName,
                    label: `MCP: ${tool.definition.name}`,
                    description: description || "(no description)",
                    promptSnippet: truncateAtWord(description, 100) || `MCP tool from ${tool.server}`,
                    parameters: toToolParameters(normalizeDirectToolInputSchema(structuredClone(tool.definition.inputSchema))),
                    execute: (toolCallId, params, signal) => track(executeTool(pi, tool, toolCallId, params, signal)),
                });
            }
        },
    };
}
