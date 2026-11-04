/** Linux contained open: the kernel's indeterminate RESOLVE_BENEATH race answer
 * (EAGAIN) is retried with the same held root, name and security flags, bounded,
 * and it never turns a hard denial into success or widens containment.
 *
 * Only the leaf's foreign bindings are controlled (workspace loader convention:
 * an explicit dependency map, never dynamic resolution). Every attempt still
 * reaches the real kernel and the fixture is a real directory with real links.
 * The kernel boundary (5.15, 6.8, 6.12 and master) is that BENEATH answers
 * EAGAIN only for a raced walk containing "..", and relativeName refuses those
 * names before any syscall; the injected errno therefore covers exactly the
 * documented indeterminate case, and the real-kernel cases keep containment
 * itself under test. */
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Script } from "node:vm";
import { getSystemErrorName } from "node:util";
import ts from "typescript";
import { errno as realErrno, load as realLoad } from "koffi";
import { StoreError } from "@oma/domain/errors";

/** Load an authored source as CommonJS with the given dependency map. Relative
 * collaborators are loaded as their own sources, never from dist; an unlisted
 * dependency is refused instead of resolved implicitly. */
function load(file, dependencies) {
  const source = fs.readFileSync(file, "utf8")
    .replaceAll("import.meta.url", JSON.stringify(pathToFileURL(resolve(file)).href));
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Script(code, { filename: file }).runInNewContext({
    module, exports: module.exports, Buffer, URL, AggregateError, process,
    require(name) {
      if (name.startsWith(".")) return load(resolve(dirname(file), name).replace(/\.js$/, ".ts"), dependencies);
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`uncontrolled source dependency: ${name}`);
    },
  });
  return module.exports;
}

/** The one controlled binding: an attempt listed in `fault` reports its errno
 * and returns -1; every other call reaches the real kernel untouched. */
let fault = null;
let injectedError = 0;
const attempts = [];
const koffi = {
  errno: () => injectedError !== 0 ? injectedError : realErrno(),
  load(...arguments_) {
    const library = realLoad(...arguments_);
    return {
      func(signature) {
        const actual = library.func(signature);
        if (!signature.startsWith("long syscall")) return actual;
        return (...call) => {
          if (call[0] === 437) {
            // open(437, "int", directory, "const char *", path, "const void *", how, ...)
            attempts.push({
              number: call[0], directory: call[2], path: call[4],
              flags: call[6].readBigUInt64LE(0), resolve: call[6].readBigUInt64LE(16),
            });
            if (fault !== null && call[4] === fault.path && fault.remaining > 0) {
              fault.remaining -= 1;
              injectedError = fault.code;
              return -1;
            }
          }
          injectedError = 0;
          return actual(...call);
        };
      },
    };
  },
};
const files = load(fileURLToPath(new URL("../src/files.ts", import.meta.url)), {
  "node:fs": fs,
  "node:path": { basename, dirname },
  "node:util": { getSystemErrorName },
  "koffi": koffi,
  "@oma/domain/errors": { StoreError },
});
const linux = process.platform === "linux";

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "oma-contained-retry-")));
  const inside = join(root, "inside"), outside = join(root, "outside");
  fs.mkdirSync(inside); fs.mkdirSync(outside);
  fs.writeFileSync(join(inside, "data"), "contained bytes\n");
  fs.writeFileSync(join(outside, "sentinel"), "outside untouched\n");
  fs.symlinkSync("data", join(inside, "inside-link"));
  fs.symlinkSync(outside, join(inside, "escape"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fault = null; injectedError = 0; attempts.length = 0;
  const held = files.openDirectory(inside);
  attempts.length = 0;
  t.after(() => fs.closeSync(held));
  return { root, inside, outside, held };
}

test("001. Contained open: a transient BENEATH-race EAGAIN is retried on the same held root and name", { skip: !linux }, t => {
  const { held } = fixture(t);
  fault = { path: "data", code: 11, remaining: 2 };
  let fd;
  try { fd = files.openBeneath(held, "data", fs.constants.O_RDONLY); }
  finally { fault = null; }
  try { assert.equal(fs.readFileSync(fd, "utf8"), "contained bytes\n"); }
  finally { fs.closeSync(fd); }
  assert.equal(attempts.length, 3, "two refused attempts plus one committed open");
  for (const attempt of attempts) {
    assert.equal(attempt.number, 437, "no openat/open fallback");
    assert.equal(attempt.directory, held, "the same held directory is reused");
    assert.equal(attempt.path, "data", "the same name is resolved");
    assert.equal(attempt.resolve, 0x0cn, "RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS on every attempt");
    assert.equal(attempt.flags & 0o2000000n, 0o2000000n, "O_CLOEXEC on every attempt");
  }
});

test("002. Contained open: a sustained BENEATH race still fails closed as EAGAIN", { skip: !linux }, t => {
  const { inside, held } = fixture(t);
  fault = { path: "data", code: 11, remaining: Infinity };
  try {
    assert.throws(() => files.openBeneath(held, "data", fs.constants.O_RDONLY), { code: "EAGAIN" });
  } finally { fault = null; }
  assert.ok(attempts.length > 1 && attempts.length <= 8, `bounded attempts, observed ${attempts.length}`);
  assert.equal(fs.readFileSync(join(inside, "data"), "utf8"), "contained bytes\n");
});

test("003. Contained open: a non-EAGAIN denial is reported without a retry", { skip: !linux }, t => {
  const { held } = fixture(t);
  fault = { path: "data", code: 13, remaining: 1 };
  try {
    assert.throws(() => files.openBeneath(held, "data", fs.constants.O_RDONLY), { code: "EACCES" });
  } finally { fault = null; }
  assert.equal(attempts.length, 1, "only the indeterminate race answer is retryable");
});

test("004. Contained open: retrying the race cannot admit a symlink or an escape", { skip: !linux }, t => {
  const { outside, held } = fixture(t);
  for (const name of ["inside-link", "escape/sentinel"]) {
    attempts.length = 0;
    fault = { path: name, code: 11, remaining: 1 };
    try { assert.throws(() => files.openBeneath(held, name, fs.constants.O_RDONLY), { code: "STORE_CORRUPT" }); }
    finally { fault = null; }
    assert.equal(attempts.length, 2, `${name}: the retried attempt faces the real kernel denial`);
  }
  assert.equal(fs.readFileSync(join(outside, "sentinel"), "utf8"), "outside untouched\n");
});

test("005. Contained open: the real kernel still opens contained files and refuses non-canonical names before any syscall", { skip: !linux }, t => {
  const { held } = fixture(t);
  const fd = files.openBeneath(held, "data", fs.constants.O_RDONLY);
  try { assert.equal(fs.readFileSync(fd, "utf8"), "contained bytes\n"); }
  finally { fs.closeSync(fd); }
  for (const name of ["", ".", "..", "../data", "a/../data", "a//data", "/data"])
    assert.throws(() => files.openBeneath(held, name, fs.constants.O_RDONLY), { code: "STORE_CORRUPT" });
  assert.equal(attempts.length, 1, "only the canonical name reached the kernel");
  assert.throws(() => files.openBeneath(held, "inside-link", fs.constants.O_RDONLY), { code: "STORE_CORRUPT" });
});
