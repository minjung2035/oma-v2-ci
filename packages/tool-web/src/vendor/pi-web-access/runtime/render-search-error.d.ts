/**
 * Pure, dependency-free renderer for web_search error / cancel results.
 *
 * WHY THIS EXISTS: the upstream web_search `renderResult` (index.ts) early-returns
 * a SINGLE line on the error/cancel path, before the collapsed/expanded branch.
 * That makes Ctrl+O (app.tools.expand) flip `expanded` with zero visible effect —
 * a dead-end with no diagnostics. It also discards the partial search results
 * gathered before the cancel, so even an expandable view would have nothing to show.
 *
 * This module is the single source of truth for the error/cancel render PLAN
 * (plain strings, no theme/ANSI), so it is unit-testable without pi's runtime
 * (@mariozechner/pi-tui Text/Box). index.ts.renderResult delegates to it and only
 * applies theme colors + creates Text/Box components.
 *
 * Contract for callers:
 *   const plan = buildSearchErrorPlan(details);
 *   if (plan === null) ... // not an error/cancel result; use the normal renderer
 *   // collapsed: [statusLine, ...plan.collapsed, plan.expandHint].filter(Boolean)
 *   // expanded:  plan.expanded
 */
export interface CancelledQueryDetail {
    query: string;
    provider: string | null;
    error: string | null;
    resultCount: number;
}
export interface SearchErrorDetails {
    /** The headline error/cancel message, e.g. "Search curation cancelled (stale)." */
    error?: string;
    cancelled?: boolean;
    cancelReason?: string;
    /** Did the curator browser page ever establish a connection? */
    browserConnected?: boolean;
    /** Age (ms) of the last curator heartbeat at cancel time, if known. */
    lastHeartbeatAgeMs?: number | null;
    /** Total queries the user requested. */
    queryCount?: number;
    /** Partial per-query results gathered before the cancel/error. */
    cancelledQueries?: CancelledQueryDetail[];
    /** Arbitrary extra diagnostic lines (e.g. URLs, response id) for non-cancel errors
     * like fetch_content / get_search_content. Shown in the expanded view. */
    extraLines?: string[];
}
export interface SearchErrorPlan {
    /** Full diagnostic block, shown when expanded (Ctrl+O). */
    expanded: string[];
    /** Short preview lines, shown under the headline when collapsed. */
    collapsed: string[];
    /** The "... (N more lines, ctrl+o to expand)" hint, or null if nothing is hidden. */
    expandHint: string | null;
}
/**
 * Build the error/cancel render plan. Returns null when `details` carries no
 * error/cancel signal (so the caller falls through to the normal success renderer).
 */
export declare function buildSearchErrorPlan(details: SearchErrorDetails | undefined | null): SearchErrorPlan | null;
