/** Transient physical ports; no journal, authority or Actor policy. */
import type { ProcessObservation } from "./command.js";
/** A transient physical child observation, independently owned by its caller.
 * This contains no Actor identity, role, accepted plan or durable receipt. */
export interface ExecutionProcessPin {
  readonly pid: number; readonly uid: number; readonly gid: number;
  alive(): boolean;
  /** Optional genuine kernel membership observation, never role authority. */
  inScope?(identity: unknown): boolean;
  close(): void;
}
export interface BlockedExecution<Witness> {
  readonly pinChild?: () => ExecutionProcessPin;
  readonly witness: Witness;
  /** Trusted setup may continue after the kernel witness is published. No
   * arbitrary workload is released until this and a fresh authority check. */
  readonly prepared?: Promise<void>;
  /** Leader or supervisor termination before capture/FD drain. This requests
   * settlement; it never proves the scope empty or its resources returned. */
  readonly terminal?: Promise<void>;
  readonly result: Promise<ProcessObservation>;
  readonly closed: Promise<void>;
  population(): "populated" | "empty" | "unknown";
  release(): void;
  terminate(): void;
  close(): void;
}
export interface RecoveryScope<Witness> {
  readonly identity: Witness;
  population(): "populated" | "empty" | "unknown";
  terminate(): void;
  close(): void;
}
