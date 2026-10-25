import { Type } from "typebox";
export declare const editToolSchema: Type.TObject<{
    remove_from: Type.TString;
    remove_to: Type.TString;
    replacement_lines: Type.TString;
}>;
export declare function buildEditToolSchema(requirePath: boolean): typeof editToolSchema;
export type ReqParams = {
    path?: string;
    remove_from: string;
    remove_to: string;
    replacement_lines: string;
};
export type RawReqParams = {
    path?: string;
    remove_from: string;
    remove_to: string;
    replacement_lines: string | string[];
};
export declare function assertReq(request: unknown): asserts request is ReqParams;
export { normalizeRequest as normReq } from "./utils.js";
export declare function getPreviewInput(args: unknown): {
    path?: string;
    remove_from: string;
    remove_to: string;
    replacement_lines: string;
} | null;
export interface InsertReq {
    path?: string;
    anchor: string;
    direction: "before" | "after";
    lines: string;
}
export declare function assertInsertReq(request: unknown): asserts request is InsertReq;
export interface TransferReq {
    path?: string;
    source_from: string;
    source_to: string;
    insert_after: string;
}
export declare function assertTransferReq(request: unknown): asserts request is TransferReq;
export interface ReplaceWithinReq {
    path?: string;
    replace_from: string;
    replace_to: string;
    replace_old: string;
    replace_new: string;
}
export declare function assertReplaceWithinReq(request: unknown): asserts request is ReplaceWithinReq;
export declare function normalizeReplaceWithinRequest(input: unknown): unknown;
export declare function getReplaceWithinInput(args: unknown): {
    path?: string;
    replace_from: string;
    replace_to: string;
    replace_old: string;
    replace_new: string;
} | null;
export declare const replaceWithinToolSchema: Type.TObject<{
    replace_from: Type.TString;
    replace_to: Type.TString;
    replace_old: Type.TString;
    replace_new: Type.TString;
}>;
export declare function buildReplaceWithinToolSchema(requirePath: boolean): typeof replaceWithinToolSchema;
