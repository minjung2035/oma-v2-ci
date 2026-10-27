import { fork } from "node:child_process";

/** Only a direct child owned by this invocation is signalled. If termination
 * cannot be confirmed, preserve its fixture root instead of cleaning underneath
 * a potentially living process. This is not descendant/cgroup death evidence. */
export class CheckpointFailure extends Error {
  constructor(
    message: string,
    readonly terminationConfirmed: boolean,
  ) {
    super(message);
    this.name = "CheckpointFailure";
  }
}

export function killAtCheckpoint(
  worker: URL,
  args: readonly string[],
  point: string,
  timeoutMs = 10000,
): Promise<{ point: string; pid: number; signal: "SIGKILL" }> {
  if (
    !point ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30000
  )
    return Promise.reject(
      new CheckpointFailure("invalid checkpoint or deadline", true),
    );
  return new Promise((resolve, reject) => {
    const child = fork(worker, [...args], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let reached = false;
    let failure: string | undefined;
    let stderr = "";
    let stderrBytes = 0;
    let finished = false;
    let reapTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: CheckpointFailure) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(reapTimer);
      if (error) reject(error);
      else resolve({ point, pid: child.pid!, signal: "SIGKILL" });
    };
    const kill = () => {
      child.kill("SIGKILL");
      reapTimer ??= setTimeout(() => {
        if (child.connected) child.disconnect();
        child.stderr?.destroy();
        child.unref();
        finish(
          new CheckpointFailure(
            `termination unconfirmed at ${point}; preserve fixture root`,
            false,
          ),
        );
      }, 2000);
    };
    const fail = (reason: string) => {
      failure ??= reason;
      kill();
    };
    const deadline = setTimeout(
      () => fail(`checkpoint timeout: ${point}`),
      timeoutMs,
    );
    child.stderr!.on("data", (bytes: Buffer) => {
      stderrBytes += bytes.length;
      if (stderrBytes > 32768) fail("checkpoint stderr limit exceeded");
      else stderr += bytes.toString("utf8");
    });
    child.once("error", (error) =>
      fail(`checkpoint child error: ${error.message}`),
    );
    child.on("message", (message) => {
      if (reached) {
        fail("duplicate checkpoint message");
        return;
      }
      if (
        message === null ||
        typeof message !== "object" ||
        !("point" in message) ||
        message.point !== point
      ) {
        fail(`wrong checkpoint: expected ${point}`);
        return;
      }
      reached = true;
      kill();
    });
    child.once("close", (code, signal) => {
      if (
        failure ||
        !reached ||
        signal !== "SIGKILL" ||
        child.pid === undefined
      ) {
        finish(
          new CheckpointFailure(
            `${failure ?? "checkpoint not reached"}: ${point}; exit=${code}/${signal}; ${stderr}`,
            true,
          ),
        );
      } else finish();
    });
  });
}
