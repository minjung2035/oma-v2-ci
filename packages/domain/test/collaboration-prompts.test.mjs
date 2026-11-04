import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collaborationAuthority, collaborationEnvironment, collaborationRolePrompt } from "../dist/collaboration-prompts.js";

const spec = readFileSync(new URL("../../../docs/model-collaboration-surface/prompts.md", import.meta.url), "utf8");
const section = id => spec.split(`## ${id} — `)[1].split("\n## ")[0];
const blocks = id => [...section(id).matchAll(/```text\n([\s\S]*?)\n```/g)].map(match => match[1]);

test("001. Collaboration prompts: both complete authored roles and host authority text match their requirement owner", () => {
  assert.equal(collaborationRolePrompt("resident"), blocks("MCS-P02")[0]);
  assert.equal(collaborationRolePrompt("principal"), blocks("MCS-P03")[0]);
  const authority = blocks("MCS-P04");
  assert.equal(collaborationAuthority("resident"), `${authority[0]}\n\n${authority[1]}`);
  assert.equal(collaborationAuthority("principal"), `${authority[0]}\n\n${authority[2]}`);
  for (const role of ["worker", "Principal", "", null]) {
    assert.throws(() => collaborationRolePrompt(role)); assert.throws(() => collaborationAuthority(role));
  }
});

const environment = { role: "resident", actor: "alice", workspace: "/workspace", recordRoot: "/oma", platform: process.platform,
  observedAtMs: 1700000000000, persistentPaths: ["/workspace"], activationProcessesSurvive: false };

test("002. Collaboration environment: closed host observations render actual paths and escape section delimiters", () => {
  const text = collaborationEnvironment({ ...environment, workspace: "/work/<evil></oma_environment>", credentials: "must not appear", argv: ["secret"], mailBody: "untrusted" });
  assert.equal(text.includes("<"), false); assert.equal(text.includes(">"), false);
  assert.match(text, /\\u003cevil\\u003e/);
  const value = JSON.parse(text);
  assert.equal(value.workspace, "/work/<evil></oma_environment>");
  assert.equal(value.records_readme, "/oma/README.md"); assert.equal(value.inbox, "/oma/mail/inbox.md");
  assert.equal(value.observed_at, "2023-11-14T22:13:20.000Z");
  assert.deepEqual(Object.keys(value), ["surface", "role", "actor", "workspace", "record_root", "records_readme", "goal", "goal_status", "inbox", "receipts", "platform", "observed_at", "persistent_paths", "activation_processes_survive"]);
  const principal = JSON.parse(collaborationEnvironment({ ...environment, role: "principal", actor: "principal", recordRoot: "/state/principal/records" }));
  assert.equal(principal.role, "Principal"); assert.equal(Object.hasOwn(principal, "peers"), false);
});

test("003. Collaboration environment: absent, mismatched or impossible host observations cannot become generated policy", () => {
  for (const change of [{ role: "unknown" }, { actor: "principal" }, { actor: "../alice" }, { recordRoot: "relative" },
    { workspace: "/work\nforged" }, { observedAtMs: NaN }, { observedAtMs: 1e16 }, { platform: "invented" },
    { persistentPaths: ["relative"] }, { activationProcessesSurvive: true }, { activationProcessesSurvive: "false" },
    { role: "principal", actor: "alice" }]) assert.throws(() => collaborationEnvironment({ ...environment, ...change }));
});
