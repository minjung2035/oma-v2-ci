import { FramedPeer } from "./rpc.js";
import { platformFailure } from "@oma/protocol/host-errors";
import { requestProblem, type PlatformErrorCode } from "@oma/protocol/host-guest";

/** A result whose connection changes hands once it is answered: the function
 * runs right after the answer is written, before anything else is read, so
 * a peer that starts sending other bytes on reading the answer loses none. */
export const HANDOFF = Symbol("handoff");
export type Answer = Record<string, unknown> & { [HANDOFF]?: () => void };

/** Runs one JSON request at a time for a channel and answers it. A handler
 * that throws a StoreError is refused with that code; a refusal relayed from
 * the other side (a PlatformError) keeps its code and retry; anything else is
 * an internal error. The words of a refusal pass only when they say nothing
 * of Linux (MAC-231); otherwise the code alone speaks. */
export function serveRequests(peer: FramedPeer,
  handle: (method: string, params: Record<string, unknown>, key: string | undefined) => Promise<Answer>): void {
  let chain = Promise.resolve();
  peer.onFrame(frame => {
    chain = chain.then(async () => {
      const id = typeof frame.id === "string" ? frame.id : "x";
      const problem = requestProblem(frame);
      if (problem !== null) { safeRefuse(peer, id, "INVALID_REQUEST", problem); return; }
      try {
        const answer = await handle(frame.method as string, frame.params as Record<string, unknown>, frame.key as string | undefined);
        peer.answer(id, answer);
        answer[HANDOFF]?.();
      }
      catch (error) {
        const failure = platformFailure(error);
        safeRefuse(peer, id, failure.code, failure.message, failure.retry);
      }
    });
  });
}
function safeRefuse(peer: FramedPeer, id: string, code: PlatformErrorCode, message: string, retry: "never" | "same-key" | "after-repair" = "never"): void {
  try { peer.refuse(id, { code, message: message.slice(0, 1024), retry }); } catch { /* the connection is gone */ }
}
