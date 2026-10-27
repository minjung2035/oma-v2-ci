/** Untrusted text is cleaned before upstream adds its own terminal styling.
 * These copies belong only to renderers: tool execution, history and receipts
 * keep their original bytes. No recursive walk on provider-controlled depth.
 *
 * The engine's `getRegisteredToolDefinition` is the one lookup every render
 * component uses, and it already merges Pi's built-in renderers over what an
 * extension did not declare: this wraps that resolved definition. A renderer
 * -- the extension's own or the built-in one Pi merged -- gets sanitized
 * copies of args and result; execution keeps the original objects and Pi's
 * registry keeps the definitions it loaded. Only a tool with no renderer at
 * all meets the fallback here: Pi's own component fallback cannot strip the
 * invisible-unicode class OMA's policy covers, so it cannot be the answer
 * for untrusted bytes. */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { UNSEEN_EXCEPT_LAYOUT } from "@oma/domain/unseen-text";

export function displayCopy<T>(value: T): T {
  const seen = new WeakMap<object, object>();
  const pending: { from: object; to: Record<string, unknown> }[] = [];
  const copy = (input: unknown): unknown => {
    if (typeof input === "string") return input.replace(UNSEEN_EXCEPT_LAYOUT, "");
    if (input === null || typeof input !== "object") return input;
    if (seen.has(input)) return seen.get(input);
    // A normal prototype, not null: a renderer may call the copy's
    // hasOwnProperty/toString or interpolate it, and every one of those is a
    // TypeError on a null-prototype record.
    const output = (Array.isArray(input) ? [] : {}) as Record<string, unknown>;
    seen.set(input, output); pending.push({ from: input, to: output });
    return output;
  };
  const result = copy(value);
  while (pending.length) {
    const { from, to } = pending.pop()!;
    // defineProperty rather than assignment: an own "__proto__" entry in
    // hostile args must arrive as data, not set the copy's prototype. Reading
    // entries still runs a hostile getter once, here -- the same render-time
    // risk a lazy copy would only postpone.
    for (const [key, item] of Object.entries(from))
      Object.defineProperty(to, key, { value: copy(item), writable: true, enumerable: true, configurable: true });
  }
  return result as T;
}

export function safeToolPresentation(tool: ToolDefinition): ToolDefinition {
  const call = tool.renderCall;
  const result = tool.renderResult;
  return { ...tool,
    ...(call ? { renderCall: (args, theme, context) => call(displayCopy(args), theme,
      { ...context, args: displayCopy(context.args) }) } : {}),
    renderResult: (value, options, theme, context) => {
      const clean = displayCopy(value);
      if (result) return result(clean, options, theme, { ...context, args: displayCopy(context.args) });
      // No extension or built-in renderer declared one: Pi's component
      // fallback cannot reach the UNSEEN class, so the same ten-line preview
      // runs on the sanitized copy instead.
      const lines = clean.content.filter(block => block.type === "text").map(block => block.text).join("\n").split("\n");
      const visible = options.expanded ? lines : lines.slice(0, 10);
      if (visible.length < lines.length) visible.push(`... (${lines.length - visible.length} more lines, Ctrl+O to expand)`);
      return new Text(theme.fg("toolOutput", visible.join("\n")), 0, 0);
    },
  };
}
