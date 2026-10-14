import { randomUUID } from "node:crypto";
import { abortable } from "./abort.js";
import { combineAbortSignals } from "./runtime-owner.js";
import { getServerApprovalIdentity, getToolApprovalIdentity, rememberToolApproval } from "./session-approvals.js";
import { getToolNameCandidates, matchesToolPattern, resolveToolPrefix, MCP_TOOL_APPROVAL_REQUEST_EVENT, } from "./types.js";
import { sanitizeTerminalText } from "./utils.js";
export function isToolCallApprovalRequired(config, serverName, toolMeta, toolMetadata) {
    const definition = config.mcpServers[serverName];
    const serverApproval = definition?.approveTools;
    const approval = serverApproval !== undefined ? serverApproval : config.settings?.approveTools;
    if (approval === undefined || approval === false)
        return false;
    // MCP treats a tool as possibly destructive unless it says otherwise; reading a resource never is.
    if (approval === "destructive") {
        return toolMeta.resourceUri === undefined
            && toolMeta.annotations?.readOnlyHint !== true
            && toolMeta.annotations?.destructiveHint !== false;
    }
    // Values from unvalidated sources (imports, runtime registration) fail closed.
    if (!Array.isArray(approval))
        return true;
    if (approval.length === 0)
        return false;
    const prefix = resolveToolPrefix(definition, config.settings?.toolPrefix);
    const currentCandidates = getToolNameCandidates(toolMeta.originalName, serverName, prefix, false);
    if (serverApproval !== undefined) {
        if (matchesToolPattern(currentCandidates, approval))
            return true;
        if (!toolMetadata)
            return matchesToolPattern(getToolNameCandidates(toolMeta.originalName, serverName, prefix), approval);
        const legacyCandidates = getToolNameCandidates(toolMeta.originalName, serverName, prefix);
        const legacyEmittedName = [...currentCandidates].find(candidate => candidate !== toolMeta.originalName)?.replace(/-/g, "_");
        if (legacyEmittedName)
            legacyCandidates.add(legacyEmittedName);
        for (const candidate of currentCandidates)
            legacyCandidates.delete(candidate);
        const otherCurrentCandidates = new Set();
        for (const tool of toolMetadata.get(serverName) ?? []) {
            for (const candidate of getToolNameCandidates(tool.originalName, serverName, prefix, false)) {
                otherCurrentCandidates.add(candidate);
            }
        }
        for (const candidate of currentCandidates)
            otherCurrentCandidates.delete(candidate);
        return approval.some(pattern => matchesToolPattern(legacyCandidates, [pattern])
            && !matchesToolPattern(otherCurrentCandidates, [pattern]));
    }
    if (matchesToolPattern(currentCandidates, approval))
        return true;
    if (!toolMetadata)
        return false;
    const legacyCandidates = getToolNameCandidates(toolMeta.originalName, serverName, prefix);
    const legacyEmittedName = [...currentCandidates].find(candidate => candidate !== toolMeta.originalName)?.replace(/-/g, "_");
    if (legacyEmittedName)
        legacyCandidates.add(legacyEmittedName);
    for (const candidate of currentCandidates)
        legacyCandidates.delete(candidate);
    const otherCurrentCandidates = new Set();
    for (const [name, metadata] of toolMetadata) {
        const otherPrefix = resolveToolPrefix(config.mcpServers[name], config.settings?.toolPrefix);
        for (const tool of metadata) {
            for (const candidate of getToolNameCandidates(tool.originalName, name, otherPrefix, false)) {
                otherCurrentCandidates.add(candidate);
            }
        }
    }
    for (const candidate of currentCandidates)
        otherCurrentCandidates.delete(candidate);
    return approval.some(pattern => matchesToolPattern(legacyCandidates, [pattern])
        && !matchesToolPattern(otherCurrentCandidates, [pattern]));
}
function isMcpToolApprovalDecision(value) {
    return value === "allow_once"
        || value === "allow_for_session"
        || value === "deny"
        || value === "abstain";
}
/**
 * Returns "abstain" when no handler claims the request. A handler that throws
 * or returns an unknown value counts as "deny". Rethrows only when `signal` aborted.
 */
