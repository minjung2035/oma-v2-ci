import assert from "node:assert/strict";
import test from "node:test";
import { createContext, runInContext } from "node:vm";

test("001. Curator does not retain SVG executable links from search-result Markdown", async () => {
  const { generateCuratorPage } = await import("../dist/vendor/pi-web-access/runtime/curator-page.js");
  // The DOM comes from the manifest-pinned bundle, like the SDK fixtures in the MCP tests.
  const { parseHTML } = await import("../dist/vendor/pi-web-access/node_modules/linkedom/esm/index.js");
  const html = generateCuratorPage(["query"], "fixture-token", 60, { brave: true }, "brave", "brave", [], null);
  const { window, document } = parseHTML(html);
  // linkedom exposes select.value as a getter; browsers expose a writable property.
  for (const select of document.querySelectorAll("select")) Object.defineProperty(select, "value", { value: "", writable: true });
  const events = new Map();
  const context = createContext({
    document, window, Element: window.Element, console,
    setTimeout: () => 1, setInterval: () => 1, clearInterval() {},
    marked: { parse: text => text },
    EventSource: class { addEventListener(name, listener) { events.set(name, listener); } close() {} },
    fetch: async () => new Response('{}', { headers: { "content-type": "application/json" } }),
  });
  const script = [...document.querySelectorAll("script")].find(element => !element.hasAttribute("src")).textContent;
  runInContext(script, context);
  events.get("result")({ data: JSON.stringify({ queryIndex: 0, query: "query", provider: "brave", results: [{ title: "Source", url: "https://example.org/result", domain: "example.org" }], answer: '<svg><a xlink:href="javascript:alert(1)"><text>click</text></a></svg><p>Safe text <a id="safe-link" href="https://example.org">source</a><a id="unsafe-link" href="javascript:alert(1)">unsafe</a><img src="https://example.org/image.png"></p>' }) });
  const answer = document.querySelector(".result-card-answer");
  assert.ok(answer);
  assert.ok(!answer.querySelector("svg"), "untrusted SVG retained an executable xlink:href");
  assert.ok(answer.textContent.includes("Safe text"));
  assert.equal(answer.querySelector("#safe-link").getAttribute("href"), "https://example.org");
  assert.equal(answer.querySelector("#unsafe-link").getAttribute("href"), "#");
  assert.equal(answer.querySelector("img").getAttribute("src"), "https://example.org/image.png");
  assert.equal(document.querySelector(".source-link").getAttribute("href"), "https://example.org/result");
});
