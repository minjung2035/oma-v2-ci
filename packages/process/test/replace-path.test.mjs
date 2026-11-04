/** Real execve replacement. A candidate that passes X_OK without being a
 * regular executable file must never reach the runtime: its execve failure
 * aborts the whole setup process, so a later PATH command can only run after
 * such a shadow was filtered by selection itself. */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "oma-replace-path-"));
const shadow = join(root, "shadow"), later = join(root, "later"), native = join(later, "native-probe");
mkdirSync(shadow); mkdirSync(later);
before(() => {
  assert.ok(["linux", "darwin"].includes(process.platform), "a real supported POSIX host is required");
  const compiled = spawnSync(process.platform === "darwin" ? "/usr/bin/xcrun" : "/usr/bin/cc",
    [...(process.platform === "darwin" ? ["clang"] : []), "-Wall", "-Wextra", "-Werror", "-O2",
      fileURLToPath(new URL("./fixtures/exec-argv.c", import.meta.url)), "-o", native],
    { encoding: "utf8", timeout: 30000, killSignal: "SIGKILL", maxBuffer: 65536 });
  assert.equal(compiled.error, undefined); assert.equal(compiled.signal, null); assert.equal(compiled.status, 0, compiled.stderr);
});
after(() => rmSync(root, { recursive: true, force: true }));

/** The child keeps the production protocol shape: one release hook, then the
 * replacement. A refusal is caught and reported; a success never returns. */
function childProgram({ executable, argv, cwd, env }) {
  const entries = Object.entries(env)
    .map(([key, value]) => `${JSON.stringify(key)}: ${value === undefined ? "undefined" : JSON.stringify(value)}`).join(", ");
  return `import { replaceProcess } from "@oma/process/replace";
const command = { executable: ${JSON.stringify(executable)}, argv: ${JSON.stringify(argv)}, cwd: ${JSON.stringify(cwd)}, env: { ${entries} } };
try { replaceProcess(command, () => process.stdout.write("before-exec\\n")); }
catch (error) { process.stdout.write("refused:" + JSON.stringify({ name: error?.name ?? null, code: error?.code ?? null }) + "\\n"); process.exitCode = 7; }`;
}
function child(program) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", program],
    { cwd: repository, encoding: "utf8", timeout: 20000, killSignal: "SIGKILL", maxBuffer: 65536 });
}
function executable(name, body) {
  const path = join(later, name);
  writeFileSync(path, `#!/bin/sh\n${body}`);
  chmodSync(path, 0o755);
  return path;
}
const appearances = (text, needle) => text.split(needle).length - 1;

test("001. A later PATH candidate runs past an X_OK directory shadow without aborting", { timeout: 20000 }, () => {
  mkdirSync(join(shadow, "oma-audit-probe"), { mode: 0o755 });
  symlinkSync("/bin/echo", join(later, "oma-audit-probe"));
  const run = child(childProgram({ executable: "oma-audit-probe", argv: ["LATER-CANDIDATE-RAN"], cwd: root,
    env: { PATH: `${shadow}:${later}` } }));
  assert.equal(run.error, undefined);
  assert.equal(run.signal, null, `the replacement process must not abort: ${run.stderr}`);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(appearances(run.stdout, "before-exec\n"), 1, "the release hook is consumed exactly once");
  assert.ok(run.stdout.includes("LATER-CANDIDATE-RAN\n"), run.stdout);
});

test("002. Later PATH candidates run past a non-regular or non-executable shadow", { timeout: 60000 }, () => {
  const shadows = [
    ["shadow-directory", () => mkdirSync(join(shadow, "shadow-directory"), { mode: 0o755 })],
    ["shadow-permission", () => { writeFileSync(join(shadow, "shadow-permission"), "#!/bin/sh\nprintf 'SHADOW-RAN\\n'\n"); chmodSync(join(shadow, "shadow-permission"), 0o644); }],
  ];
  for (const [name, makeShadow] of shadows) {
    makeShadow();
    executable(name, "printf '%s\\n' LATER-CANDIDATE-RAN");
    const run = child(childProgram({ executable: name, argv: [], cwd: root, env: { PATH: `${shadow}:${later}` } }));
    assert.equal(run.signal, null, `${name} aborted the replacement process: ${run.stderr}`);
    assert.equal(run.status, 0, `${name}: ${run.stdout}${run.stderr}`);
    assert.ok(run.stdout.includes("LATER-CANDIDATE-RAN\n"), `${name}: ${run.stdout}`);
    assert.ok(!run.stdout.includes("SHADOW-RAN"), `${name} ran the shadow`);
  }
});

