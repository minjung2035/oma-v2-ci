import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
/** Current production namespace recipe; no external provider or internet probe. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { planPiSpawn } from "@oma/engine/pi-spawn-plan";
import { residentOptions, prepareResident } from "../dist/test/fixtures/resident.js";
import { spawnSandboxed } from "@oma/platform-linux/worker-spawn";
import { stopOwnedChild } from "@oma/process/async";
const supported = process.platform === "linux" && spawnSync("/usr/bin/bwrap", ["--version"]).status === 0;

test("DR46: the production sandbox hides host files and shares the host network; an unshared control cannot receive its marker", {
  skip: supported ? false : "NOT_RUN: requires Linux and pinned bubblewrap", timeout: 60000,
}, async () => {
  const work = mkdtempSync(join(tmpdir(), "oma-current-namespace-"));
  const state = join(work, "state"), libdir = join(work, "installation"), entry = join(libdir, "probe.mjs");
  const marker = randomUUID(), clients = new Set();
  const server = createServer(socket => {
    clients.add(socket); socket.on("error", () => {}); socket.once("close", () => clients.delete(socket)); socket.end(marker);
  });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const port = server.address().port;
    const options = residentOptions(state, libdir, entry);
    mkdirSync(join(state, "pi"), { recursive: true });
    writeFileSync(join(state, "pi/auth.json"), '{"secret":"host-only"}');
    for (const file of [options.paths.coreExtension, options.paths.cli]) {
      mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, "export {};\n");
    }
    writeFileSync(entry, `import fs from "node:fs"; import net from "node:net"; import os from "node:os";
      const seen = p => { try { fs.accessSync(p); return true; } catch { return false; } };
      const report = { stateRoot: seen(${JSON.stringify(state)}), credential: seen(${JSON.stringify(join(state, "pi/auth.json"))}),
        home: seen(${JSON.stringify(process.env.HOME ?? "/home")}), user: os.userInfo().username,
        writableRoot: (() => { try { fs.writeFileSync("/x", "x"); return true; } catch { return false; } })() };
      let finished = false; const socket = net.connect({host:"127.0.0.1", port:${port}});
      const finish = result => { if (finished) return; finished = true; report.loopback = result;
        socket.destroy(); process.stdout.write(JSON.stringify(report)+"\\n", () => process.exit(0)); };
      socket.setTimeout(3000, () => finish("timeout")); socket.once("data", bytes => finish(bytes.toString()));
      socket.once("error", error => finish(error.code));`);
    prepareResident(options);
    const plan = planPiSpawn(residentEngineEffects.sandbox, options);
    assert.ok(plan.args.includes("--share-net"));
    for (const shared of [true, false]) {
      const args = shared ? plan.args : plan.args.filter(value => value !== "--share-net");
      const child = spawnSandboxed([plan.command, ...args], plan.env, plan.input, plan.cwd);
      let stdout = "", stderr = "", error;
      const closed = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
      child.once("error", value => { error = value; });
      child.stdout.on("data", bytes => { stdout += bytes; }); child.stderr.on("data", bytes => { stderr += bytes; });
      const alarm = setTimeout(() => stopOwnedChild(child), 10000);
      try {
        const result = await closed;
        assert.equal(error, undefined); assert.equal(result.signal, null, stderr); assert.equal(result.code, 0, stderr);
        const report = JSON.parse(stdout.trim());
        for (const name of ["stateRoot", "credential", "home", "writableRoot"]) assert.equal(report[name], false, name);
        assert.equal(report.user, "agent");
        if (shared) assert.equal(report.loopback, marker);
        else assert.ok(["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"].includes(report.loopback), JSON.stringify(report));
      } finally { clearTimeout(alarm); stopOwnedChild(child); await closed; }
    }
  } finally {
    for (const socket of clients) socket.destroy();
    await new Promise(resolve => server.close(() => resolve()));
    rmSync(work, { recursive: true, force: true });
  }
});
