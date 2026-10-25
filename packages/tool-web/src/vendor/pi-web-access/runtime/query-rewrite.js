import { awaitWithAbort } from "./abortable.js";
import { findModelWithProviderRouting, isModelInScope } from "./summary-model-scope.js";
async function resolveFirstAvailableModel(ctx, candidates) {
    for (const { provider, id } of candidates) {
        const model = findModelWithProviderRouting(ctx.modelRegistry, provider, id);
        if (!model || !isModelInScope(model, ctx.scopedModels))
            continue;
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        if (auth.ok && auth.apiKey)
            return { model, apiKey: auth.apiKey, headers: auth.headers };
    }
    throw new Error(`No enabled model available: ${candidates.map(candidate => `${candidate.provider}/${candidate.id}`).join(", ")}`);
}
export async function rewriteSearchQuery(query, ctx, signal) {
    const { model, apiKey, headers } = await resolveFirstAvailableModel(ctx, [
        { provider: "anthropic", id: "claude-haiku-4-5" },
        { provider: "google", id: "gemini-3.6-flash" },
        { provider: "openai", id: "gpt-5-mini" },
    ]);
    const registry = ctx.modelRegistry;
    const usesRegistryComplete = typeof registry.complete === "function";
    if (signal.aborted)
        throw new Error("Aborted");
    const completeFn = usesRegistryComplete ? registry.complete.bind(registry) : (await awaitWithAbort(import("@earendil-works/pi-ai/compat"), signal)).complete;
    if (signal.aborted)
        throw new Error("Aborted");
    const response = await completeFn(model, {
        messages: [{
                role: "user",
                content: [{ type: "text", text: `Rewrite this web search query to get better, more specific results. Add relevant year qualifiers, precise technical terms, and specificity. Return ONLY the improved query text, nothing else.\n\nQuery: ${query}` }],
                timestamp: Date.now(),
            }],
    }, usesRegistryComplete ? { signal } : { apiKey, headers, signal });
    if (response.stopReason === "aborted")
        throw new Error("Aborted");
    const contentParts = Array.isArray(response.content) ? response.content : [];
    const text = contentParts
        .map((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? part.text : "")
        .join("")
        .trim();
    if (!text)
        throw new Error("Rewrite returned empty response");
    return text;
}
