import { isUiToolVisibleToModel } from "./ui-tool-visibility.js";
import { resourceNameToToolName } from "./resource-tools.js";
import { createCachedToolSelectorCandidateIndex, isServerCacheValid, parseDirectToolSelectors } from "./metadata-cache.js";
import { formatServerNamespace, formatToolName, isServerDisabled, isToolAllowed, resolveToolPrefix, resolveUniqueNameOwnership, } from "./types.js";
const BUILTIN_NAMES = new Set(["read", "bash", "edit", "write", "grep", "find", "ls", "mcp"]);
export function namespaceProxyName(serverName) {
    return `mcp__${formatServerNamespace(serverName)}`;
}
export function parseMcpReference(raw) {
    if (!raw.startsWith("mcp:"))
        return { raw };
    const rest = raw.slice("mcp:".length).trim();
    if (!rest)
        return { raw };
    const slash = rest.indexOf("/");
    if (slash === -1)
        return { raw, server: rest };
    const server = rest.slice(0, slash).trim();
    const tool = rest.slice(slash + 1).trim();
    return {
        raw,
        ...(server ? { server } : {}),
        ...(tool ? { tool } : {}),
    };
}
function resolveDirectSelection(config, definition, serverName, envOverride) {
    if (envOverride) {
        if (envOverride.servers.has(serverName))
            return true;
        const selectedTools = envOverride.tools.get(serverName);
        return selectedTools ? [...selectedTools] : false;
    }
    // "search" registers the same tool set as `true`; only activation differs.
    if (definition.directTools !== undefined)
        return definition.directTools === "search" ? true : definition.directTools;
    return config.settings?.directTools === true || config.settings?.directTools === "search";
}
export function isMcpServerDirectlyRegistered(definition, settings, serverName, envOverride) {
    if (envOverride)
        return envOverride.servers.has(serverName);
    if (definition?.directTools !== undefined) {
        return definition.directTools === true || definition.directTools === "search"
            || (Array.isArray(definition.directTools) && definition.directTools.length > 0);
    }
    return settings?.directTools === true || settings?.directTools === "search";
}
export function hasCallableCachedTargets(entry, definition) {
    return entry.tools.length > 0 || (definition.exposeResources !== false && (entry.resources?.length ?? 0) > 0);
}
function hasNamespaceProxy(config, cache, envOverride, collidingNamespaceNames, existingDirectNames, serverName) {
    if (config.settings?.namespaceProxyTools === false)
        return false;
    const definition = config.mcpServers[serverName];
    if (!definition || isServerDisabled(definition))
        return false;
    if (isMcpServerDirectlyRegistered(definition, config.settings, serverName, envOverride))
        return false;
    const toolName = namespaceProxyName(serverName);
    if (collidingNamespaceNames.has(toolName) || existingDirectNames.has(toolName))
        return false;
    const entry = resolveValidCache(definition, cache, serverName);
    return !!entry && hasCallableCachedTargets(entry, definition);
}
function resolveValidCache(definition, cache, serverName) {
    const entry = cache?.servers[serverName];
    if (!definition || !entry || !isServerCacheValid(entry, definition))
        return undefined;
    return entry;
}
function cachedServers(config, cache) {
    const servers = [];
    if (!cache)
        return servers;
    for (const [serverName, definition] of Object.entries(config.mcpServers)) {
        if (isServerDisabled(definition))
            continue;
        const entry = resolveValidCache(definition, cache, serverName);
        if (!entry)
            continue;
        servers.push({ serverName, definition, entry, prefix: resolveToolPrefix(definition, config.settings?.toolPrefix) });
    }
    return servers;
}
function namespaceCollisionNames(config, cache, envOverride, existingDirectNames) {
    const names = new Map();
    if (!cache)
        return new Set();
    for (const serverName of Object.keys(config.mcpServers)) {
        if (!hasNamespaceProxy(config, cache, envOverride, new Set(), existingDirectNames, serverName))
            continue;
        const toolName = namespaceProxyName(serverName);
        names.set(toolName, (names.get(toolName) ?? 0) + 1);
    }
    return new Set([...names].filter(([, count]) => count > 1).map(([name]) => name));
}
function registeredDirectNames(config, cache, envOverride, selectorIndex) {
    const entries = [];
    for (const { serverName, definition, entry, prefix } of cachedServers(config, cache)) {
        const selection = resolveDirectSelection(config, definition, serverName, envOverride);
        for (const { name, originalName } of directNameEntries(entry, serverName, definition, prefix, selection, selectorIndex)) {
            entries.push({ name, owner: { serverName, originalName } });
        }
    }
    return new Map(resolveUniqueNameOwnership(entries, (entry) => entry.name).unique.map(({ name, owner }) => [name, owner]));
}
function allCurrentCandidates(config, cache) {
    if (!cache)
        return undefined;
    return createCachedToolSelectorCandidateIndex(config.mcpServers, cache, config.settings?.toolPrefix ?? "server");
}
function directToolName(toolName, serverName, definition, prefix, selectorIndex) {
    if (!isToolAllowed(toolName, serverName, prefix, definition.includeTools, definition.excludeTools, selectorIndex))
        return undefined;
    return formatToolName(toolName, serverName, prefix);
}
function directNameEntries(entry, serverName, definition, prefix, selection, selectorIndex, onlyTool) {
    if (!selection)
        return [];
    const names = [];
    const addTool = (toolName) => {
        if (selection !== true && !selection.includes(toolName))
            return;
        const name = directToolName(toolName, serverName, definition, prefix, selectorIndex);
        if (!name)
            return;
        if (BUILTIN_NAMES.has(name))
            return;
        if (onlyTool !== undefined && toolName !== onlyTool && name !== onlyTool)
            return;
        names.push({ name, originalName: toolName });
    };
    for (const tool of entry.tools) {
        if (!isUiToolVisibleToModel(tool.uiVisibility))
            continue;
        addTool(tool.name);
    }
    if (definition.exposeResources !== false) {
        for (const resource of entry.resources ?? [])
            addTool(`read_${resourceNameToToolName(resource.name)}`);
    }
    return names;
}
function ownedDirectToolNames(names, serverName, directNameOwners) {
    return names
        .filter(({ name, originalName }) => {
        const owner = directNameOwners.get(name);
        return owner?.serverName === serverName && owner.originalName === originalName;
    })
        .map(({ name }) => name);
}
function hasAllowedProxyTool(entry, serverName, definition, prefix, selectorIndex, toolName) {
    if (toolName === undefined)
        return true;
    const matchesAllowedName = (baseName) => {
        if (!isToolAllowed(baseName, serverName, prefix, definition.includeTools, definition.excludeTools, selectorIndex))
            return false;
        return toolName === formatToolName(baseName, serverName, prefix);
    };
    if (entry.tools.some((tool) => isUiToolVisibleToModel(tool.uiVisibility) &&
        matchesAllowedName(tool.name)))
        return true;
    if (definition.exposeResources === false)
        return false;
    return (entry.resources ?? []).some((resource) => {
        const baseName = `read_${resourceNameToToolName(resource.name)}`;
        return matchesAllowedName(baseName);
    });
}
function addName(names, seen, name) {
    if (seen.has(name))
        return;
    seen.add(name);
    names.push(name);
}
function resolveKnownServerReference(parsed, config, cache, envOverride, collidingNamespaceNames, existingDirectNames, directNameOwners, selectorIndex, names, seen, diagnostics) {
    const serverName = parsed.server;
    const definition = config.mcpServers[serverName];
    if (!definition || isServerDisabled(definition)) {
        diagnostics.push(`MCP reference "${parsed.raw}" refers to disabled or unknown server "${serverName}"`);
        return;
    }
    const entry = resolveValidCache(definition, cache, serverName);
    if (!entry) {
        diagnostics.push(`MCP reference "${parsed.raw}" cannot be resolved: no valid cached metadata for server "${serverName}"`);
        return;
    }
    const prefix = resolveToolPrefix(definition, config.settings?.toolPrefix);
    const selection = resolveDirectSelection(config, definition, serverName, envOverride);
    const directNames = ownedDirectToolNames(directNameEntries(entry, serverName, definition, prefix, selection, selectorIndex, parsed.tool), serverName, directNameOwners);
    if (directNames.length > 0) {
        for (const name of directNames)
            addName(names, seen, name);
        return;
    }
    if (hasNamespaceProxy(config, cache, envOverride, collidingNamespaceNames, existingDirectNames, serverName)) {
        if (hasAllowedProxyTool(entry, serverName, definition, prefix, selectorIndex, parsed.tool)) {
            addName(names, seen, namespaceProxyName(serverName));
            return;
        }
        diagnostics.push(`MCP reference "${parsed.raw}" refers to unknown or hidden tool "${parsed.tool}" on server "${serverName}"`);
        return;
    }
    diagnostics.push(`MCP reference "${parsed.raw}" resolves to no registered tool`);
}
function resolveBareToolReference(raw, toolName, config, cache, envOverride, collidingNamespaceNames, existingDirectNames, directNameOwners, selectorIndex, names, seen, diagnostics) {
    let matched = false;
    for (const { serverName, definition, entry, prefix } of cachedServers(config, cache)) {
        const selection = resolveDirectSelection(config, definition, serverName, envOverride);
        const directNames = ownedDirectToolNames(directNameEntries(entry, serverName, definition, prefix, selection, selectorIndex, toolName), serverName, directNameOwners);
        for (const name of directNames) {
            addName(names, seen, name);
            matched = true;
        }
        if (hasNamespaceProxy(config, cache, envOverride, collidingNamespaceNames, existingDirectNames, serverName) &&
            hasAllowedProxyTool(entry, serverName, definition, prefix, selectorIndex, toolName)) {
            addName(names, seen, namespaceProxyName(serverName));
            matched = true;
        }
    }
    if (!matched)
        diagnostics.push(`MCP reference "${raw}" does not match a configured server or cached tool`);
}
export function resolveMcpToolReferences(refs, config, cache, envOverride) {
    const names = [];
    const diagnostics = [];
    const seen = new Set();
    if (!config) {
        return {
            names: refs.filter((ref) => !ref.startsWith("mcp:")),
            diagnostics: refs.filter((ref) => ref.startsWith("mcp:")).map((ref) => `MCP reference "${ref}" cannot be resolved: no MCP config`),
        };
    }
    const parsedOverride = envOverride ? parseDirectToolSelectors(envOverride) : null;
    const selectorIndex = allCurrentCandidates(config, cache);
    const directNameOwners = registeredDirectNames(config, cache, parsedOverride, selectorIndex);
    const directNames = new Set(directNameOwners.keys());
    const collidingNamespaceNames = namespaceCollisionNames(config, cache, parsedOverride, directNames);
    for (const ref of refs) {
        if (!ref.startsWith("mcp:")) {
            addName(names, seen, ref);
            continue;
        }
        const parsed = parseMcpReference(ref);
        if (!parsed.server) {
            diagnostics.push(`MCP reference "${ref}" is empty after the "mcp:" prefix`);
            continue;
        }
        if (config.mcpServers[parsed.server]) {
            resolveKnownServerReference(parsed, config, cache, parsedOverride, collidingNamespaceNames, directNames, directNameOwners, selectorIndex, names, seen, diagnostics);
        }
        else if (parsed.tool === undefined) {
            resolveBareToolReference(ref, parsed.server, config, cache, parsedOverride, collidingNamespaceNames, directNames, directNameOwners, selectorIndex, names, seen, diagnostics);
        }
        else {
            diagnostics.push(`MCP reference "${ref}" refers to unknown server "${parsed.server}"`);
        }
    }
    return { names, diagnostics };
}
