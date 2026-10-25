/** The Control Panel's lines in the engine's theme. The screens module decides
 * what the panel says; this only colours each line by the role screens.ts
 * gives it (tabs, rules, the selected row, key hints), so the panel reads as
 * one of the engine's own selectors. Pure: the theme is passed in. */

export interface PanelTheme {
  fg(color: "accent" | "muted" | "dim" | "borderMuted" | "text", text: string): string;
  bold(text: string): string;
}

const RULE = /^─+\s*$/;
const HINT = /(?:^|\s)(?:Esc|Enter|Ctrl\+X|←\/→|↑\/↓)\s\S/;

export function stylePanel(lines: readonly string[], theme: PanelTheme): string[] {
  const shown = [...lines];
  // The panel is framed to a fixed height; the padding under it is not content.
  while (shown.length > 0 && shown.at(-1)!.trim() === "") shown.pop();
  return shown.map((line, index) => {
    if (index === 0 && /^\[[^\]]+\]|^ \S/.test(line) && line.includes("[")) {
      return line.replace(/\[([^\]]+)\]|(\S+)/g, (_match, selected: string | undefined, other: string | undefined) =>
        selected !== undefined ? theme.bold(theme.fg("accent", ` ${selected} `)) : theme.fg("muted", other!));
    }
    if (RULE.test(line)) return theme.fg("borderMuted", line);
    if (line.startsWith(">")) return theme.fg("accent", `→${line.slice(1)}`);
    if (/^\s+● /.test(line)) return theme.bold(theme.fg("accent", line));
    if (/^\s+○ /.test(line)) return theme.fg("muted", line);
    if (HINT.test(line)) return theme.fg("dim", line);
    if (/^[A-Z][A-Z ]+$/.test(line.trim())) return theme.bold(theme.fg("accent", line));
    return line;
  });
}
