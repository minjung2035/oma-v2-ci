/** Commands and termination observations connecting Host, Guest and Society lifetimes.
 * Ready endpoints and stop requests are not process-death evidence.
 */
import type { Socket } from "node:net";

export interface GuestPorts { connect(port: number, deadlineMs?: number): Promise<Socket> }
export type VmStopCause = "guest" | "error";
export interface VmDriver extends GuestPorts {
  /** Running VM; guest handshake is a separate observation. */
  start(): Promise<void>;
  /** Resolves only after the VM has stopped, including a start in progress. */
  forceStop(): Promise<void>;
  onStopped(listener: (cause: VmStopCause) => void): void;
}
export interface SessionLauncher {
  /** Resolves once the holder accepts connections at socketPath(society). */
  start(society: string, projectDir: string, resume?: string): Promise<void>;
  /** Unknown preserves an incomplete termination observation. */
  stop(society: string, deadlineMs: number): Promise<"stopped" | "unknown">;
  socketPath(society: string): string;
}
