const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
/**
 * Resolve a model through its native provider or a provider that routes that model ID.
 *
 * The direct registry fallback preserves explicit/native model resolution when a
 * provider's availability snapshot does not include the configured model. Callers
 * continue to apply their existing enabled-model and authentication checks.
 */
export function findModelWithProviderRouting(registry, provider, id) {
    const available = registry.getAvailable();
    const direct = available.find(model => model.provider === provider && model.id === id);
    if (direct)
        return direct;
    const routedId = `${provider}/${id}`;
    // If multiple routers expose the same model ID, Pi's available-model ordering
    // determines which route is selected. An explicit provider/model selector can
    // select a specific route when that distinction matters.
    const routed = available.find(model => model.id === routedId);
    return routed ?? registry.find(provider, id);
}
/**
 * Pi resolves `--models` and `enabledModels` against the available catalogue and exposes the
 * result as `ctx.scopedModels`; an empty scope means every available model is allowed.
 */
export function isModelInScope(model, scopedModels) {
    return scopedModels.length === 0 || scopedModels.some(scoped => scoped.model.provider === model.provider && scoped.model.id === model.id);
}
export function splitThinkingSuffix(value) {
    const index = value.lastIndexOf(":");
    if (index < 0)
        return { value };
    const suffix = value.slice(index + 1);
    return THINKING_LEVELS.has(suffix)
        ? { value: value.slice(0, index), thinkingLevel: suffix }
        : { value };
}
