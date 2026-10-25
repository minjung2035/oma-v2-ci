/** OMA prompt policy over the pinned Pi editor adaptation. */
import type { EditorComponent } from "@earendil-works/pi-tui";
import { ownedEditor as adaptEditor, type EditorRoutingPorts } from "./interactive-editor.js";
import { humanPromptFitsFrame } from "@oma/domain/surface-bounds";
export type { Suggestion } from "./interactive-editor.js";

export interface InteractiveEditorPorts extends Omit<EditorRoutingPorts, "acceptsInput"> {
  frameBytes: number;
}
export function ownedEditor(editor: EditorComponent, ports: InteractiveEditorPorts): EditorComponent {
  return adaptEditor(editor, { ...ports, acceptsInput: text => humanPromptFitsFrame(text, ports.frameBytes) });
}
