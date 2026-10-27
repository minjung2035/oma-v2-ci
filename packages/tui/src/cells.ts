/** Terminal cell width, the one engine primitive the product borrows for
 * measurement (TUI-020). Shared by the Control Panel's view and by what oma
 * adds to the engine's own screen; neither borrows the engine's layout.
 *
 * `visibleWidth` is grapheme-aware, so it gets ZWJ emoji, skin-tone sequences
 * and combining marks right where a hand-rolled code-point table silently
 * misaligns every column that follows. It ignores ANSI styling. */
import { visibleWidth } from "@earendil-works/pi-tui";

export const cellWidth = visibleWidth;
