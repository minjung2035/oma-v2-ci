/** Untrusted text is cleaned before upstream adds its own terminal styling.
 * These copies belong only to renderers: tool execution, history and receipts
 * keep their original bytes. No recursive walk on provider-controlled depth. */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { UNSEEN_EXCEPT_LAYOUT } from "../domain/unseen-text.js";

export function displayCopy<T>(value: T): T {
  const seen = new WeakMap<object, object>();
  const pending: { from: object; to: Record<string, unknown> }[] = [];
  const copy = (input: unknown): unknown => {
    if (typeof input === "string") return input.replace(UNSEEN_EXCEPT_LAYOUT, "");
    if (input === null || typeof input !== "object") return input;
    if (seen.has(input)) return seen.get(input);
    const output = (Array.isArray(input) ? [] : Object.create(null)) as Record<string, unknown>;
    seen.set(input, output); pending.push({ from: input, to: output });
    return output;
  };
  const result = copy(value);
  while (pending.length) {
    const { from, to } = pending.pop()!;
    for (const [key, item] of Object.entries(from)) to[key] = copy(item);
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
      // Custom OMA tools have no renderer; retain Pi's default ten-line preview.
      const lines = clean.content.filter(block => block.type === "text").map(block => block.text).join("\n").split("\n");
      const visible = options.expanded ? lines : lines.slice(0, 10);
      if (visible.length < lines.length) visible.push(`... (${lines.length - visible.length} more lines, Ctrl+O to expand)`);
      return new Text(theme.fg("toolOutput", visible.join("\n")), 0, 0);
    },
  };
}
