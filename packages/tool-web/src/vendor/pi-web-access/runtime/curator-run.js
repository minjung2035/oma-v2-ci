import { omaPermits } from "./utils.js";
export function resolveWebSearchWorkflow(input, hasUI) {
    // OMA divergence: the installed policy permits upstream curator
    // workflows. Without that permit, requests/config/curator state
    // cannot activate the model-completion and browser workflow.
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