export async function requestBrokerApproval(events, serverName, toolMeta, args, origin, signal) {
    if (!events)
        return "abstain";
    let acceptingClaim = true;
    let handler;
    const request = {
        requestId: randomUUID(),
        serverName,
        originalToolName: toolMeta.originalName,
        prefixedToolName: toolMeta.name,
        args: args ?? {},
        origin,
        ...(signal !== undefined ? { signal } : {}),
        claim(candidate) {
            if (!acceptingClaim || handler)
                return false;
            handler = candidate;
            return true;
        },
    };
    events.emit(MCP_TOOL_APPROVAL_REQUEST_EVENT, request);
    acceptingClaim = false;
    if (!handler)
        return "abstain";
    try {
        const decision = await abortable(Promise.resolve().then(handler), signal);
        return isMcpToolApprovalDecision(decision) ? decision : "deny";
    }
    catch (error) {
        if (signal?.aborted)
            throw error;
        return "deny";
    }
}
export async function ensureToolCallApproved(state, serverName, toolMeta, args, signal, origin = toolMeta.resourceUri ? "resource" : "proxy", approvalMetadata) {
    const ownedSignal = combineAbortSignals(state.owner?.signal, signal);
    const approvedServers = state.approvedServers ??= new Map();
    const serverIdentity = getServerApprovalIdentity(state, serverName);
    const brokerDecision = await requestBrokerApproval(state.approvalEvents, serverName, toolMeta, args, origin, signal);
    if (brokerDecision === "allow_once")
        return { ok: true };
    if (brokerDecision === "allow_for_session") {
        rememberToolApproval(state, serverName, toolMeta, args);
        return { ok: true };
    }
    if (brokerDecision === "deny")
        return { ok: false, reason: "denied" };
    const serverGrant = approvedServers.get(serverName);
    const liveServerIdentity = getServerApprovalIdentity(state, serverName);
    if (serverGrant && state.approvedServers === approvedServers
        && serverGrant.definition === liveServerIdentity?.definition && serverGrant.hash === liveServerIdentity?.hash) {
        ownedSignal?.throwIfAborted();
        return { ok: true };
    }
    approvedServers.delete(serverName);
    const { cacheKey } = getToolApprovalIdentity(serverName, toolMeta, args);
    const approvedToolCalls = state.approvedToolCalls ??= new Map();
    if (approvedToolCalls.has(cacheKey)) {
        return { ok: true };
    }
    if (!isToolCallApprovalRequired(state.config, serverName, toolMeta, approvalMetadata ?? state.toolMetadata)) {
        return { ok: true };
    }
    if (!state.ui) {
        return { ok: false, reason: "approval_required_headless" };
    }
    const json = JSON.stringify(args ?? {}, null, 2);
    const sanitized = sanitizeTerminalText(json);
    const preview = sanitized.length > 500 ? `${sanitized.slice(0, 500)}...` : sanitized;
    const title = `MCP: ${sanitizeTerminalText(serverName)} wants to run ${sanitizeTerminalText(toolMeta.originalName)}`;
    const hint = toolMeta.annotations?.destructiveHint === true
        ? "\n\nThe server marks this tool as destructive: it may delete or overwrite data."
        : toolMeta.annotations?.readOnlyHint === true
            ? "\n\nThe server marks this tool as read-only."
            : "";
    const serverScope = "Allow server for this session permits all tools and arguments on this server until reload or session/branch change. Other security and UI consent checks still apply.";
    const decision = await abortable(state.ui.select(`${title}${hint}\n\nArguments:\n${preview}\n\n${serverScope}`, ["Allow once", "Allow for session", "Allow server for this session", "Deny"]), ownedSignal);
    if (decision === "Allow server for this session") {
        ownedSignal?.throwIfAborted();
        const currentIdentity = getServerApprovalIdentity(state, serverName);
        if (!serverIdentity || state.approvedServers !== approvedServers
            || currentIdentity?.definition !== serverIdentity.definition || currentIdentity.hash !== serverIdentity.hash) {
            return { ok: false, reason: "denied" };
        }
        approvedServers.set(serverName, serverIdentity);
        return { ok: true };
    }
    if (decision === "Allow once") {
        return { ok: true };
    }
    if (decision === "Allow for session") {
        rememberToolApproval(state, serverName, toolMeta, args);
        return { ok: true };
    }
    return { ok: false, reason: "denied" };
}
