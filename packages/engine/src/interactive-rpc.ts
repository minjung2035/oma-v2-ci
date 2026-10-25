import { Socket } from 'node:net';
import { InteractiveChannel, INTERACTIVE_RPC_FD } from './interactive-channel.js';
import { rpcPromptOptions } from './interactive-commands.js';
import type { InteractiveView } from './interactive-view.js';
import type { InteractiveState } from './interactive-state.js';
import type { PiRpcLimits } from './pi-rpc.js';
export function createInteractiveRpc(view: InteractiveView, state: InteractiveState, limits: PiRpcLimits, die: () => void) {
    const rpc = new InteractiveChannel(new Socket({
        fd: INTERACTIVE_RPC_FD, readable: true, writable: true
    }), limits, event => {
        if (!view.ready) {
            rpc.send({
                type: "response", id: event.id ?? "", command: "prompt", success: false, error: "interactive UI is not ready"
            });
            return;
        }
        if (event.type !== "prompt" || typeof event.message !== "string" || typeof event.id !== "string") {
            die();
            return;
        }
        let accepted = false;
        if (!state.runtime) {
            die();
            return;
        }
        void state.runtime.session.prompt(event.message, {
            ...rpcPromptOptions(event.message),
            preflightResult: disposition => {
                // 1.0.1: the callback fires once, only on acceptance, carrying how the
                // accepted prompt was dispatched -- the same shape the engine's own
                // RPC mode answers with (`data.disposition`). Rejection is the prompt
                // promise rejecting, so every disposition is a success here.
                accepted = true;
                rpc.send({
                    type: "response", id: event.id!, command: "prompt", success: true, data: {
                        disposition
                    }
                });
            },
        }).catch(error => {
            if (!accepted)
                rpc.send({
                    type: "response", id: event.id!, command: "prompt", success: false, error: String(error)
                });
            else
                view.context?.ui.notify(String(error), "error");
        });
    }, die);
    return rpc;
}
