import test from "node:test";
import assert from "node:assert/strict";
import {
  contextPathCheck, contextFileCheck, contextEntriesCheck,
} from "@oma/domain/context-policy";
import {
  contextPathCheck as wirePathCheck, contextFileCheck as wireFileCheck,
  contextPublishParamsCheck, type ParamsLimits,
} from "@oma/domain/validation";
import { contextEntriesCheck as durableEntriesCheck } from "@oma/domain/durable";

const SHA = "0123456789abcdef".repeat(4);
const limits: ParamsLimits = {
  frameBytes: 262144, mailBodyBytes: 1048576, subjectBytes: 4096, addresses: 64,
  replyReferences: 64, contextFiles: 8, contextBytes: 1024, bundleBytes: 1048576,
};
const entries = [
  { path: "GOAL.md", bytes: 5, sha256: SHA },
  { path: "RATIONALE.md", bytes: 4, sha256: SHA },
  { path: "decisions/0001.md", bytes: 3, sha256: SHA },
];

// Literal expectations come from CTX-001 and the supported v1 validator, not
// from the refactored descriptor or generator being checked.
test("the exact supported context path vocabulary is retained", () => {
  assert.equal(wirePathCheck, contextPathCheck, "wire validation must use the same owner");
  assert.equal(wireFileCheck, contextFileCheck, "content validation must use the same owner");
  for (const name of ["GOAL.md", "RATIONALE.md", "decisions/0001.md", "decisions/reason.md"])
    assert.equal(contextPathCheck(name), null, name);
  for (const name of ["CURRENT.md", "README.md", "goal.md", "decisions/file.txt", "decisions/nested/file.md", "../GOAL.md", "/GOAL.md"])
    assert.notEqual(contextPathCheck(name), null, name);
});

test("shared policy preserves accepted UTF-8 Markdown instead of adding a content blacklist", () => {
  for (const text of ["# GOAL\n한국어 목적\n", " \n", "<!-- explanation -->\n", "#!/example\nThis is documentation, not an executable file.\n"]) {
    assert.equal(contextFileCheck("GOAL.md", Buffer.from(text)), null, text);
  }
  assert.equal(contextFileCheck("RATIONALE.md", Buffer.alloc(0)), null);
  assert.notEqual(contextFileCheck("GOAL.md", Buffer.alloc(0)), null);
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from([0]), Buffer.from([7]), Buffer.from([127])])
    assert.notEqual(contextFileCheck("GOAL.md", bytes), null);
});

test("wire and durable manifests share path ordering and overflow rules without rewriting input", () => {
  const payload = { expected: null, entries, content: { bytes: 12, sha256: SHA, mediaType: "application/vnd.oma.context-v1" } };
  const before = JSON.stringify(payload);
  const checkWire = contextPublishParamsCheck(limits);
  assert.equal(checkWire(payload), null);
  assert.equal(durableEntriesCheck(entries), null);
  assert.equal(contextEntriesCheck(entries, { requireSorted: true, contentBytes: 12 }), null);
  for (const damaged of [[...entries].reverse(), [entries[0], entries[0]], entries.slice(1)]) {
    assert.notEqual(durableEntriesCheck(damaged), null);
    assert.notEqual(checkWire({ ...payload, entries: damaged }), null);
  }
  assert.notEqual(checkWire({ ...payload, content: { ...payload.content, bytes: 11 } }), null);
  assert.equal(JSON.stringify(payload), before);
});


test("DR27: explicit GOAL mail meets the mail body bound before stream admission", () => {
  const payload = { expected: null, entries, content: { bytes: 12, sha256: SHA, mediaType: "application/vnd.oma.context-v1" } };
  const check = contextPublishParamsCheck({ ...limits, mailBodyBytes: 4 });
  assert.equal(check(payload), null, "ordinary context files retain the context bound");
  assert.match(check({ ...payload, goalMail: { subject: "Goal" } })!, /mail limit/);
  assert.equal(contextPublishParamsCheck({ ...limits, mailBodyBytes: 5 })({ ...payload, goalMail: { subject: "Goal" } }), null);
  for (const subject of ["Goal\rInjected", "Goal\nInjected"])
    assert.match(contextPublishParamsCheck(limits)({ ...payload, goalMail: { subject } })!, /CR\/LF/);
});
