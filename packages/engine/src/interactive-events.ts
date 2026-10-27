import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { PiEvent } from './pi-rpc.js';
import type { InteractiveOutput } from './interactive-state.js';
export function createInteractiveEvents(rpc: InteractiveOutput) {
    let session: AgentSession | undefined;
    let unsubscribe: (() => void) | undefined;
    // Pi replaces the session object on /new, /resume and /fork; the run
    // evidence OMA reads follows whichever session is current.
    const follow = (current: AgentSession): void => {
        if (current === session)
            return;
        unsubscribe?.();
        session = current;
        unsubscribe = current.subscribe(event => {
            if (event.type === "message_end" && event.message.role === "assistant")
                rpc.send({
                    type: "message_end", message: {
                        role: "assistant", stopReason: event.message.stopReason
                    }
                });
            else if (event.type === "agent_settled" || event.type === "auto_retry_start" || event.type === "auto_retry_end")
                rpc.send(event as unknown as PiEvent);
        });
    };
    return {
        follow
    };
}
