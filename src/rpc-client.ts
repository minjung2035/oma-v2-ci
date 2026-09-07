// Pi RPC JSONL client (rpc.md): LF-delimited frames on the child's stdio.
// Buffers partial lines, parses events, and exposes send + observer hooks.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";

export interface PiEvent {
  type: string;
  id?: string;
  [k: string]: unknown;
}

export class PiRpcClient {
  private out = Buffer.alloc(0);
  private observers: Array<(e: PiEvent) => void> = [];
  readonly child: ChildProcessWithoutNullStreams;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.on("data", (d) => this.ingest(Buffer.from(d)));
  }

  onEvent(fn: (e: PiEvent) => void): void {
    this.observers.push(fn);
  }

  /** MUST [rpc.md]: one JSON object per line; split on LF only (readline is not compliant). */
  private ingest(chunk: Buffer): void {
    this.out = Buffer.concat([this.out, chunk]);
    let nl: number;
    while ((nl = this.out.indexOf(0x0a)) >= 0) {
      const line = this.out.subarray(0, nl).toString("utf8").replace(/\r$/, "");
      this.out = this.out.subarray(nl + 1);
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line) as PiEvent;
        if (typeof evt.type === "string") {
          for (const fn of this.observers) fn(evt);
        }
      } catch {
        // non-JSON progress lines (if any) are ignored; structured events matter
      }
    }
  }

  send(obj: Record<string, unknown>): void {
    this.child.stdin.write(JSON.stringify(obj) + "\n");
  }

  close(): void {
    try {
      this.child.stdin.end();
    } catch {
      /* already closed */
    }
  }
}

/** spawn the sandboxed Pi from a ready argv array (already contains bwrap ... -- pi). */
export function spawnSandboxed(
  argv: readonly string[],
  env: Record<string, string>,
): ChildProcessWithoutNullStreams {
  return spawn(argv[0]!, argv.slice(1), {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
}
