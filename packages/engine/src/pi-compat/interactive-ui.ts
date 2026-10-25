/** Reassignments of Pi's public UI seam live with the pinned editor adapter.
 * Product callbacks supply policy; this owner installs and releases wrappers. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type Ui = ExtensionContext["ui"];
type Factory<K extends "setEditorComponent" | "setHeader" | "setFooter"> = Parameters<Ui[K]>[0];
export interface InteractiveUiAdapters {
  editor(factory: Factory<"setEditorComponent">): Factory<"setEditorComponent">;
  header(factory: Factory<"setHeader">): Factory<"setHeader">;
  footer(factory: Factory<"setFooter">): Factory<"setFooter">;
  notify(message: string, level: Parameters<Ui["notify"]>[1], upstream: Ui["notify"]): void;
}
export function adaptInteractiveUi(ui: Ui, adapters: InteractiveUiAdapters): () => void {
  const editor = ui.setEditorComponent, header = ui.setHeader, footer = ui.setFooter, notify = ui.notify;
  const ownedEditor: Ui["setEditorComponent"] = factory => editor.call(ui, adapters.editor(factory));
  const ownedHeader: Ui["setHeader"] = factory => header.call(ui, adapters.header(factory));
  const ownedFooter: Ui["setFooter"] = factory => footer.call(ui, adapters.footer(factory));
  const ownedNotify: Ui["notify"] = (message, level) => adapters.notify(message, level, notify.bind(ui));
  ui.setEditorComponent = ownedEditor; ui.setHeader = ownedHeader; ui.setFooter = ownedFooter; ui.notify = ownedNotify;
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    // A later adapter owns its own assignment; releasing this session may
    // only remove wrappers that this installation still owns.
    if (ui.setEditorComponent === ownedEditor) ui.setEditorComponent = editor;
    if (ui.setHeader === ownedHeader) ui.setHeader = header;
    if (ui.setFooter === ownedFooter) ui.setFooter = footer;
    if (ui.notify === ownedNotify) ui.notify = notify;
  };
}
