import test from "node:test";
import assert from "node:assert/strict";
import { stylePanel } from "@oma/tui/panel-style";
test("Control panel: each line coloured by its role, framing padding dropped", () => {
    const theme = {
        fg: (color, text) => `<${color}>${text}</>`,
        bold: (text) => `<b>${text}</b>`,
    };
    const styled = stylePanel(["[Dashboard]  Config   Mail ", "────────", "> Principal model   default", "  Worker limit      4",
        "←/→ Category · ↑/↓ Item · Enter Select · Esc Back · Ctrl+X Close", "", "   "], theme);
    assert.equal(styled.length, 5);
    assert.equal(styled[0], "<b><accent> Dashboard </></b>  <muted>Config</>   <muted>Mail</> ");
    assert.equal(styled[1], "<borderMuted>────────</>");
    assert.equal(styled[2], "<accent>→ Principal model   default</>");
    assert.equal(styled[3], "  Worker limit      4");
    assert.match(styled[4], /^<dim>/);
});
