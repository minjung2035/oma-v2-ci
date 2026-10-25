import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type ReplaceDetails } from "./replace.js";
import { type NormFile } from "./file-reader.js";
import { type Anchor } from "./hashline/index.js";
import { type ReplaceWithinReq } from "./payload-contract.js";
import { type EditToolFlags } from "./edit-common.js";
import { type RPreview, type RRState } from "./replace-render.js";
interface WithinRefs {
    from: Anchor;
    to: Anchor;
}
export interface WithinPlan {
    editParams: {
        remove_from: string;
        remove_to: string;
        replacement_lines: string;
    };
}
export declare function parseWithinAnchors(req: ReplaceWithinReq): {
    refs: WithinRefs;
    warnings: string[];
};
export declare function buildReplaceWithinEdit(req: ReplaceWithinReq, refs: WithinRefs, preload: NormFile, displayPath: string): WithinPlan;
export declare function replaceWithinPreview(request: unknown, cwd: string, signal?: AbortSignal): Promise<RPreview>;
type ReplaceWithinToolDef = ToolDefinition<any, ReplaceDetails, RRState> & {
    renderShell?: "default" | "self";
};
export declare function buildReplaceWithinToolDef(flags?: EditToolFlags): ReplaceWithinToolDef;
export declare function regReplaceWithin(pi: ExtensionAPI, flags?: EditToolFlags): void;
export {};
