import type { ServerEntry } from "./types.js";
declare const LITERAL_PLUGIN_FIELDS: readonly ["args", "env", "cwd", "headers"];
type LiteralPluginField = typeof LITERAL_PLUGIN_FIELDS[number];
/** @internal */
export declare function markBuiltInAgentPlugin(definition: ServerEntry, fields: LiteralPluginField[]): ServerEntry;
/** @internal */
export declare function isBuiltInAgentPlugin(definition: ServerEntry, field: LiteralPluginField): boolean;
/** @internal */
export declare function cloneBuiltInAgentPluginEntry(source: ServerEntry): ServerEntry | undefined;
/** @internal */
export declare function mergeBuiltInAgentPluginEntries(base: ServerEntry, next: ServerEntry): ServerEntry;
export {};
