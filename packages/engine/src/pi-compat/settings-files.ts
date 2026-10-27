/** Exact file slots needed by the pinned SDK settings adapter; no filesystem implementation. */
export type EngineSettingsBody = (current: string | undefined) => string | undefined;
export interface EngineSettingsFiles {
  withOwnedFile(directory: string, name: string, body: EngineSettingsBody): void;
  withProjectSettings(agentDir: string, cwd: string, body: EngineSettingsBody): void;
  ensureThemes(agentDir: string): void;
}
