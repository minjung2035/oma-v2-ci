import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupOwnedSystemdUnits,
  type SystemdCommand,
} from "./fixtures/systemd.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-unit-cleanup-"));
  mkdirSync(join(root, "units"));
  const name = "oma-vcheck-child.service";
  const path = join(root, "units", name);
  writeFileSync(path, "[Service]\nExecStart=/bin/true\n");
  const linked = new Map([[name, path]]);
  const commands: string[][] = [];
  const run: SystemdCommand = (args) => {
    commands.push([...args]);
    let stdout = "";
    if (args[0] === "show")
      stdout = linked.has(args[1]!)
        ? `LoadState=loaded\nFragmentPath=${linked.get(args[1]!)}\n`
        : "LoadState=not-found\nFragmentPath=\n";
    else if (args[0] === "disable")
      for (const unit of args.slice(2)) linked.delete(unit);
    else if (args[0] === "list-unit-files" && linked.has(args[1]!))
      stdout = `${args[1]} linked enabled\n`;
    else
      assert.ok(
        args[0] === "list-unit-files" || args[0] === "daemon-reload",
        `unexpected command: ${args}`,
      );
    return { status: 0, signal: null, stdout, stderr: "" };
  };
  return {
    root,
    name,
    path,
    linked,
    commands,
    run,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}
test("V01 cleanup uses exact owned unit names and checks manager lookup after disabling", () => {
  const f = fixture();
  try {
    const unrelated = join(f.root, "units", "oma-unrelated-child.service");
    writeFileSync(unrelated, "keep");
    symlinkSync(unrelated, join(f.root, "units", "oma-vcheck-link.service"));
    cleanupOwnedSystemdUnits(f.root, "vcheck", f.run);
    assert.deepEqual(
      f.commands.find((args) => args[0] === "disable"),
      ["disable", "--now", f.name],
    );
    assert.ok(
      f.commands.every((args) => args.every((arg) => !arg.includes("*"))),
    );
    assert.equal(f.linked.size, 0);
    assert.equal(existsSync(f.path), false);
    assert.equal(existsSync(unrelated), true);
    assert.ok(
      f.commands.some(
        (args) => args[0] === "list-unit-files" && args[1] === f.name,
      ),
    );
  } finally {
    f.close();
  }
});
test("V01 cleanup refuses a foreign manager FragmentPath before mutation", () => {
  const f = fixture();
  try {
    const foreign = join(f.root, "foreign.service");
    writeFileSync(foreign, "keep");
    f.linked.set(f.name, foreign);
    assert.throws(
      () => cleanupOwnedSystemdUnits(f.root, "vcheck", f.run),
      /foreign unit/,
    );
    assert.equal(
      f.commands.some((args) => args[0] === "disable"),
      false,
    );
    assert.equal(existsSync(f.path), true);
  } finally {
    f.close();
  }
});
test("V01 cleanup detects successful-command but ineffective disable, including dangling links", () => {
  const f = fixture();
  try {
    const ineffective: SystemdCommand = (args) =>
      args[0] === "disable"
        ? { status: 0, signal: null, stdout: "", stderr: "" }
        : f.run(args);
    assert.throws(
      () => cleanupOwnedSystemdUnits(f.root, "vcheck", ineffective),
      /remains in manager lookup/,
    );
    assert.equal(f.linked.size, 1);
  } finally {
    f.close();
  }
});
test("V01 unavailable observation or failed disable cannot become successful cleanup", () => {
  for (const phase of ["show", "disable"]) {
    const f = fixture();
    try {
      const failed: SystemdCommand = (args) =>
        args[0] === phase
          ? { status: 1, signal: null, stdout: "", stderr: "unavailable" }
          : f.run(args);
      assert.throws(() => cleanupOwnedSystemdUnits(f.root, "vcheck", failed));
      assert.equal(existsSync(f.path), true);
      assert.equal(f.linked.size, 1);
    } finally {
      f.close();
    }
  }
});
test("V01 missing ownership inventory cannot be treated as an empty successful cleanup", () => {
  const f = fixture();
  try {
    assert.throws(
      () => cleanupOwnedSystemdUnits(join(f.root, "missing"), "vcheck", f.run),
      { code: "ENOENT" },
    );
    assert.equal(f.commands.length, 0);
  } finally {
    f.close();
  }
});
