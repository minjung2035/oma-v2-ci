/** DR18: the decisions that closed the open questions and spikes, each held
 * by a test of what the product now does. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { StoreError } from "../src/domain/errors.js";
import { RegistryOperations } from "../src/lifecycle/registry-operations.js";
import { makeValidAgent } from "./fixtures/spec.js";

const peer = { pid: 1, uid: 1000, gid: 1000, cgroup: null };

test("DR18 / MAIL-001/002: a topic is followed by Residents; the Principal's follow is refused and records nothing", t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-dr18-route-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, "runtime.sqlite"));
  t.after(() => store.close());
  store.transaction(tx => { tx.insertAgent(makeValidAgent("principal")); tx.insertAgent(makeValidAgent("worker-a")); });
  const registry = new RegistryOperations(store);
  const principal = { actor: "principal", incarnation: store.getAgent("principal")!.incarnation, role: "principal" as const,
    channel: "host" as const, capabilities: new Set(["route.follow" as const]), peer };
  assert.throws(() => registry.follow(principal, "release", true, "p-follow"),
    (error: unknown) => error instanceof StoreError && error.code === "CAPABILITY_DENIED" && /Residents/.test(error.message));
  assert.equal(store.getOperation("principal", "p-follow"), null, "a refused follow was recorded");
  assert.deepEqual(store.subscribers("release"), []);
  const resident = { actor: "worker-a", incarnation: store.getAgent("worker-a")!.incarnation, role: "resident" as const,
    channel: "actor" as const, capabilities: new Set(["route.follow" as const]), peer };
  assert.equal(registry.follow(resident, "release", true, "r-follow").state, "succeeded");
  assert.deepEqual(store.subscribers("release"), ["worker-a"]);
});

test("DR18 / S-01-CANDIDATE: checks are an unsupported configuration, and the root protects every change", async () => {
  const { protectedPathMatches } = await import("../src/git/observe.js");
  const { assertSupportedIntegration, snapshotIntegrationPolicy } = await import("../src/git/integration-policy.js");
  for (const path of ["README.md", "src/a.ts", "deep/er/file", ".github/workflows/ci.yml"])
    assert.equal(protectedPathMatches(path, "/"), true, path);
  assert.equal(protectedPathMatches("src/a.ts", "docs/"), false);
  assert.equal(protectedPathMatches("docs/a.md", "docs/"), true);
  assert.throws(() => assertSupportedIntegration(snapshotIntegrationPolicy({ policyRevision: "p", protectedPaths: [],
    checks: [{ id: "test", argv: ["/usr/bin/true"], env: {}, timeoutSeconds: 1 }] })),
  (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" && /not run by this version/.test(error.message));
});

test("DR18 / D-9: `oma login` hands the terminal to the engine's own interactive mode over the society's engine directory, holding the society", async t => {
  const { chmodSync, existsSync, mkdirSync: mkdir, realpathSync, writeFileSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { hostLaunchLocation } = await import("../src/runtime/assets.js");
  const { publishProjectBinding } = await import("../src/runtime/provision.js");
  const { writeSettings } = await import("../src/tui/sources/settings.js");
  const { defaultHostConfig } = await import("../src/config/defaults.js");
  const { HostTenure } = await import("../src/runtime/host-tenure.js");
  const root = mkdtempSync(join(tmpdir(), "oma-login-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(new URL(".", import.meta.url).pathname, "..", "..");
  const project = join(root, "project");
  mkdir(project);
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: root, XDG_DATA_HOME: join(root, "data"), XDG_RUNTIME_DIR: join(root, "run") };
  const configPath = join(root, "config.json");
  const location = hostLaunchLocation("demo", env, configPath);
  // The engine the society is pinned to: it reports what it was given and signs the directory.
  const engine = join(root, "fake-pi.sh");
  writeFileSync(engine, "#!/bin/sh\nprintf 'dir=%s\\n' \"$PI_CODING_AGENT_DIR\"\n[ -e /proc/self/fd/4 ] && echo fence-held\nprintf ok > \"$PI_CODING_AGENT_DIR/logged-in\"\nexit 0\n");
  chmodSync(engine, 0o755);
  const login = () => spawnSync(process.execPath, [join(repo, "dist/src/entry/oma.js"), "login", "--society", "demo", "--config", configPath],
    { cwd: project, env: { ...env, OMA_PI_COMMAND: engine }, encoding: "utf8", timeout: 60_000 });

  const none = login();
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /society가 아직 없습니다/, "a login made a society");
  assert.equal(existsSync(location.stateRoot), false);

  mkdir(join(location.stateRoot, "repos"), { recursive: true });
  publishProjectBinding(location.stateRoot, { society: "demo", canonicalProjectPath: realpathSync(project) });
  writeSettings(configPath, defaultHostConfig({ society: "demo", node: process.execPath, libdir: repo, rootfs: join(root, "rootfs"), deploymentDigest: "0".repeat(64) }));
  const held = HostTenure.take(location.stateRoot);
  assert.ok(held !== null);
  const busy = login();
  assert.notEqual(busy.status, 0);
  assert.match(busy.stderr, /실행 중입니다/, "a login ran beside the society's running oma");
  await held.end();

  const done = login();
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, new RegExp(`dir=${join(location.stateRoot, "pi").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "the engine was not given the society's engine directory");
  assert.match(done.stdout, /fence-held/, "the engine did not hold the society lease");
  assert.equal(existsSync(join(location.stateRoot, "pi", "logged-in")), true);
  const after = HostTenure.take(location.stateRoot);
  assert.ok(after !== null, "the login kept the society after it ended");
  await after.end();
});
