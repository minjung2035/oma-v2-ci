export declare function commandExists(command: string, cwd?: string, pathValue?: string): boolean;
export declare function commandPathValue(env: Record<string, string> | undefined, platform?: NodeJS.Platform): string;
export declare function mergeEnvironment(overrides: Record<string, string> | undefined, platform?: NodeJS.Platform): NodeJS.ProcessEnv;
export declare function resolveCommandPath(command: string, cwd?: string, platform?: NodeJS.Platform, pathValue?: string): string | undefined;
