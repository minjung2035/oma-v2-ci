import assert from "node:assert/strict";
import test from "node:test";
import { McpServerManager } from "../dist/vendor/pi-mcp-adapter/runtime/server-manager.js";

test("001. Repeating MCP catalog cursors terminate instead of polling the same pages forever", async t => {
  for (const kind of ["Tools", "Resources", "Prompts"]) await t.test(kind, async () => {
    let calls = 0;
    const field = kind.toLowerCase();
    const client = {
      getServerCapabilities: () => ({ resources: {}, prompts: {} }),
      [`list${kind}`]: async () => {
        if (++calls > 3) throw new Error("fixture stopped an unbounded catalog loop");
        return { [field]: [], nextCursor: calls % 2 ? "first" : "second" };
      },
    };
    const manager = new McpServerManager();
    if (kind === "Tools") await assert.rejects(manager.fetchAllTools(client), /repeated.*cursor/i);
    else assert.equal((await manager[`fetchAll${kind}`](client)).failed, true);
    assert.equal(calls, 3, "each page in the cycle is requested only once before detecting repetition");
  });
});
