/** TUI-002: `oma` brings its own society up.
 *
 * The broker refuses to start against a state tree that is not there, and
 * nothing created one. These tests hold the provisioning step to what the
 * broker actually demands — a ledger directory, a canonical repository, and a
 * pinned `main` — and prove it is safe to run on every start.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { provisionSociety } from "../src/config/provision.js";
import { brokerListening, superviseBroker } from "../src/runtime/broker-supervisor.js";

const scratch = (): string => mkdtempSync(join(tmpdir(), "oma-bringup-"));
const git = (gitDir: string, argv: readonly string[]): string =>
  execFileSync("/usr/bin/git", ["--git-dir", gitDir, ...argv],
    { encoding: "utf8", env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", PATH: "/usr/bin:/bin" } }).trim();

test("T115 provisioning creates exactly what the broker demands at startup", () => {
  const root = scratch();
  try {
    const report = provisionSociety(join(root, "state"));
    const state = join(root, "state");
    assert.equal(report.seeded, true);
    for (const relative of ["repos", "world", "agents", "mail/objects", "mail/inboxes",
      "mail/archive/new", "mail/archive/cur", "mail/archive/tmp",
      "repos/project.git", "repos/context.git"])
      assert.ok(existsSync(join(state, relative)), `${relative} was not created`);

    // The canonical repository has the pinned `main` the broker reads, and it
    // is healthy: the broker runs fsck over it before it will admit anything.
    const projectGit = join(state, "repos", "project.git");
    const head = git(projectGit, ["rev-parse", "refs/heads/main^{commit}"]);
    assert.match(head, /^[0-9a-f]{40}$/);
    git(projectGit, ["fsck", "--strict", "--no-reflogs"]);
    // The seed is empty. Copying the user's working tree into OMA's canonical
    // repository is a separate decision and must not happen by surprise.
    assert.equal(git(projectGit, ["ls-tree", "-r", "refs/heads/main"]), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 provisioning runs on every start without disturbing what exists", () => {
  const root = scratch();
  try {
    const state = join(root, "state");
    provisionSociety(state);
    const projectGit = join(state, "repos", "project.git");
    const first = git(projectGit, ["rev-parse", "refs/heads/main"]);
    // Something the society accumulated between starts.
    writeFileSync(join(state, "mail", "archive", "cur", "kept.eml"), "kept\n");

    const again = provisionSociety(state);
    assert.deepEqual(again.created, [], "a second start recreated something");
    assert.equal(again.seeded, false, "a second start re-seeded the canonical main");
    assert.equal(git(projectGit, ["rev-parse", "refs/heads/main"]), first, "the pinned main moved");
    assert.ok(existsSync(join(state, "mail", "archive", "cur", "kept.eml")), "existing mail was disturbed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 a broker already listening is left alone rather than started twice", async () => {
  const root = scratch();
  try {
    // A listener standing in for a broker another `oma` owns.
    const server = createServer(socket => { socket.destroy(); });
    await new Promise<void>(resolve => { server.listen(join(root, "admin.sock"), () => { resolve(); }); });
    try {
      assert.equal(await brokerListening(root), true);
      const handle = await superviseBroker({
        node: process.execPath, libdir: root, society: "probe",
        runRoot: root, configPath: join(root, "config.json"),
      });
      assert.equal(handle.state.kind, "already-running");
      // Stopping must be a no-op: this handle did not start that broker.
      handle.stop();
      assert.equal(await brokerListening(root), true, "a broker we did not start was stopped");
    } finally {
      await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 an absent broker is reported as absent, not assumed running", async () => {
  const root = scratch();
  try {
    assert.equal(await brokerListening(root), false);
    // A libdir with no broker entry: the spawn happens and the child ends. The
    // product must hear about that rather than show a silent empty dashboard.
    const events: string[] = [];
    const handle = await superviseBroker({
      node: process.execPath, libdir: join(root, "missing"), society: "probe",
      runRoot: root, configPath: join(root, "config.json"),
      onEvent: line => { events.push(line); },
    });
    assert.equal(handle.state.kind, "started", "a spawn attempt is still a started process");
    await new Promise<void>(resolve => { setTimeout(resolve, 1500).unref(); });
    handle.stop();
    assert.ok(events.some(line => /Cannot find module|broker ended/.test(line)),
      `the failure was never reported: ${events.join(" | ")}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
