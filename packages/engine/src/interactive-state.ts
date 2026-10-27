import type { InteractiveMode, createAgentSessionRuntime } from '@earendil-works/pi-coding-agent';
import type { PiEvent } from './pi-rpc.js';
import type { InteractiveModeControl } from './pi-compat/interactive-mode.js';
export type InteractiveRuntime = Awaited<ReturnType<typeof createAgentSessionRuntime>>;
export interface InteractiveState {
    runtime: InteractiveRuntime | undefined;
    mode: InteractiveMode | undefined;
    controls: InteractiveModeControl | undefined;
}
export interface InteractiveOutput {
    send(event: PiEvent): void;
}
export interface InteractiveOutputs {
    ui: InteractiveOutput;
    rpc: InteractiveOutput;
}
