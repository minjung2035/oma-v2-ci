import { existsSync } from "node:fs";
import type { PublicMethod, PublicMethods } from "@oma/contracts";
import { currentContext } from "./context.js";
import { ClientError, fail } from "./errors.js";
import { frameBytes } from "./settings.js";
import { runtime, type GrantProvider, type Reply } from "./runtime.js";

export function socketPath(): string {
  const env = currentContext().env;
  if (env.OMA_SOCKET) return env.OMA_SOCKET;
  if (existsSync("/run/oma/control.sock")) return "/run/oma/control.sock";
  if (env.OMA_ACTOR && env.OMA_SOCIETY)
    return `/run/user/${process.getuid?.() ?? -1}/oma/${env.OMA_SOCIETY}/actors/${env.OMA_ACTOR}/control.sock`;
  return fail("no broker socket (set OMA_SOCKET, or run inside the OMA sandbox)", 4);
}
export class Transport {
  constructor(private readonly grant: GrantProvider = () => null) {}
  private async frame(path: string, method: PublicMethod, params: Record<string, unknown>, request: string | undefined,
    streamBytes: Uint8Array | undefined, deadline: number): Promise<Reply[]> {
    const policy = runtime();
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new ClientError("broker did not answer before the client deadline", 3, request, undefined, false, "BROKER_UNAVAILABLE");
    const bytes = frameBytes();
    const grant = this.grant();
    const channel = policy.channel({ frameBytes: bytes, idleStreamSeconds: policy.observationSeconds, receiptWaitSeconds: policy.observationSeconds });
    const stopped = () => channel.close(new ClientError("broker observation stopped; outcome unknown", 3, request, undefined, false, "BROKER_UNAVAILABLE"));
    const signal = currentContext().signal;
    const timer = setTimeout(stopped, remaining);
    try {
      if (signal?.aborted) throw new ClientError("broker observation stopped; outcome unknown", 3, request, undefined, false, "BROKER_UNAVAILABLE");
      signal?.addEventListener("abort", stopped, { once: true });
      await channel.connect(path);
      if (grant !== null) {
        const attached = await channel.call("principal.attach", { sessionHandle: grant.sessionHandle, credential: grant.credential });
        if (!attached.ok) throw new ClientError(policy.failureText(attached.error), policy.failureExit(attached.error), request);
      }
      return [await channel.call(method, params, { ...(request === undefined ? {} : { request }),
        ...(streamBytes === undefined ? {} : { streamBytes }) })];
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", stopped); channel.close(); }
  }
  async callActor(path: string, method: PublicMethod, params: Record<string, unknown>, request?: string, streamBytes?: Uint8Array): Promise<Reply[]> {
    const policy = runtime();
    const deadline = performance.now() + policy.observationSeconds * 1000;
    const replies = await this.frame(path, method, params, request, streamBytes, deadline);
    const first = replies[0];
    const key = method === "operation.get" ? params.key : policy.mutation(method) ? request : undefined;
    if (first?.ok !== false || first.error.code !== "FRAME_TOO_LARGE" || typeof key !== "string") return replies;
    const receipt = await policy.collectReceipt(key, policy.maximumReceiptBytes, async part => {
      // IPC-006: a chunk that lands is progress, so each operation.read gets
      // its own whole observation window -- a receipt that legitimately takes
      // many chunks over a slow link completes, and only a broker that stops
      // answering is timed out.
      const reply = (await this.frame(path, "operation.read", part, undefined, undefined,
        performance.now() + policy.observationSeconds * 1000))[0];
      if (!reply?.ok) throw new ClientError(reply?.error.message ?? "receipt chunk missing", 3, key, undefined, false,
        reply?.ok === false ? reply.error.code : "BROKER_UNAVAILABLE");
      return reply.result as PublicMethods["operation.read"]["result"];
    });
    return [{ ok: true, result: receipt }];
  }
  call(method: PublicMethod, params: Record<string, unknown>, request?: string, streamBytes?: Uint8Array): Promise<Reply[]> {
    return this.callActor(socketPath(), method, params, request, streamBytes);
  }
}
