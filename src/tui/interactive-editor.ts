/** OMA prompt policy over the pinned Pi editor adaptation. */
import type { EditorComponent } from "@earendil-works/pi-tui";
import { ownedEditor as adaptEditor, type EditorRoutingPorts } from "../pi-compat/interactive-editor.js";
import { humanPromptFitsFrame } from "./limits.js";
export type { Suggestion } from "../pi-compat/interactive-editor.js";

export interface InteractiveEditorPorts extends Omit<EditorRoutingPorts, "acceptsInput"> {
  frameBytes: number;
}
export function ownedEditor(editor: EditorComponent, ports: InteractiveEditorPorts): EditorComponent {
  return adaptEditor(editor, { ...ports, acceptsInput: text => humanPromptFitsFrame(text, ports.frameBytes) });
}
