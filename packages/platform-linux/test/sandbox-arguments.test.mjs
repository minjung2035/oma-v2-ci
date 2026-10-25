/** DR27/SB-001: environment values never appear in bubblewrap's native argv. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { spawnSandboxed } from "@oma/platform-linux/worker-spawn";
import { sandboxSeccompFilter } from "@oma/platform-linux/sandbox-seccomp";
for (const filtered of [false, true])
    test(`DR27: private sandbox arguments preserve exact values and RPC stdin (filter=${filtered})`, { timeout: 15_000 }, async (t) => {
        const value = 'synthetic-placeholder \n" --unshare-net 한글';
        const program = `process.stdout.write(JSON.stringify({value:process.env.FIXTURE_VALUE,empty:process.env.EMPTY_VALUE,boundary:process.env.BOUNDARY_VALUE,filter:process.env.FILTER_VALUE,args:process.env.ARGS_VALUE,argv:process.argv.slice(1)})+'\\n');
    process.stdin.once('data', b=>{process.stdout.write(b); process.exit(0);});`;
        const child = spawnSandboxed(["/usr/bin/bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc",
            "--unshare-net", "--unshare-pid", "--die-with-parent", "--clearenv", "--setenv", "FIXTURE_VALUE", value,
            "--setenv", "EMPTY_VALUE", "", "--setenv", "BOUNDARY_VALUE", "--",
            "--setenv", "FILTER_VALUE", "--seccomp", "--setenv", "ARGS_VALUE", "--args", ...(filtered ? ["--seccomp", "3"] : []), "--", process.execPath, "-e", program, "--", "--", "--seccomp", "--args"], {}, filtered ? sandboxSeccompFilter() : undefined);
        const closed = once(child, "close");
        t.after(async () => { if (child.exitCode === null)
            child.kill("SIGKILL"); await closed; });
        let stdout = "", stderr = "";
        const ready = new Promise(resolve => { child.stdout.on("data", b => { stdout += String(b); if (stdout.includes("\n"))
            resolve(); }); });
        child.stderr.on("data", b => { stderr += String(b); });
        await Promise.race([ready, closed.then(() => { assert.fail(`sandbox exited before its report: ${stderr}`); })]);
        assert.deepEqual(JSON.parse(stdout.split("\n")[0]), { value, empty: "", boundary: "--", filter: "--seccomp", args: "--args", argv: ["--", "--seccomp", "--args"] });
        assert.deepEqual(child.spawnargs.slice(0, 4), ["/usr/bin/bwrap", "--args", "5", "--"]);
        assert.ok(!child.spawnargs.includes(value));
        assert.ok(!child.spawnargs.includes("--setenv"));
        // Only this fixture's owned process is inspected; no argv or environment is printed.
        const native = readFileSync(`/proc/${child.pid}/cmdline`).toString("utf8").split("\0");
        assert.ok(!native.includes(value));
        assert.ok(!native.includes("--setenv"));
        child.stdin.end("rpc-input\n");
        const [code] = await closed;
        assert.equal(code, 0, stderr);
        assert.equal(stdout.split("\n").slice(1).join("\n"), "rpc-input\n");
    });
test("DR27: malformed private argument ownership is refused before spawn", () => {
    assert.throws(() => spawnSandboxed(["bwrap", "--args", "9", "--", "/bin/true"], {}), /descriptor owner/);
    assert.throws(() => spawnSandboxed(["bwrap", "--seccomp", "5", "--", "/bin/true"], {}, sandboxSeccompFilter()), /seccomp 3/);
    assert.throws(() => spawnSandboxed(["bwrap", "--setenv", "X", "a\0b", "--", "/bin/true"], {}), /NUL-free/);
    assert.throws(() => spawnSandboxed(["bwrap", "--ro-bind", "/", "/"], {}), /command boundary/);
    assert.throws(() => spawnSandboxed(["bwrap", "--setenv", "X"], {}), /option arguments/);
    assert.throws(() => spawnSandboxed(["bwrap", "--", ""], {}), /command boundary/);
    assert.throws(() => spawnSandboxed(["bwrap", "--unknown", "--", "/bin/true"], {}), /unsupported sandbox option/);
    assert.throws(() => spawnSandboxed(["bwrap", "--setenv", "X", "--seccomp", "--", "/bin/true"], {}, sandboxSeccompFilter()), /seccomp 3/);
    assert.throws(() => spawnSandboxed(["bwrap", "--seccomp", "3", "--seccomp", "3", "--", "/bin/true"], {}, sandboxSeccompFilter()), /seccomp 3/);
});
test("DR27: bubblewrap refusing before reading all private bytes reports an exit, not an unhandled socket error", { timeout: 10_000 }, async (t) => {
    const child = spawnSandboxed(["bwrap", "--size", "invalid-size", "--setenv", "FIXTURE_VALUE", "x".repeat(256 * 1024),
        "--seccomp", "3", "--", "/bin/true"], {}, sandboxSeccompFilter());
    const closed = once(child, "close");
    t.after(async () => { if (child.exitCode === null)
        child.kill("SIGKILL"); await closed; });
    child.stdout.resume();
    child.stderr.resume();
    const [code] = await closed;
    assert.notEqual(code, 0);
});