test("003. PATH search hands the native candidate the fixed argv[0], argv and environment", { timeout: 20000 }, () => {
  mkdirSync(join(shadow, "native-probe"), { mode: 0o755 });
  const run = child(childProgram({ executable: "native-probe", argv: ["first", "second"], cwd: root,
    env: { PATH: `${shadow}:${later}`, OMA_PROBE_VALUE: "kept", OMA_PROBE_UNSET: undefined } }));
  assert.equal(run.signal, null, run.stderr);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(appearances(run.stdout, "before-exec\n"), 1, "the release hook is consumed exactly once");
  const lines = run.stdout.split("\n");
  assert.ok(lines.includes("argv0=native-probe"), run.stdout);
  assert.ok(lines.includes("arg=first") && lines.includes("arg=second"), run.stdout);
  assert.ok(lines.includes("kept=kept"), run.stdout);
  assert.ok(lines.includes("unset=absent"), run.stdout);
});

test("004. An explicit executable path replaces directly with its spelling as argv[0]", { timeout: 20000 }, () => {
  const run = child(childProgram({ executable: native, argv: ["direct"], cwd: root, env: { PATH: "/usr/bin:/bin" } }));
  assert.equal(run.signal, null, run.stderr);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(appearances(run.stdout, "before-exec\n"), 1);
  const lines = run.stdout.split("\n");
  assert.ok(lines.includes(`argv0=${native}`), run.stdout);
  assert.ok(lines.includes("arg=direct"), run.stdout);
  assert.ok(lines.includes("kept=absent") && lines.includes("unset=absent"), run.stdout);
});

test("005. A script candidate keeps its arguments and the exact environment", { timeout: 20000 }, () => {
  executable("probe-script", `printf 'args=%s\\n' "$*"
printf 'kept=%s\\n' "$OMA_PROBE_VALUE"
printf 'unset=%s\\n' "\${OMA_PROBE_UNSET-absent}"
`);
  const run = child(childProgram({ executable: "probe-script", argv: ["first", "second"], cwd: root,
    env: { PATH: later, OMA_PROBE_VALUE: "kept", OMA_PROBE_UNSET: undefined } }));
  assert.equal(run.signal, null, run.stderr);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(appearances(run.stdout, "before-exec\n"), 1, "the release hook is consumed exactly once");
  const lines = run.stdout.split("\n");
  assert.ok(lines.includes("args=first second"), run.stdout);
  assert.ok(lines.includes("kept=kept"), run.stdout);
  assert.ok(lines.includes("unset=absent"), run.stdout);
});

test("006. Unusable candidates refuse with the classified error before any release or exec", { timeout: 40000 }, () => {
  executable("fallback-probe", "printf 'FALLBACK-RAN\\n'");
  writeFileSync(join(later, "plain-file"), "#!/bin/sh\nprintf 'PLAIN-RAN\\n'\n"); chmodSync(join(later, "plain-file"), 0o644);
  mkdirSync(join(shadow, "only-shadow"), { mode: 0o755 });
  const cases = [
    ["explicit missing path", { executable: "./missing-probe", argv: [], cwd: root, env: { PATH: later } }],
    ["explicit directory path", { executable: join(shadow, "only-shadow"), argv: [], cwd: root, env: { PATH: later } }],
    ["explicit non-executable file", { executable: join(later, "plain-file"), argv: [], cwd: root, env: { PATH: later } }],
    ["explicit path with no fallback", { executable: "./fallback-probe", argv: [], cwd: root, env: { PATH: later } }],
    ["PATH with only an unusable entry", { executable: "only-shadow", argv: [], cwd: root, env: { PATH: shadow } }],
    ["PATH without any match", { executable: "no-such-probe", argv: [], cwd: root, env: { PATH: later } }],
    ["no executable search path", { executable: "no-such-probe", argv: [], cwd: root, env: {} }],
  ];
  for (const [label, command] of cases) {
    const run = child(childProgram(command));
    assert.equal(run.signal, null, `${label} aborted the replacement process: ${run.stderr}`);
    assert.equal(run.status, 7, `${label}: ${run.stdout}${run.stderr}`);
    assert.ok(run.stdout.startsWith("refused:"), `${label}: ${run.stdout}`);
    assert.deepEqual(JSON.parse(run.stdout.slice("refused:".length)), { name: "StoreError", code: "UNSUPPORTED_PROFILE" }, label);
    assert.ok(!run.stdout.includes("before-exec"), `${label} released before any exec`);
    assert.ok(!run.stdout.includes("FALLBACK-RAN") && !run.stdout.includes("PLAIN-RAN"), `${label} ran another command`);
  }
});
