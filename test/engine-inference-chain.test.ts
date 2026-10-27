/** INF-005..008: the whole provider path of a confined Resident, end to end.
 *
 * The last test runs the bundled engine for real, with the trusted core
 * extension, and lets it make a model call. The engine is given only a
 * placeholder key; the call has to cross the extension's loopback bridge, the
 * relay's unix socket and a TLS connection, and arrive at the provider carrying
 * the real key. Only the bwrap namespace is absent, which the argv tests cover.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { InferenceRelay } from "#oma-test/app/runtime/inference-relay";
import { placeholderFor, resolveEngineAuth } from "@oma/engine/engine-auth";
import { resolvePiRuntime } from "@oma/engine/pi-runtime";
import { spawnOwnedRpc } from "@oma/process/async";
import { PiRpcClient } from "@oma/engine/pi-rpc";
import { tlsProvider } from "./fixtures/tls-provider.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const scratch = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));
const code = (value: unknown): string | undefined => (value as { code?: string }).code;

function withEnv<T>(changes: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(changes)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
}

test("T116 a placeholder keeps the shape provider code reads and none of the secret", () => {
  const apiKey = "sk-ant-api03-" + "Q7x".repeat(14);
  const stand = placeholderFor(apiKey);
  assert.ok(stand.startsWith("sk-ant-api03-"), "the kind prefix decides the header scheme; it must stay");
  assert.equal(stand.length, apiKey.length);
  assert.notEqual(stand, apiKey);
  assert.ok(!stand.includes(apiKey.slice(13, 30)), "no run of the secret may survive");

  // A signed token: the Codex provider decodes the claims to find the account.
  const header = Buffer.from('{"alg":"RS256"}').toString("base64url");
  const claims = Buffer.from('{"https://api.openai.com/auth":{"chatgpt_account_id":"acct-1"}}').toString("base64url");
  const token = `${header}.${claims}.${"s1gnature".repeat(6)}`;
  const tokenStand = placeholderFor(token);
  const [h, c, s] = tokenStand.split(".");
  assert.equal(h, header);
  assert.equal(c, claims, "the claims must survive so the account can still be read");
  assert.notEqual(s, token.split(".")[2], "the signature must not");
  assert.equal(tokenStand.length, token.length);

  // The engine reads a leading `$` or `!` as an environment reference or a command.
  assert.throws(() => placeholderFor("$" + "a".repeat(40)), (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
  assert.throws(() => placeholderFor("short"), (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
});

test("V27B: a key with nothing to replace is refused at once, never retried without end", () => {
  const header = Buffer.from('{"alg":"RS256"}').toString("base64url");
  for (const key of [
    `${header}.${header}.${"_-".repeat(12)}`,      // a token whose signature has no letter or digit
    "-".repeat(24),                                 // nothing but separators
    `sk-${".".repeat(30)}`,                         // a long segment of punctuation
  ]) {
    const started = Date.now();
    assert.throws(() => placeholderFor(key), (error: unknown) => code(error) === "UNSUPPORTED_PROFILE", key);
    assert.ok(Date.now() - started < 1_000);
  }
  // The shapes providers use still get a placeholder that differs and hides the key.
  for (const key of ["sk-ant-api03-" + "Q7x".repeat(14), `${header}.${header}.${"s1gnature".repeat(6)}`, "k".repeat(40)]) {
    const stand = placeholderFor(key);
    assert.notEqual(stand, key);
    assert.equal(stand.length, key.length);
    assert.ok(!stand.includes(key) && !key.includes(stand));
  }
});

test("T116 the credential is resolved by the engine from OMA's own agent directory", async () => {
  const agentDir = scratch("oma-engine-auth-");
  try {
    await withEnv({ ANTHROPIC_API_KEY: "sk-ant-api03-" + "k".repeat(40) }, async () => {
      const auth = await resolveEngineAuth(agentDir, "anthropic", "claude-fable-5");
      assert.equal(auth.provider, "anthropic");
      assert.equal(auth.origin, "https://api.anthropic.com");
      assert.equal(auth.apiKey, "sk-ant-api03-" + "k".repeat(40));

      // "Whatever the engine would pick" with nothing picked yet is not guessed.
      await assert.rejects(() => resolveEngineAuth(agentDir, "pi", "current"),
        (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
      // Once the engine's own settings name a default, that is what is used.
      writeFileSync(join(agentDir, "settings.json"),
        JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-fable-5", defaultThinkingLevel: "high" }));
      const current = await resolveEngineAuth(agentDir, "pi", "current");
      assert.equal(`${current.provider}/${current.model}`, "anthropic/claude-fable-5");
      // DR24: the engine's default effort comes with its default model; a
      // named model's effort is its profile's, not the engine's default.
      assert.equal(current.thinking, "high");
      assert.equal(auth.thinking, undefined);
    });
    // No credential anywhere: refused with a reason, not a request without one.
    await withEnv({ ANTHROPIC_API_KEY: undefined }, async () => {
      await assert.rejects(() => resolveEngineAuth(agentDir, "anthropic", "claude-fable-5"),
        (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
    });
  } finally { rmSync(agentDir, { recursive: true, force: true }); }
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", () => { resolve(); }); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
  return port;
}

test("T116 the real engine, given only a placeholder, reaches the provider with the real key", async () => {
  const work = scratch("oma-chain-");
  const provider = await tlsProvider();
  const previousTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  // Only the relay (in this process) talks TLS, and only to the stand-in.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const secret = "sk-ant-api03-" + "R3al".repeat(10);
  const placeholder = placeholderFor(secret);
  const socketPath = join(work, "inference.sock");
  const relay = await InferenceRelay.open(socketPath,
    { origin: provider.origin, headers: {}, substitute: { placeholder, secret } },
    { concurrent: 4, timeoutMs: 20000 });
  let child: ReturnType<typeof spawnOwnedRpc> | null = null;
  let rpc: PiRpcClient | null = null;
  try {
    const agentDir = join(work, "agent");
    const sessionDir = join(work, "session");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(sessionDir, { recursive: true });
    const runtime = resolvePiRuntime({ stateRoot: work, libdir: root });
    const port = await freePort();
    child = spawnOwnedRpc(runtime.executable, [
      ...runtime.args, "--mode", "rpc", "--no-approve", "--no-context-files", "--no-skills",
      "--no-prompt-templates", "--no-extensions", "--exclude-tools", "bash,powershell",
      "--session-dir", sessionDir, "--name", "oma-chain",
      "-e", join(root, "packages/extension/dist/index.js"),
      "--model", "anthropic/claude-fable-5",
    ], work, {
      HOME: work, PATH: process.env.PATH ?? "/usr/bin:/bin",
      // An empty agent directory and no provider variables: the placeholder is
      // the only key the engine can possibly use.
      PI_CODING_AGENT_DIR: agentDir,
      OMA_INFERENCE_SOCKET: socketPath, OMA_INFERENCE_PROVIDER: "anthropic",
      OMA_INFERENCE_PORT: String(port), OMA_INFERENCE_KEY: placeholder,
    });
    rpc = new PiRpcClient(child, { frameBytes: 1 << 20, idleStreamSeconds: 60, receiptWaitSeconds: 30 });
    await rpc.send({ id: "go", type: "prompt", message: "say hello" });
    for (let attempt = 0; attempt < 300 && provider.seen.length === 0; attempt += 1)
      await new Promise(resolve => setTimeout(resolve, 100));

    assert.ok(provider.seen.length > 0, "the engine's call never reached the provider");
    const request = provider.seen[0]!;
    // The engine chooses its own query (Anthropic's adds `?beta=true`); the
    // relay forwards it untouched under the declared origin.
    assert.match(request.path ?? "", /^\/v1\/messages(\?|$)/);
    const credential = request.headers["x-api-key"] ?? request.headers.authorization;
    assert.ok(String(credential).includes(secret), "the provider did not receive the real key");
    for (const value of Object.values(request.headers))
      assert.ok(!String(value).includes(placeholder), "the placeholder leaked past the relay");
    assert.ok(relay.observe().accepted >= 1);
  } finally {
    rpc?.close();
    child?.kill("SIGKILL");
    await relay.close();
    await provider.close();
    if (previousTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTls;
    rmSync(work, { recursive: true, force: true });
  }
});
