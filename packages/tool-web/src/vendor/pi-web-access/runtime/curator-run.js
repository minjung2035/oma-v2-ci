import { omaPermits } from "./utils.js";
export function resolveWebSearchWorkflow(input, hasUI) {
    // OMA divergence: the curator workflows are a model-completion and
    // browser surface OMA does not expose. Deny-by-default: no request
    // value, config default or curator state resolves to anything but
    // "none" under OMA.
    if (!omaPermits("workflows"))
        return "none";
    const normalized = typeof input === "string" ? input.trim().toLowerCase() : "";
    if (normalized === "auto-summary")
        return "auto-summary";
    if (!hasUI)
        return "none";
    if (normalized === "none")
        return "none";
    if (normalized === "summary-review")
        return "summary-review";
    return "none";
}
export class CuratorRunState {
    autoApproveRemaining = false;
    approveRemainingSearches() {
        this.autoApproveRemaining = true;
    }
    reset() {
        this.autoApproveRemaining = false;
    }
    resolve(requestedWorkflow, configuredWorkflow, hasUI) {
        const inherited = requestedWorkflow === undefined;
        const workflow = resolveWebSearchWorkflow(inherited ? configuredWorkflow : requestedWorkflow, hasUI);
        return inherited && this.autoApproveRemaining && workflow === "summary-review"
            ? "auto-summary"
            : workflow;
    }
}
export function registerCuratorRunLifecycle(pi) {
    const state = new CuratorRunState();
    pi.on("before_agent_start", () => state.reset());
    pi.on("agent_settled", () => state.reset());
    pi.on("session_start", () => state.reset());
    pi.on("session_tree", () => state.reset());
    pi.on("session_shutdown", () => state.reset());
    return state;
}
