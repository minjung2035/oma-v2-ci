import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("001. Hosted search requires a successful terminal response", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-web-response-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  writeFileSync(join(root, "web-search.json"), JSON.stringify({ openaiApiKey: "fixture-key" }));
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });
  const { searchWithOpenAI } = await import("../dist/vendor/pi-web-access/runtime/openai-search.js");
  const output = [
    { type: "web_search_call" },
    { type: "message", content: [{ type: "output_text", text: "A partial answer" }] },
  ];
  const event = value => `data: ${JSON.stringify(value)}\n\n`;
  const partial = output.map(item => event({ type: "response.output_item.done", item })).join("");
  for (const [name, body] of [
    ["failure after output", partial + event({ type: "response.failed", response: { status: "failed", error: { message: "fixture failure" } } })],
    ["missing terminal event", partial],
    ["incomplete JSON", JSON.stringify({ status: "incomplete", output })],
    ["failed JSON", JSON.stringify({ status: "failed", output })],
  ]) {
    await t.test(name, async t => {
      t.mock.method(globalThis, "fetch", async () => new Response(body));
      await assert.rejects(searchWithOpenAI("test"), /failed|incomplete|terminal/i);
    });
  }
  await t.test("completed events allow multiline data and an omitted optional space", async t => {
    const body = "data:" + JSON.stringify({ type: "response.completed", response: { status: "completed", output } }, null, 2).replaceAll("\n", "\ndata:") + "\n\n";
    t.mock.method(globalThis, "fetch", async () => new Response(body));
    assert.equal((await searchWithOpenAI("test")).answer, "A partial answer");
  });
});
