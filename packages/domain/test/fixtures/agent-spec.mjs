import { CAPABILITIES } from "@oma/domain/capabilities";
import { resolvedSpecCheck } from "@oma/domain/durable";
export const ALL_CAPS = CAPABILITIES;
export function makeValidResolvedSpec(name = "alice", profile = "p", capabilities = ALL_CAPS, from = "0000000000000000000000000000000000000000", brief = "test") {
    const spec = {
        name, modelProfile: "md", from, brief, profile,
        capabilities: [...capabilities],
    };
    const invalid = resolvedSpecCheck(spec);
    if (invalid)
        throw new Error(`invalid normal resolved-spec fixture: ${invalid}`);
    return spec;
}
export function resolvedSpec(capabilities, profile, name) {
    return JSON.stringify(makeValidResolvedSpec(name, profile, capabilities));
}
