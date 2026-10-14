/** Pre-session presentation: only mode and terminal geometry, never I/O. */
import type { SessionMode } from "../../domain/session-mode.js";
import { pad } from "./text.js";

export function renderSessionMode(selected: SessionMode, width: number, height: number): readonly string[] {
  const choices = [
    `${selected === "society" ? ">" : " "} Society (default)`,
    `${selected === "personal" ? ">" : " "} Personal`,
  ];
  const lines = height < 9 ? ["oma — New session", ...choices, "Enter: start", "Esc: cancel"] : [
    "oma — New session", "", choices[0]!, "  Project collaboration with Workers",
    choices[1]!, "  Pi tools and extensions; edits your files directly", "",
    "Up/Down: choose  Enter: start  Esc/Ctrl+C: cancel", "Mode is fixed for this session.",
  ];
  return lines.slice(0, height).map(line => pad(line, width));
}

export function renderSocietyChoice(societies: readonly string[], selected: string, width: number, height: number): readonly string[] {
  const chrome = height >= 3;
  const count = Math.max(1, height - (chrome ? 2 : 0));
  const index = Math.max(0, societies.indexOf(selected));
  const start = Math.max(0, Math.min(index, societies.length - count));
  const choices = societies.slice(start, start + count).map(society => `${society === selected ? ">" : " "} ${society}`);
  const lines = chrome ? ["oma — Society", ...choices, "Enter: attach  Esc: cancel"] : choices;
  return lines.slice(0, height).map(line => pad(line, width));
}
