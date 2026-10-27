import * as cleanup from "@oma/native/cleanup";
import * as posixFiles from "@oma/native/posix-files";
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { Script } from "node:vm";
import ts from "typescript";
import * as directory from "@oma/storage/directory";
import * as contained from "@oma/native/files";
import * as errors from "@oma/domain/errors";
import * as leaf from "@oma/native/linux";

test("DR39: a collector between temporary creation and locking cannot remove the live publication", () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "oma-publish-lock-"));
  const parent = contained.openDirectory(root);
  let raced = false, production;
  const deps = { "@oma/native/cleanup": cleanup, "@oma/native/posix-files": posixFiles, "node:fs": fs, "node:crypto": crypto, "node:path": path,
    "./directory.js": directory, "@oma/native/files": contained, "@oma/domain/errors": errors,
    "@oma/native/linux": { lockFileDescriptor(fd) {
      if (!raced) {
        raced = true;
        const before = fs.readdirSync(root);
        production.collectDeadTemporaries(parent);
        assert.deepEqual(fs.readdirSync(root), before, "the collector has no proof this writer died");
      }
      return leaf.lockFileDescriptor(fd);
    } } };
  const code = ts.transpileModule(fs.readFileSync(new URL("../packages/storage/src/durable-fs.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Script(code).runInNewContext({ exports: module.exports, module, Buffer, process,
    require(name) { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; } });
  production = module.exports;
  try {
    const target = path.join(root, "frozen.json");
    assert.equal(production.publishNoReplace(target, "frozen bytes"), "created");
    assert.equal(raced, true);
    assert.equal(fs.readFileSync(target, "utf8"), "frozen bytes");
    assert.deepEqual(fs.readdirSync(root), ["frozen.json"]);
  } finally { fs.closeSync(parent); fs.rmSync(root, { recursive: true, force: true }); }
});
