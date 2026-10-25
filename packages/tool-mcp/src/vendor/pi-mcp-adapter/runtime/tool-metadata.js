import { getToolUiResourceUri } from "./ui-app-bridge-helpers.js";
import { createToolSelectorCandidateIndex, formatToolName, getToolNameCandidates, isToolAllowed, resolveToolPrefix, resolveUniqueNameOwnership } from "./types.js";
import { resourceNameToToolName } from "./resource-tools.js";
import { extractToolAnnotations, extractToolUiStreamMode } from "./utils.js";
import { extractUiToolVisibility, isUiToolVisibleToModel } from "./ui-tool-visibility.js";
export function buildToolMetadata(tools, resources, definition, serverName, prefix, configuredServers, knownMetadata, includeMissingConfiguredCandidates = false) {
    const metadata = [];
    const failedTools = [];
    const effectivePrefix = resolveToolPrefix(definition, prefix);
    const hasToolFilters = (Array.isArray(definition.includeTools) && definition.includeTools.length > 0) ||
        (Array.isArray(definition.excludeTools) && definition.excludeTools.length > 0);
    const selectorCandidateIndex = hasToolFilters && configuredServers ? (() => {
        const candidates = new Set();
        const additionalCandidatesByToolName = new Map();
        const evaluatedToolNames = new Set();
        const addCandidates = (target, originalName, candidateServerName, candidatePrefix) => {
            for (const candidate of getToolNameCandidates(originalName, candidateServerName, candidatePrefix, false))
                target.add(candidate);
        };
        for (const tool of tools) {
            if (!tool?.name)
                continue;
            evaluatedToolNames.add(tool.name);
            addCandidates(candidates, tool.name, serverName, effectivePrefix);
        }
        if (definition.exposeResources !== false) {
            for (const resource of resources) {
                const baseName = `read_${resourceNameToToolName(resource.name)}`;
                evaluatedToolNames.add(baseName);
                if (resource?.name && resource?.uri)
                    addCandidates(candidates, baseName, serverName, effectivePrefix);
            }
        }
        for (const [otherServerName, otherDefinition] of Object.entries(configuredServers)) {
            if (otherServerName === serverName)
                continue;
            const otherPrefix = resolveToolPrefix(otherDefinition, prefix);
            const knownTools = knownMetadata?.get(otherServerName);
            if (knownTools) {
                for (const tool of knownTools) {
                    candidates.add(tool.name);
                    addCandidates(candidates, tool.originalName, otherServerName, otherPrefix);
                }
            }
            else if (!knownMetadata || includeMissingConfiguredCandidates) {
                for (const toolName of evaluatedToolNames) {
                    let additionalCandidates = additionalCandidatesByToolName.get(toolName);
                    if (!additionalCandidates) {
                        additionalCandidates = new Set();
                        additionalCandidatesByToolName.set(toolName, additionalCandidates);
                    }
                    addCandidates(additionalCandidates, toolName, otherServerName, otherPrefix);
                    if (includeMissingConfiguredCandidates) {
                        for (const candidate of getToolNameCandidates(toolName, otherServerName, otherPrefix, false)) {
                            additionalCandidates.add(candidate.replace(/-/g, "_"));
                        }
                    }
                }
            }
        }
        return createToolSelectorCandidateIndex(candidates, additionalCandidatesByToolName);
    })() : undefined;
    for (const tool of tools) {
        if (!tool?.name) {
            failedTools.push("(unnamed)");
            continue;
        }
        if (!isToolAllowed(tool.name, serverName, effectivePrefix, definition.includeTools, definition.excludeTools, selectorCandidateIndex)) {
            continue;
        }
        const name = formatToolName(tool.name, serverName, effectivePrefix);
        const uiVisibility = extractUiToolVisibility(tool._meta);
        if (!isUiToolVisibleToModel(uiVisibility)) {
            continue;
        }
        let uiResourceUri;
        try {
            uiResourceUri = getToolUiResourceUri({ _meta: tool._meta });
        }
        catch {
            failedTools.push(tool.name);
        }
        const uiStreamMode = extractToolUiStreamMode(tool._meta);
        const annotations = extractToolAnnotations(tool.annotations);
        metadata.push({
            name,
            originalName: tool.name,
            description: tool.description ?? "",
            ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
            ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
            ...(uiResourceUri !== undefined ? { uiResourceUri } : {}),
            ...(uiVisibility !== undefined ? { uiVisibility } : {}),
            ...(uiStreamMode !== undefined ? { uiStreamMode } : {}),
            ...(annotations !== undefined ? { annotations } : {}),
        });
    }
    if (definition.exposeResources !== false) {
        for (const resource of resources) {
            const baseName = `read_${resourceNameToToolName(resource.name)}`;
            if (!isToolAllowed(baseName, serverName, effectivePrefix, definition.includeTools, definition.excludeTools, selectorCandidateIndex)) {
                continue;
            }
            const name = formatToolName(baseName, serverName, effectivePrefix);
            metadata.push({
                name,
                originalName: baseName,
                description: resource.description ?? `Read resource: ${resource.uri}`,
                resourceUri: resource.uri,
            });
        }
    }
    const ownership = resolveUniqueNameOwnership(metadata, (tool) => tool.name);
    for (const colliding of ownership.collisions.values()) {
        failedTools.push(...colliding.map((tool) => tool.originalName));
    }
    return { metadata: ownership.unique, failedTools };
}
export function getToolNames(state, serverName) {
    return state.toolMetadata.get(serverName)?.map(m => m.name) ?? [];
}
export function totalToolCount(state) {
    let count = 0;
    for (const metadata of state.toolMetadata.values()) {
        count += metadata.length;
    }
    return count;
}
export function findToolByName(metadata, toolName) {
    if (!metadata)
        return undefined;
    const exact = metadata.find(m => m.name === toolName);
    if (exact)
        return exact;
    const normalized = toolName.replace(/-/g, "_");
    return metadata.find(m => m.name.replace(/-/g, "_") === normalized);
}
/** Whether the schema formatter has field descriptions worth showing beside a compact shape. */
export function hasSchemaDescriptions(schema, includeRoot = false) {
    if (!schema || typeof schema !== "object" || Array.isArray(schema))
        return false;
    const s = schema;
    if (includeRoot && typeof s.description === "string" && s.description.length > 0)
        return true;
    const hasNestedDescription = (child) => hasSchemaDescriptions(child, true);
    if (s.properties && typeof s.properties === "object" && !Array.isArray(s.properties)
        && Object.values(s.properties).some(hasNestedDescription))
        return true;
    return hasNestedDescription(s.items)
        || (Array.isArray(s.anyOf) && s.anyOf.some(hasNestedDescription))
        || (Array.isArray(s.oneOf) && s.oneOf.some(hasNestedDescription));
}
export function formatSchema(schema, indent = "  ") {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        return `${indent}(no schema)`;
    }
    const s = schema;
    if (s.type === "object" && s.properties && typeof s.properties === "object" && !Array.isArray(s.properties)) {
        const props = s.properties;
        const required = Array.isArray(s.required) ? s.required.filter((name) => typeof name === "string") : [];
        if (Object.keys(props).length === 0) {
            return `${indent}(no parameters)`;
        }
        const lines = [];
        for (const [name, propSchema] of Object.entries(props)) {
            lines.push(...formatProperty(name, propSchema, required.includes(name), indent));
        }
        return lines.join("\n");
    }
    const lines = formatNestedSchema(s, indent);
    if (lines.length > 0) {
        return lines.join("\n");
    }
    const typeStr = formatType(s);
    if (typeStr) {
        return `${indent}(${typeStr})`;
    }
    return `${indent}(complex schema)`;
}
function formatProperty(name, schema, required, indent) {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        return [`${indent}${name}${required ? " *required*" : ""}`];
    }
    const s = schema;
    const parts = [`${indent}${name}`];
    const typeStr = formatType(s);
    if (typeStr)
        parts.push(`(${typeStr})`);
    if (required)
        parts.push("*required*");
    appendSchemaAnnotations(parts, s);
    return [parts.join(" "), ...formatNestedSchema(s, `${indent}  `)];
}
function formatNestedSchema(schema, indent) {
    const lines = [];
    if (Array.isArray(schema.anyOf)) {
        lines.push(...formatVariants("anyOf", schema.anyOf, indent));
    }
    if (Array.isArray(schema.oneOf)) {
        lines.push(...formatVariants("oneOf", schema.oneOf, indent));
    }
    if (schema.items !== undefined) {
        lines.push(...formatProperty("items", schema.items, false, indent));
    }
    if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
        const required = Array.isArray(schema.required) ? schema.required.filter((name) => typeof name === "string") : [];
        for (const [name, propSchema] of Object.entries(schema.properties)) {
            lines.push(...formatProperty(name, propSchema, required.includes(name), indent));
        }
    }
    return lines;
}
function formatVariants(keyword, variants, indent) {
    const lines = [`${indent}${keyword}:`];
    for (const variant of variants) {
        if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
            lines.push(`${indent}  - ${JSON.stringify(variant)}`);
            continue;
        }
        const s = variant;
        const typeStr = formatType(s) || "schema";
        const parts = [`${indent}  - ${typeStr}`];
        appendSchemaAnnotations(parts, s);
        lines.push(parts.join(" "));
        lines.push(...formatNestedSchema(s, `${indent}    `));
    }
    return lines;
}
function formatType(schema) {
    if (Object.hasOwn(schema, "const")) {
        return `const ${JSON.stringify(schema.const)}`;
    }
    if (Array.isArray(schema.enum)) {
        return `enum: ${schema.enum.map(v => JSON.stringify(v)).join(", ")}`;
    }
    if (Array.isArray(schema.type)) {
        return schema.type.map(type => String(type)).join(" | ");
    }
    if (schema.type) {
        return String(schema.type);
    }
    if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
        return "object";
    }
    if (schema.items !== undefined) {
        return "array";
    }
    return "";
}
function appendSchemaAnnotations(parts, schema) {
    if (schema.description && typeof schema.description === "string") {
        parts.push(`- ${schema.description}`);
    }
    for (const key of ["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "format", "pattern"]) {
        if (schema[key] !== undefined) {
            parts.push(`[${key}: ${JSON.stringify(schema[key])}]`);
        }
    }
    if (schema.default !== undefined) {
        parts.push(`[default: ${JSON.stringify(schema.default)}]`);
    }
}
