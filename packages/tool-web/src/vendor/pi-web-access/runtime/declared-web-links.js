const MAX_DECLARED_LINKS = 20;
const MAX_DECLARED_URL_LENGTH = 4096;
const DECLARATION_RELATIONS = new Set([
    "api-catalog",
    "describedby",
    "service-desc",
    "service-doc",
    "service-meta",
]);
const RELATION_LABELS = {
    "api-catalog": "API catalog",
    "describedby": "Description",
    "service-desc": "Service description",
    "service-doc": "Service documentation",
    "service-meta": "Service metadata",
};
export function discoverDeclaredWebLinks(document, linkHeader, responseUrl) {
    const links = new Map();
    for (const value of splitLinkHeader(linkHeader ?? "")) {
        const target = /^\s*<([^>]*)>/.exec(value);
        if (!target)
            continue;
        const parameters = parseLinkParameters(value.slice(target[0].length));
        if (!parameters || parameters.has("anchor"))
            continue;
        addDeclaredLink(links, {
            url: resolveHttpUrl(target[1], responseUrl),
            relations: declaredRelations(parameters.get("rel")),
            type: parameters.get("type"),
        });
        if (links.size >= MAX_DECLARED_LINKS)
            break;
    }
    if (links.size < MAX_DECLARED_LINKS) {
        const declaredBase = document.querySelector("base[href]")?.getAttribute("href");
        const documentBase = resolveHttpUrl(declaredBase, responseUrl) ?? responseUrl;
        for (const element of document.querySelectorAll("link[rel][href], a[rel][href]")) {
            addDeclaredLink(links, {
                url: resolveHttpUrl(element.getAttribute("href"), documentBase),
                relations: declaredRelations(element.getAttribute("rel")),
                type: element.getAttribute("type"),
            });
            if (links.size >= MAX_DECLARED_LINKS)
                break;
        }
    }
    return [...links.values()];
}
export function appendDeclaredWebLinks(content, links) {
    if (links.length === 0)
        return content;
    const section = [
        "## Declared links",
        "",
        ...links.map(formatDeclaredLink),
    ].join("\n");
    return content.trim() ? `${content.trim()}\n\n${section}` : section;
}
function addDeclaredLink(links, candidate) {
    if (!candidate.url || candidate.relations.length === 0)
        return;
    const existing = links.get(candidate.url);
    if (existing) {
        for (const relation of candidate.relations) {
            if (!existing.relations.includes(relation))
                existing.relations.push(relation);
        }
        if (!existing.type)
            existing.type = normalizeMetadata(candidate.type);
        return;
    }
    if (links.size >= MAX_DECLARED_LINKS)
        return;
    const type = normalizeMetadata(candidate.type);
    links.set(candidate.url, {
        url: candidate.url,
        relations: candidate.relations,
        ...(type ? { type } : {}),
    });
}
function declaredRelations(value) {
    if (!value)
        return [];
    return [...new Set(value.trim().toLowerCase().split(/\s+/).filter((relation) => DECLARATION_RELATIONS.has(relation)))];
}
function resolveHttpUrl(value, baseUrl) {
    if (!value || value.length > MAX_DECLARED_URL_LENGTH)
        return null;
    try {
        const url = new URL(value, baseUrl);
        if (url.href.length > MAX_DECLARED_URL_LENGTH)
            return null;
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    }
    catch {
        return null;
    }
}
function splitOutsideSyntax(input, separator, protectTargets) {
    const parts = [];
    let start = 0;
    let inTarget = false;
    let inQuotes = false;
    let escaped = false;
    for (let index = 0; index < input.length; index++) {
        const character = input[index];
        if (inQuotes) {
            if (escaped)
                escaped = false;
            else if (character === "\\")
                escaped = true;
            else if (character === '"')
                inQuotes = false;
            continue;
        }
        if (character === '"' && !inTarget)
            inQuotes = true;
        else if (protectTargets && character === "<")
            inTarget = true;
        else if (protectTargets && character === ">")
            inTarget = false;
        else if (character === separator && !inTarget) {
            parts.push(input.slice(start, index));
            start = index + 1;
        }
    }
    if (inQuotes || inTarget)
        return null;
    parts.push(input.slice(start));
    return parts;
}
function splitLinkHeader(header) {
    return (splitOutsideSyntax(header, ",", true) ?? [])
        .map((value) => value.trim())
        .filter(Boolean);
}
function parseLinkParameters(input) {
    const parts = splitOutsideSyntax(input, ";", false);
    if (!parts || parts.shift()?.trim())
        return null;
    const parameters = new Map();
    for (const part of parts) {
        const match = /^\s*([!#$%&'*+\-.^_`|~A-Za-z0-9]+)(?:\s*=\s*(?:"((?:\\.|[^"])*)"|(\S+)))?\s*$/.exec(part);
        if (!match)
            return null;
        const name = match[1].toLowerCase();
        const value = match[2] === undefined ? (match[3] ?? "") : match[2].replace(/\\(.)/g, "$1");
        if (!parameters.has(name))
            parameters.set(name, value);
    }
    return parameters;
}
function normalizeMetadata(value) {
    if (!value)
        return undefined;
    const normalized = value.replace(/\s+/g, " ").trim().slice(0, 160);
    return normalized || undefined;
}
function formatDeclaredLink(link) {
    const relation = link.relations.map(inlineCode).join(", ");
    const type = link.type ? `; ${inlineCode(link.type)}` : "";
    const label = RELATION_LABELS[link.relations[0]] ?? "Declared link";
    return `- ${label} (${relation}${type}): <${link.url}>`;
}
function inlineCode(value) {
    return `\`${value.replace(/`/g, "'")}\``;
}
