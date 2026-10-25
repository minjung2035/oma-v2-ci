import test from "node:test";
import assert from "node:assert/strict";
import { preparePiRetry } from "../dist/pi-runtime.js";
import { prepareEngineInteractiveSettings, createEngineSettings } from "../dist/pi-compat/settings.js";

function slot(initial) {
  let bytes = initial, held = false, holds = 0;
  const files = {
    withOwnedFile(_dir, _name, body) {
      assert.equal(held, false); held = true; holds++;
      try { const next = body(bytes); if (next !== undefined) bytes = next; }
      finally { held = false; }
    },
    withProjectSettings(_dir, _cwd, body) { assert.equal(body(undefined), undefined); },
    ensureThemes() {},
  };
  return { files, bytes: () => bytes, held: () => held, holds: () => holds };
}
test("Engine settings: both transforms keep the same locked slot and preserve explicit choices", () => {
  const s = slot(JSON.stringify({ theme: "chosen", quietStartup: "header", enableSkillCommands: false,
    retry: { baseDelayMs: 50, maxAgentDelayMs: 200, provider: { timeoutMs: 321 } } }));
  preparePiRetry(s.files, "/owned"); prepareEngineInteractiveSettings(s.files, "/owned");
  const result = JSON.parse(s.bytes());
  assert.equal(s.holds(), 2); assert.equal(s.held(), false);
  assert.equal(result.theme, "chosen"); assert.equal(result.quietStartup, "header");
  assert.equal(result.enableSkillCommands, false); assert.equal(result.enableAnalytics, false);
  assert.deepEqual(result.retry, { enabled: true, maxRetries: 5, baseDelayMs: 50,
    maxAgentDelayMs: 200, provider: { maxRetries: 0, timeoutMs: 321 } });
});
for (const [bytes, code] of [["{", "STORE_CORRUPT"], ["[]", "UNSUPPORTED_PROFILE"], ['{"retry":[]}', "UNSUPPORTED_PROFILE"]])
  test(`Engine settings: ${bytes} refuses without replacing saved bytes`, () => {
    const s = slot(bytes);
    assert.throws(() => preparePiRetry(s.files, "/owned"), { code });
    assert.equal(s.bytes(), bytes); assert.equal(s.held(), false);
  });
test("Engine SDK storage: reads and setters use only the explicitly supplied file owner", async () => {
  const s = slot('{"defaultModel":"before"}');
  const manager = createEngineSettings(s.files, "/project", "/owned", { projectTrusted: false });
  assert.equal(manager.getDefaultModel(), "before");
  manager.setDefaultModel("after"); await manager.flush();
  assert.deepEqual(manager.drainErrors(), []);
  assert.equal(JSON.parse(s.bytes()).defaultModel, "after"); assert.equal(s.held(), false);
});
