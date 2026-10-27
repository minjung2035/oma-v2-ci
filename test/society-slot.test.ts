// `/society` admission: the project's own Society slot is free only while no
// durable record stands there — a binding, unreadable or unverifiable bytes,
// society content and a foreign birth each refuse by name —
// and the check itself never writes.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSocietySlot, projectSociety } from "#oma-test/app/runtime/society-slot";
import { publishProjectBinding } from "#oma-test/app/runtime/provision";
import { newSessionBirth, publishSessionBirth } from "#oma-test/app/runtime/session-mode";
import { PROJECT_BINDING } from "#oma-test/app/runtime/project-binding";

const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), "oma-society-slot-")));
const cleanup = (root: string) => { try { chmodSync(root, 0o700); } catch {} rmSync(root, { recursive: true, force: true }); };

test("society slot: an unborn project is free, and the check writes nothing", () => {
  const base = scratch(), cwd = join(base, "myapp"), dataRoot = join(base, "data");
  mkdirSync(cwd); mkdirSync(dataRoot);
  try {
    const check = checkSocietySlot(dataRoot, cwd);
    assert.deepEqual(check, { kind: "free", society: projectSociety(cwd) });
    assert.equal(existsSync(join(dataRoot, projectSociety(cwd))), false, "the gate created the slot it judged");
  } finally { cleanup(base); }
});

test("society slot: publishing the binding flips free to refused — the durable boundary", () => {
  const base = scratch(), cwd = join(base, "myapp"), dataRoot = join(base, "data");
  mkdirSync(cwd); mkdirSync(dataRoot);
  const slot = join(dataRoot, projectSociety(cwd));
  try {
    assert.equal(checkSocietySlot(dataRoot, cwd).kind, "free");
    publishProjectBinding(slot, { society: projectSociety(cwd), canonicalProjectPath: cwd });
    const check = checkSocietySlot(dataRoot, cwd);
    assert.equal(check.kind, "refused");
    if (check.kind === "refused") assert.match(check.reason, new RegExp(`oma --society ${projectSociety(cwd)}`));
  } finally { cleanup(base); }
});

test("society slot: a binding to another project, society or path names its record", () => {
  const base = scratch(), cwd = join(base, "myapp"), dataRoot = join(base, "data");
  mkdirSync(cwd); mkdirSync(dataRoot);
  const slot = join(dataRoot, projectSociety(cwd));
  try {
    publishProjectBinding(slot, { society: projectSociety(cwd), canonicalProjectPath: join(base, "elsewhere") });
    const check = checkSocietySlot(dataRoot, cwd);
    assert.equal(check.kind, "refused");
    if (check.kind === "refused") assert.match(check.reason, /belongs to the project at/);
  } finally { cleanup(base); }
});

test("society slot: an unreadable binding is a refused record, not absence", () => {
  const base = scratch(), cwd = join(base, "myapp"), dataRoot = join(base, "data");
  mkdirSync(cwd); mkdirSync(dataRoot);
  const slot = join(dataRoot, projectSociety(cwd));
  mkdirSync(slot, { recursive: true });
  writeFileSync(join(slot, PROJECT_BINDING), "not a binding\n");
  try {
    const check = checkSocietySlot(dataRoot, cwd);
    assert.equal(check.kind, "refused");
    if (check.kind === "refused") assert.match(check.reason, /cannot be read/);
  } finally { cleanup(base); }
});

test("society slot: a binding that cannot be observed now is refused, not promoted to absent", () => {
  const base = scratch(), cwd = join(base, "myapp"), dataRoot = join(base, "data");
  mkdirSync(cwd); mkdirSync(dataRoot);
  const slot = join(dataRoot, projectSociety(cwd));
  mkdirSync(slot, { recursive: true });
  chmodSync(slot, 0o000);
  try {
    const check = checkSocietySlot(dataRoot, cwd);
    assert.equal(check.kind, "refused");
    if (check.kind === "refused") assert.match(check.reason, /cannot be verified now/);
  } finally { chmodSync(slot, 0o700); cleanup(base); }
});

test("society slot: society records without a binding refuse as pre-binding state", () => {
  const base = scratch(), cwd = join(base, "myapp"), dataRoot = join(base, "data");
  mkdirSync(cwd); mkdirSync(dataRoot);
  const slot = join(dataRoot, projectSociety(cwd));
  mkdirSync(join(slot, "repos"), { recursive: true });
  try {
    const check = checkSocietySlot(dataRoot, cwd);
    assert.equal(check.kind, "refused");
    if (check.kind === "refused") assert.match(check.reason, /--bind-project/);
  } finally { cleanup(base); }
});

test("society slot: a lone birth record identical to the re-entry's is crash residue; a different one refuses", () => {
  const base = scratch(), cwd = join(base, "myapp"), other = join(base, "other"), dataRoot = join(base, "data");
  mkdirSync(cwd); mkdirSync(other); mkdirSync(dataRoot);
  const slot = join(dataRoot, projectSociety(cwd));
  try {
    publishSessionBirth(slot, newSessionBirth(slot, "society", cwd));
    assert.equal(checkSocietySlot(dataRoot, cwd).kind, "free", "the identical birth record a crashed start left is resumed, not refused");
    rmSync(slot, { recursive: true });
    publishSessionBirth(slot, newSessionBirth(slot, "society", other));
    const check = checkSocietySlot(dataRoot, cwd);
    assert.equal(check.kind, "refused");
    if (check.kind === "refused") assert.match(check.reason, /different session/);
  } finally { cleanup(base); }
});
