/** Actual pinned dependency/adapter inventory. No terminal, model request or native platform. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { PI_INTERACTIVE_PRIVATE_MEMBERS, PI_INTERACTIVE_PRIVATE_FIELDS } from "../dist/pi-compat/interactive-mode.js";

const inventory = JSON.parse(readFileSync(new URL("../dist/pi-compat/contacts.json", import.meta.url), "utf8"));
test("Engine private contacts: exact installed versions and every named private member are pinned", () => {
  const require = createRequire(import.meta.url);
  for (const [name, expected] of Object.entries(inventory.versions)) {
    const metadata = name === "pi-open-tui" ? pathToFileURL(require.resolve(name + "/package.json"))
      : new URL("../package.json", import.meta.resolve(name));
    assert.equal(JSON.parse(readFileSync(metadata, "utf8")).version, expected, name);
  }
  const contact = inventory.contacts.find(entry => entry.id === "interactive-mode-private");
  assert.deepEqual(contact.members, [...PI_INTERACTIVE_PRIVATE_MEMBERS]);
  assert.deepEqual(contact.fields, [...PI_INTERACTIVE_PRIVATE_FIELDS]);
  for (const name of contact.members) assert.equal(typeof InteractiveMode.prototype[name], "function", name);
  const source = readFileSync(new URL("./modes/interactive/interactive-mode.js", import.meta.resolve("@earendil-works/pi-coding-agent")), "utf8");
  for (const name of contact.fields) assert.match(source, new RegExp("\\b" + name + "\\b"));
  assert.equal(inventory.contacts.find(entry => entry.id === "finished-open-tui-lines").replacement, "Your ideas, in motion");
});
