import type { createAgentSessionRuntime, InteractiveMode, ExtensionContext } from "@earendil-works/pi-coding-agent";
export type PersonalRuntime = Awaited<ReturnType<typeof createAgentSessionRuntime>>;
/** One Personal UI lifetime; every deferred selection belongs to its epoch. */
export class PersonalSessionState {
  runtime: PersonalRuntime | undefined;
  mode: InteractiveMode | undefined;
  context: ExtensionContext | undefined;
  switching = false;
  replacing = false;
  private generation = 0;
  get epoch(): number { return this.generation; }
  current(epoch: number): boolean { return !this.switching && this.context !== undefined && epoch === this.generation; }
  enter(context: ExtensionContext): void { this.generation++; this.context = context; }
  leave(): void { this.generation++; this.context = undefined; }
}
