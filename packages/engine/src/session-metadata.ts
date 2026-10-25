/** Public SDK session discovery; OMA birth/authority validation remains with its caller. */
import { SessionManager } from "@earendil-works/pi-coding-agent";
export type { SessionInfo } from "@earendil-works/pi-coding-agent";
export function listEngineSessions(directory: string): ReturnType<typeof SessionManager.listAll> {
  return SessionManager.listAll(directory);
}
