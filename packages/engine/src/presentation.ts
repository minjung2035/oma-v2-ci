/** Consumer-owned presentation seam. The application supplies the actual TUI renderers. */
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
export interface CompactPresentation {
  readonly resolver: Parameters<ExtensionAPI["registerToolRenderer"]>[0];
  agentStarted(): void; agentEnded(): void;
  toolStarted(id: string): void; toolEnded(id: string): void;
  bindRender(request: (() => void) | undefined): void;
  reset(clearTimings: boolean): void;
}
export interface EnginePresentation {
  stylePanel(lines: readonly string[], theme: Theme): string[];
  registerQuestions(pi: ExtensionAPI, deps: { context(): ExtensionContext | undefined }): void;
  createCompactTools(): CompactPresentation;
}
