import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const args of [["login"], ["pi", "list"]]) {
  test(`U1: oma ${args.join(" ")} remains a host interactive engine, not a Resident`, { timeout: 30_000 }, () => {
    const root = mkdtempSync(join(tmpdir(), "oma-interactive-profile-"));
    try {
      const engine = join(root, "engine");
      writeFileSync(engine, `#!${process.execPath}\nconsole.log(JSON.stringify({ argv: process.argv.slice(2), home: process.env.HOME, lang: process.env.LANG, tz: process.env.TZ, user: process.env.USER, sentinel: process.env.OMA_INTERACTIVE_SENTINEL, engineHome: process.env.PI_CODING_AGENT_DIR, cwd: process.cwd() }));\n`, { mode: 0o700 });
      for (const name of ["home", "data", "run", "project"]) mkdirSync(join(root, name));
      const result = spawnSync(process.execPath, [join(process.cwd(), "apps/oma/dist/entry/oma.js"), ...args], {
        cwd: join(root, "project"), encoding: "utf8", timeout: 20_000,
        env: { HOME: join(root, "home"), XDG_DATA_HOME: join(root, "data"), XDG_RUNTIME_DIR: join(root, "run"),
          PATH: "/usr/bin:/bin", OMA_PI_COMMAND: engine, LANG: "human-locale", TZ: "human-zone", USER: "human",
          OMA_INTERACTIVE_SENTINEL: "interactive-only" },
      });
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout.trim());
      assert.deepEqual(report.argv, args[0] === "login" ? [] : ["list"]);
      assert.equal(report.home, join(root, "home")); assert.equal(report.lang, "human-locale");
      assert.equal(report.tz, "human-zone"); assert.equal(report.user, "human");
      assert.equal(report.sentinel, "interactive-only"); assert.equal(report.engineHome, report.cwd);
      assert.ok(report.engineHome.startsWith(join(root, "data", "oma")));
      assert.doesNotMatch(report.engineHome, /\/home\/agent|rootfs|\/\.pi/);
      assert.equal(readdirSync(join(root, "run")).length, 0, "interactive commands started Society runtime");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
