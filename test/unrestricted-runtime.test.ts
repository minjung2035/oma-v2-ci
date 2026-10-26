import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { createSocket } from "node:dgram";
import { ConnectProxy, makePublicDial } from "#oma-test/app/runtime/connect-proxy";
import { readPackageIndex, encodePackageIndex, PACKAGE_INDEX } from "#oma-test/app/runtime/packages/store";
import { createContainedWriter } from "@oma/tool-runtime/contained-tools";
import { planPiSpawn } from "@oma/engine/pi-spawn-plan";
import { spawnSandboxed } from "@oma/platform-linux/worker-spawn";
import { residentOptions, prepareResident, RESIDENT_TEST_OPTIONS } from "./fixtures/resident.js";
import { RESIDENT_PATHS } from "@oma/domain/resident-paths";

test("DR37: concurrent writes preserve complete bytes and ordinary tree names", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-no-quota-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = createContainedWriter(root);
  await Promise.all([write("a", "x".repeat(2 << 20)), write("dist/source.ts", "authored")]);
  assert.equal(readFileSync(join(root, "a")).length, 2 << 20);
  assert.equal(readFileSync(join(root, "dist/source.ts"), "utf8"), "authored");
});

test("DR37: HTTP and more than four CONNECTs reach literal loopback on arbitrary ports", { timeout: 15000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-open-network-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const server = createServer((req, res) => { assert.equal(req.headers["proxy-authorization"], undefined); res.end(`${req.method}:${req.url}:${req.headers.authorization ?? ""}`); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  t.after(() => { server.closeAllConnections(); server.close(); });
  const proxy = await ConnectProxy.open({ socketPath: join(root, "p.sock"),
    actor: "alice", dial: makePublicDial() });
  t.after(() => proxy.close());
  const answer = await new Promise<string>((resolve, reject) => {
    request({ socketPath: proxy.socketPath, path: `http://127.0.0.1:${port}/hello?q=private`,
      headers: { Authorization: "destination-token", "Proxy-Authorization": "proxy-token" } }, res => {
      let body = ""; res.setEncoding("utf8"); res.on("data", chunk => { body += chunk; }); res.on("end", () => resolve(body));
    }).on("error", reject).end();
  });
  assert.equal(answer, "GET:/hello?q=private:destination-token");
  const sockets = await Promise.all(Array.from({ length: 12 }, async () => {
    const socket = connect(proxy.socketPath); t.after(() => socket.destroy()); await once(socket, "connect");
    socket.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
    const [bytes] = await once(socket, "data"); assert.match(String(bytes), /200 Connection Established/); return socket;
  }));
  assert.equal(proxy.activeTunnels, 12); assert.equal(proxy.queuedTunnels, 0);
  for (const socket of sockets) socket.destroy();
});

test("DR37: two actual confined Workers reach host TCP and UDP concurrently", RESIDENT_TEST_OPTIONS, async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-sandbox-network-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tcp = createServer((_req, res) => res.end("tcp-ok")); tcp.listen(0, "127.0.0.1"); await once(tcp, "listening");
  t.after(() => { tcp.closeAllConnections(); tcp.close(); });
  const udp = createSocket("udp4"); udp.bind(0, "127.0.0.1"); await once(udp, "listening");
  udp.on("message", (_msg, peer) => { udp.send("udp-ok", peer.port, peer.address); }); t.after(() => udp.close());
  const opts = residentOptions(join(root, "state"), process.cwd(), join(process.cwd(), "apps/oma/dist/entry/oma.js"));
  prepareResident(opts);
  const plan = planPiSpawn(residentEngineEffects.sandbox, { ...opts, profile: { ...opts.profile } }), at = plan.args.indexOf("--");
  const code = `const {createSocket}=await import('node:dgram');const r=await fetch('http://127.0.0.1:${(tcp.address() as { port: number }).port}/');console.log(await r.text());const s=createSocket('udp4');s.on('message',m=>{console.log(m.toString());s.close()});s.send('ping',${udp.address().port},'127.0.0.1');`;
  await Promise.all(Array.from({ length: 2 }, async () => {
    const child = spawnSandboxed([plan.command, ...plan.args.slice(0, at + 1), RESIDENT_PATHS.node, "--input-type=module", "-e", code], plan.env, plan.input);
    let out = "", err = ""; child.stdout.on("data", b => { out += String(b); }); child.stderr.on("data", b => { err += String(b); });
    const [exit] = await once(child, "close"); assert.equal(exit, 0, err); assert.match(out, /tcp-ok/); assert.match(out, /udp-ok/);
  }));
});

test("Native package reads leave retired generation trees and import evidence unchanged", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-retired-packages-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const retired = join(root, ".packages-generations", `p-${"a".repeat(64)}`);
  mkdirSync(retired, { recursive: true });
  const evidence = join(retired, "import.json"), bytes = '{"source":"retired-vm"}';
  writeFileSync(evidence, bytes);
  const current = join(root, ".packages"); mkdirSync(current);
  writeFileSync(join(current, PACKAGE_INDEX), encodePackageIndex([]));
  assert.deepEqual(readPackageIndex(current), []);
  assert.equal(readFileSync(evidence, "utf8"), bytes);
});
