/** Actual Personal command and TUI. No model response or credential helper is
 * substituted. The temporary HOME/data root contains no Human credentials. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(process.platform, "darwin", "Personal observations require the actual Darwin kernel");
assert.equal(process.argv[2], "personal-entry");
const { readSessionBirth } = await import(new URL("../../apps/oma/dist/runtime/session-mode.js", import.meta.url).href);
const root = realpathSync(process.cwd()), home = join(root, "home"), project = join(root, "한 글자 project");
mkdirSync(home); mkdirSync(project);
const entry = fileURLToPath(new URL("../../apps/oma/dist/entry/oma.js", import.meta.url));
const harness = fileURLToPath(new URL("./pty-harness.py", import.meta.url));
const hex = text => Buffer.from(text).toString("hex");
const run = spawnSync("python3", [harness, JSON.stringify({
  argv: [process.execPath, entry, "--mode", "personal", "--no-project-extensions"],
  ready: hex("Your ideas, in motion"), steps: [{ write: hex("\x04"), wait: 2 }],
  sample: join(root, "personal-startup.sample.txt"),
})], { cwd: project, encoding: "utf8", timeout: 45000, maxBuffer: 4 * 1024 * 1024,
  env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, XDG_DATA_HOME: join(root, "data"),
    XDG_RUNTIME_DIR: join(root, "run"), PI_OFFLINE: "1", TERM: "xterm-256color" } });
assert.equal(run.error, undefined); assert.equal(run.signal, null); assert.equal(run.status, 0, run.stderr);
const terminal = JSON.parse(run.stdout), output = Buffer.from(terminal.output, "hex").toString();
// Preserve the real screen even if Keychain, startup, or terminal checks fail.
await new Promise((resolve, reject) => process.stderr.write(
  JSON.stringify({ personalTerminal: terminal, stderr: run.stderr }) + "\n",
  error => error ? reject(error) : resolve()));
assert.equal(terminal.ready, true, output);
assert.equal(terminal.exited, true, output); assert.equal(terminal.code, 0, output);
assert.equal(terminal.echo, true); assert.equal(terminal.icanon, true);
assert.match(output, /Personal/); assert.match(output, /Your ideas, in motion/);
assert.ok(output.includes("\x1b[?1049l"));
const data = join(root, "data", "oma"), sessions = join(data, ".personal");
const births = readdirSync(sessions, { withFileTypes: true }).filter(entry => entry.isDirectory());
assert.equal(births.length, 1);
const birth = readSessionBirth(join(sessions, births[0].name));
assert.equal(birth?.mode, "personal"); assert.equal(birth?.cwd, project);
const societyBirths = readdirSync(data, { withFileTypes: true }).filter(entry => entry.isDirectory())
  .map(entry => readSessionBirth(join(data, entry.name))).filter(record => record?.mode === "society");
assert.deepEqual(societyBirths, [], "Personal must not provision a Society");
const refusedHome = join(root, "refused-home"), refusedData = join(root, "refused-data");
mkdirSync(refusedHome);
const society = spawnSync(process.execPath, [entry, "--mode", "society"], { cwd: project,
  encoding: "utf8", timeout: 10000, env: { PATH: "/usr/bin:/bin", HOME: refusedHome,
    XDG_DATA_HOME: refusedData, XDG_RUNTIME_DIR: join(root, "refused-run") } });
console.error(JSON.stringify({ societyControl: { exitCode: society.status, signal: society.signal, stderr: society.stderr } }));
assert.equal(society.error, undefined); assert.equal(society.signal, null); assert.equal(society.status, 4, society.stderr);
assert.equal(existsSync(refusedData), false, "Society gates must still refuse before provisioning");
console.log(JSON.stringify({ case: "personal-entry", personal: { actualTerminal: true, cleanExit: true,
  terminalRestored: true, birthMode: birth.mode, birthCwd: birth.cwd, noSocietyProvisioned: true,
  input: "ctrl-d", credentialFixture: false, societyRefusedBeforeState: true } }));
