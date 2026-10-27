/**
 * Once per adapter version, adds `-builtin:mcp` to Pi's user `extensions` unless it already has a
 * `builtin:mcp` entry, such as `pi config`'s `+builtin:mcp`. Returns whether it wrote. Throws on a
 * settings read or write error without recording the version, so the next start retries.
 */
export declare function turnOffPiBuiltinMcp(): Promise<boolean>;
