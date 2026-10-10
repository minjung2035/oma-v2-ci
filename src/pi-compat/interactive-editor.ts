/** Keep Open TUI's editor and Pi's own commands; OMA decides only where a plain
 * prompt goes. A prompt becomes its own run in OMA's order, so a Human prompt
 * typed during a mail delivery is never folded into that delivery's run. */
import type { EditorComponent } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";

/** The shape of one of the editor's suggestions, as its provider gives it. */
export interface Suggestion { readonly value: string; readonly label: string; readonly description?: string }
interface SuggestionSource {
  getSuggestions(...args: never[]): Promise<{ items: Suggestion[]; prefix: string } | null>;
}

export interface EditorRoutingPorts {
  /** A plain prompt, handed to OMA's run order. */
  submit(text: string): void;
  /** Whether Pi's own editor handles this text: a built-in command or `!` shell. */
  isCommand(text: string): boolean;
  /** B2: `/thinking show` and `/thinking hide`, exactly -- OMA's visibility
   * set, claimed before built-in routing because the engine reads a
   * `/thinking` argument as a level name and would fail the pair. Anything
   * else stays the engine's, bare `/thinking` included. */
  thinkingVisibility?(text: string): boolean;
  /** Runs `text` if it names an extension's command, and says whether it did.
   * Pi's editor would leave such a command for a prompt loop oma does not run. */
  extensionCommand?(text: string): boolean;
  panel(): void;
  refuse(): void;
  /** A pasted image was offered; the text-only prompt cannot carry it, so the
   * Human is told rather than the paste vanishing. */
  pasteImage(): void;
  acceptsInput(text: string): boolean;
  /** What the editor may suggest, as oma presents it. */
  suggest?(items: readonly Suggestion[]): Suggestion[];
}

/** The engine's own suggestion source, answering through `suggest`. */
function presented<T extends SuggestionSource>(source: T, suggest: (items: readonly Suggestion[]) => Suggestion[]): T {
  return new Proxy(source, {
    get(object, name) {
      if (name === "getSuggestions") return async (...args: never[]) => {
        const found = await object.getSuggestions(...args);
        return found === null ? null : { ...found, items: suggest(found.items) };
      };
      const value: unknown = Reflect.get(object, name);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
}

export function ownedEditor(editor: EditorComponent, ports: EditorRoutingPorts): EditorComponent {
  let overflow = false;
  // Pi assigns its own submit handler after the factory returns. It keeps
  // every command and the `!` shell; only a plain prompt is routed to OMA.
  let upstream: ((text: string) => void) | undefined;
  const target = editor as EditorComponent & {
    actionHandlers?: Map<string, () => void>;
    onPasteImage?: () => void;
    addToHistory?: (text: string) => void;
  };
  const route = (text: string): void => {
    if (overflow) { target.setText(text); ports.refuse(); return; }
    if (!text.trim()) return;
    if (ports.thinkingVisibility?.(text)) { target.addToHistory?.(text); return; }
    if (ports.isCommand(text)) { upstream?.(text); return; }
    target.addToHistory?.(text);
    if (ports.extensionCommand?.(text)) return;
    ports.submit(text);
  };
  // The engine's session keys open oma's sessions, as its commands do.
  const sessionKeys: Readonly<Record<string, string>> = { "app.session.new": "/new", "app.session.resume": "/resume" };
  // Pi's follow-up key queues into the running turn; in OMA it is a prompt of its own.
  const actions = target.actionHandlers;
  if (actions) {
    const add = actions.set.bind(actions);
    actions.set = (name, action) => add(name, sessionKeys[name] !== undefined && ports.extensionCommand
      ? () => { ports.extensionCommand?.(sessionKeys[name]!); }
      : name === "app.message.followUp"
      ? () => {
        const text = (target.getExpandedText?.() ?? target.getText()).trim();
        target.setText("");
        route(text);
      }
      : action);
  }
  // A pasted image is not part of a text prompt OMA can order; the refusal is
  // said out loud, never a silent no-op.
  target.onPasteImage = () => ports.pasteImage();
  target.onSubmit = route;
  return new Proxy(target, {
    set(object, name, value) {
      if (name === "onSubmit") { upstream = value as (text: string) => void; return true; }
      if (name === "onPasteImage") return true;
      return Reflect.set(object, name, value);
    },
    get(object, name) {
      if (name === "handleInput") return (data: string) => {
        if (matchesKey(data, "ctrl+x")) { ports.panel(); return; }
        const before = object.getExpandedText?.() ?? object.getText();
        object.handleInput(data);
        const after = object.getExpandedText?.() ?? object.getText();
        if (!ports.acceptsInput(after)) {
          // setText clears upstream's paste-marker backing map, so restore
          // the expanded source, never a marker whose content would be lost.
          object.setText(before); overflow = true; ports.refuse();
        } else if (after !== before) overflow = false;
      };
      if (name === "setAutocompleteProvider" && ports.suggest) {
        const suggest = ports.suggest;
        return (source: SuggestionSource) => (object as { setAutocompleteProvider?(source: SuggestionSource): void })
          .setAutocompleteProvider?.(presented(source, suggest));
      }
      const value: unknown = Reflect.get(object, name);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
}
