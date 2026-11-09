import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("001. Answer continuation retrieves generated answers while preserving original sources", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-web-answer-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR, originalFetch = globalThis.fetch;
  process.env.PI_CODING_AGENT_DIR = root;
  writeFileSync(join(root, "web-search.json"), JSON.stringify({ toolActivation: "eager", maxInlineContentChars: 1000, fetchRouting: { providers: ["http"] } }));
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir;
    rmSync(root, { recursive: true, force: true });
  });
  const tools = new Map(), appended = [];
  const { default: register } = await import("../dist/vendor/pi-web-access/runtime/index.js");
  register({ registerTool: tool => tools.set(tool.name, tool), on() {}, registerShortcut() {}, registerCommand() {}, appendEntry: (type, data) => appended.push({ type, data }) });
  const source = "Original source text with facts.";
  const answer = "Generated answer: " + "A".repeat(2200);
  globalThis.fetch = async () => new Response(source, { headers: { "content-type": "text/plain" } });
  const model = { provider: "test", id: "fixture", input: ["text"], contextWindow: 20000 };
  const ctx = { model, scopedModels: [], modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "unused" }), complete: async () => ({ stopReason: "stop", content: [{ type: "text", text: answer }] }) } };
  const fetchTool = tools.get("fetch_content"), getTool = tools.get("get_search_content");
  for (const urls of [["https://93.184.216.34/one"], ["https://93.184.216.34/one", "https://93.184.216.34/two"]]) {
    await t.test(`${urls.length} URL(s)`, async () => {
      const result = await fetchTool.execute("answer", { urls, mode: "answer", prompt: "What are the facts?" }, undefined, undefined, ctx);
      assert.equal(result.details.successful, urls.length, JSON.stringify(result.content));
      const retrievalId = result.details.answerResponseId;
      assert.ok(retrievalId, "the generated answer must remain retrievable");
      assert.notEqual(retrievalId, result.details.responseId);
      assert.ok(result.content[0].text.includes(retrievalId), "continuation must identify the answer rather than the original source");
      for (let urlIndex = 0; urlIndex < urls.length; urlIndex++) {
        const storedAnswer = await getTool.execute("retrieve-answer", { responseId: retrievalId, urlIndex, offset: 1000, limit: 1000 });
        assert.equal(storedAnswer.details.contentLength, answer.length);
        assert.ok(storedAnswer.content[0].text.includes(answer.slice(1000, 2000)));
        const original = await getTool.execute("retrieve-source", { responseId: result.details.responseId, urlIndex });
        assert.ok(original.content[0].text.includes(source), "original source remains independently retrievable");
      }
    });
  }
  await t.test("source_check cancellation does not publish an empty successful artifact", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel source check");
    controller.abort(reason);
    const before = appended.length;
    await assert.rejects(() => tools.get("source_check").execute("cancelled", { claim: "claim" }, controller.signal), error => error === reason);
    assert.equal(appended.length, before);
  });
});
