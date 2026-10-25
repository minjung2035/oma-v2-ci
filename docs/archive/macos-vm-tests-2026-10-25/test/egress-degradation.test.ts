/** DR18/P0V-114: a configured Principal egress that cannot open is a start
 * failure, not a degradable notice. In the macOS guest the engine has no
 * other provider path (MAC-701 keeps the credential on the host), so
 * `adoptPrincipalEgress` propagates the open failure rather than returning
 * null and letting an engine start that can only fail against it. An
 * unconfigured environment still answers null -- no service was promised --
 * and the tenure's `hold` contract still decides adoption. A fake egress
 * service speaks the real placeholder frame protocol.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:net";
import { adoptPrincipalEgress, EGRESS_SOCKET_ENV, type EgressTenure, type PrincipalEgress } from "#oma-test/app/runtime/egress-forwarder";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { StoreError } from "@oma/domain/errors";
import { removeTree } from "./fixtures/cleanup.js";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-egress-"));
  t.after(() => removeTree(root));
  const holdings: { close(): Promise<void> }[] = [];
  const owner = (held = true): EgressTenure & { holdings: typeof holdings } => ({
    holdings,
    async hold(holding) { if (!held) { await holding.close(); return false; } holdings.push(holding); return true; },
  });
  const options = (env: Record<string, string | undefined>) => ({
    society: "demo", runRoot: root, provider: "anthropic", model: "claude",
    modelProfile: "default", frameBytes: 262144, deadlineMs: 5000, inferenceSeconds: 300, env,
  });
  return { root, owner, options };
}

/** A fake guest egress service: one placeholder frame in, one answer out;
 * the connection stays open as the run's lease until released. */
function fakeEgress(t: TestContext, root: string, answer: (request: { id?: string }) => Record<string, unknown>) {
  const socket = join(root, "egress.sock");
  const connections = new Set<import("node:net").Socket>();
  const server: Server = createServer(connection => {
    connections.add(connection);
    connection.once("close", () => connections.delete(connection));
    const parser = new FrameParser(262144);
    connection.on("data", (chunk: Buffer) => {
      for (const frame of parser.feed(chunk))
        connection.write(encodeFrame(answer(frame.raw as { id?: string })));
    });
  });
  t.after(async () => {
    for (const connection of connections) connection.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, () => resolve(socket));
  });
}

const PLACEHOLDER = { placeholderId: randomUUID(), placeholder: "placeholder-token-0123456789abcdef", provider: "anthropic", model: "claude" };

test("egress degradation: an environment naming no egress socket answers null and holds nothing", async t => {
  const f = fixture(t);
  const owner = f.owner();
  const adopted = await adoptPrincipalEgress(owner, f.options({}));
  assert.equal(adopted, null, "Linux distribution: no service was ever promised");
  assert.equal(owner.holdings.length, 0);
});

test("egress degradation: a configured egress that does not answer propagates, never a silent null", async t => {
  const f = fixture(t);
  const owner = f.owner();
  await assert.rejects(
    adoptPrincipalEgress(owner, f.options({ [EGRESS_SOCKET_ENV]: join(f.root, "absent-egress.sock") })),
    (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE",
    "the socket the deployment named is absent: the failure reaches the start path",
  );
  assert.equal(owner.holdings.length, 0, "nothing was adopted or leaked");
});

test("egress degradation: the host's refusal propagates its own code", async t => {
  const f = fixture(t);
  const socket = await fakeEgress(t, f.root, request => ({ v: 1, id: request.id,
    ok: false, error: { code: "UNSUPPORTED_PROFILE", message: "the host issues no placeholder for this profile" } }));
  await assert.rejects(
    adoptPrincipalEgress(f.owner(), f.options({ [EGRESS_SOCKET_ENV]: socket })),
    (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE",
    "a profile refusal is not rounded down to a notice either",
  );
});

test("egress degradation: an opened egress is adopted as the tenure's holding", async t => {
  const f = fixture(t);
  const socket = await fakeEgress(t, f.root, request => ({ v: 1, id: request.id, ok: true, result: PLACEHOLDER }));
  const owner = f.owner();
  const adopted = await adoptPrincipalEgress(owner, f.options({ [EGRESS_SOCKET_ENV]: socket }));
  assert.notEqual(adopted, null);
  const egress: PrincipalEgress = adopted!;
  assert.equal(owner.holdings.length, 1, "the tenure holds the forwarder it paid for");
  assert.equal(owner.holdings[0], egress);
  assert.equal(egress.env.OMA_INFERENCE_PROVIDER, "anthropic");
  assert.equal(egress.env.OMA_INFERENCE_SOCKET, join(f.root, "principal-inference.sock"));
  await egress.close();
});

test("egress degradation: a tenure that ended while the egress opened adopts nothing", async t => {
  const f = fixture(t);
  const socket = await fakeEgress(t, f.root, request => ({ v: 1, id: request.id, ok: true, result: PLACEHOLDER }));
  const adopted = await adoptPrincipalEgress(f.owner(false), f.options({ [EGRESS_SOCKET_ENV]: socket }));
  assert.equal(adopted, null, "hold() closes what a dead tenure cannot keep");
});

test("egress degradation: the forwarder's post-listen error journal rides through adoption to the host's seam", async t => {
  const f = fixture(t);
  const socket = await fakeEgress(t, f.root, request => ({ v: 1, id: request.id, ok: true, result: PLACEHOLDER }));
  const reported: string[] = [];
  const adopted = await adoptPrincipalEgress(f.owner(),
    { ...f.options({ [EGRESS_SOCKET_ENV]: socket }), onError: error => { reported.push(error.message); } });
  assert.notEqual(adopted, null, "the journal seam is accepted through adoption");
  await adopted!.close();
  assert.equal(reported.length, 0, "a quiet forwarder does not invent reports");
});
