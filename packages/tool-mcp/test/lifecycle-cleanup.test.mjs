import assert from "node:assert/strict";
import test from "node:test";
import { McpLifecycleManager } from "../dist/vendor/pi-mcp-adapter/runtime/lifecycle.js";

test("001. Shutdown closes MCP connections after convergence fails and preserves failures", async t => {
  for (const closeFails of [false, true]) await t.test(`close failure: ${closeFails}`, async () => {
    const primary = new Error("convergence failed");
    const cleanup = new Error("close failed");
    let rejectConvergence;
    let closes = 0;
    const lifecycle = new McpLifecycleManager({ closeAll: async () => {
      closes++;
      if (closeFails) throw cleanup;
    } });
    lifecycle.checkKeepAliveConnections = () => new Promise((_, reject) => { rejectConvergence = reject; });
    lifecycle.setReconnectCallback(() => {});
    const convergence = lifecycle.ensureConverged();
    const converged = assert.rejects(convergence, error => error === primary);
    const shutdown = lifecycle.gracefulShutdown();
    rejectConvergence(primary);
    await converged;
    await assert.rejects(shutdown, error => {
      if (!closeFails) return error === primary;
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [primary, cleanup]);
      return true;
    });
    assert.equal(closes, 1);
    assert.equal(lifecycle.onReconnect, undefined);
    await assert.rejects(lifecycle.gracefulShutdown());
    assert.equal(closes, 1, "shutdown remains idempotent after an error");
  });
});
