/** Pre-session presentation: only mode and terminal geometry, never I/O. */
import type { SessionMode } from "@oma/domain/session-mode";
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
