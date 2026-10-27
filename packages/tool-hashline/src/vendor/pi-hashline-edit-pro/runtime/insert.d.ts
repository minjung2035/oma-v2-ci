import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type ReplaceDetails } from "./replace.js";
import { type NormFile } from "./file-reader.js";
import { type Anchor, type HTEdit } from "./hashline/index.js";
import type { LineEnding } from "./normalize.js";
import { assertInsertReq, type InsertReq } from "./payload-contract.js";
import { type EditToolFlags } from "./edit-common.js";
import type { RPreview, RRState } from "./replace-render.js";
export { assertInsertReq, type InsertReq };
declare const insertToolSchema: Type.TObject<{
    anchor: Type.TString;
    direction: Type.TUnion<[Type.TLiteral<"after">, Type.TLiteral<"before">]>;
    lines: Type.TString;
}>;
export declare function buildInsertToolSchema(requirePath: boolean): typeof insertToolSchema;
export declare function parseInsertAnchor(raw: string): {
    ref: Anchor;
    warnings: string[];
};
export declare function buildInsertEdit(req: InsertReq, preload: NormFile, ref: Anchor, path: string): {
    editParams: HTEdit;
    anchorLine: string | undefined;
    contentSeparators: (LineEnding | undefined)[];
};
export declare function insertPreview(request: unknown, cwd: string, signal?: AbortSignal): Promise<RPreview>;
type InsertToolDef = ToolDefinition<any, ReplaceDetails, RRState> & {
    renderShell?: "default" | "self";
};
export declare function buildInsertToolDef(flags?: EditToolFlags): InsertToolDef;
export declare function regInsert(pi: ExtensionAPI, flags?: EditToolFlags): void;
