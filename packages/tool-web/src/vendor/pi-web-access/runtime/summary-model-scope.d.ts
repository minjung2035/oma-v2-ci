export type SummaryThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface ModelLike {
    provider: string;
    id: string;
}
export interface ModelRegistryLike<T extends ModelLike = ModelLike> {
    find(provider: string, id: string): T | undefined;
    getAvailable(): readonly T[];
}
/**
 * Resolve a model through its native provider or a provider that routes that model ID.
 *
 * The direct registry fallback preserves explicit/native model resolution when a
 * provider's availability snapshot does not include the configured model. Callers
 * continue to apply their existing enabled-model and authentication checks.
 */
export declare function findModelWithProviderRouting<T extends ModelLike>(registry: ModelRegistryLike<T>, provider: string, id: string): T | undefined;
/**
 * Pi resolves `--models` and `enabledModels` against the available catalogue and exposes the
 * result as `ctx.scopedModels`; an empty scope means every available model is allowed.
 */
export declare function isModelInScope(model: ModelLike, scopedModels: ReadonlyArray<{
    model: ModelLike;
}>): boolean;
export declare function splitThinkingSuffix(value: string): {
    value: string;
    thinkingLevel?: SummaryThinkingLevel;
};
