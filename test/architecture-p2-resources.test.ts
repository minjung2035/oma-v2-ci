import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { WorkloadBudget, resourceSupport } from "@oma/platform-linux/workload-budget";
import { startProcess } from "@oma/process/async";

test("IMP-B01/B02: native cgroup enforces CPU, memory and tasks before execution; broker stays outside", { timeout: 30000 }, async t => {
  const profile = { version: 1 as const, cpuCores: 0.25, memoryMaxBytes: 128 * 1024 * 1024, swapMaxBytes: 0, tasksMax: 24 };
  const support = resourceSupport(profile);
  if (!support.supported) { t.skip(`native profile unavailable: ${support.reason}`); return; }
  const broker = readFileSync("/proc/self/cgroup", "utf8"), budget = new WorkloadBudget(profile, `oma-resource-test-${process.pid}`);
  t.after(() => budget.close());
  const run = async (program: string) => {
    const lease = budget.acquire()!;
    try {
      const task = startProcess({ executable: "/usr/bin/python3", argv: ["-c", program], env: { PATH: "/usr/bin:/bin" }, timeoutMs: 8000, stdoutBytes: 8192, stderrBytes: 8192 }, { placementFd: lease.placementFd });
      const result = await task.result; await task.closed;
      return { result, events: lease.events(), cpu: readFileSync(`${budget.observation.scope}/cpu.stat`, "utf8"), path: lease.path };
    } finally { lease.close(); }
  };
  const placement = await run("import subprocess; print(open('/proc/self/cgroup').read().strip()); print(subprocess.check_output(['cat','/proc/self/cgroup']).decode().strip())");
  assert.equal(placement.result.exitCode, 0);
  assert.ok(placement.result.stdout.toString().split("\n").filter(Boolean).every(line => line.includes(placement.path.replace('/sys/fs/cgroup',''))));
  const cpu = await run("import time; end=time.monotonic()+1.5\nwhile time.monotonic()<end: pass");
  assert.equal(cpu.result.exitCode, 0); assert.ok(Number(/nr_throttled (\d+)/.exec(cpu.cpu)?.[1]) > 0);
  const memory = await run("x=bytearray(256*1024*1024); print(len(x))");
  assert.ok((memory.events.metrics.memoryPeakBytes ?? 0) > 0);
  assert.ok((cpu.events.metrics.cpuUsageUsec ?? 0) > 0);
  assert.ok((cpu.events.metrics.cpuThrottledPeriods ?? 0) > 0);
  assert.equal(cpu.events.metrics.cpuThrottlingScope, budget.observation.scope);
  assert.ok(memory.events.metrics.observedAtMs > 0);
  assert.ok(memory.events.oomKills > 0, "an OOM is evidenced by the killed scope's counter");
  const tasks = await run("import subprocess\nchildren=[]\ntry:\n for i in range(40): children.append(subprocess.Popen(['sleep','2']))\nexcept OSError: print('task limit observed')\nfinally:\n for p in children: p.terminate()\n for p in children: p.wait()");
  assert.ok(tasks.events.taskLimitHits > 0); assert.match(tasks.result.stdout.toString(), /task limit observed/);
  assert.equal(readFileSync("/proc/self/cgroup", "utf8"), broker);
  assert.equal(existsSync(placement.path), false);
});

test("IMP-B03: an unrepresentable requested CPU profile refuses before launch; omitted limits remain omitted", () => {
  const unsupported = resourceSupport({ version: 1, cpuCores: 0.00001 });
  assert.equal(unsupported.supported, false); assert.ok(unsupported.reason);
  assert.throws(() => new WorkloadBudget({ version: 1, cpuCores: 0.00001 }, "refuse"), { code: "UNSUPPORTED_PROFILE" });
  const budget = new WorkloadBudget({ version: 1, checkWallTimeMs: 1000 }, "no-kernel-budget");
  try { assert.equal(budget.acquire(), undefined); assert.equal(budget.observation.scope, null); assert.equal(budget.observation.effective["memory.max"], undefined); }
  finally { budget.close(); }
});

test("IMP-B05: requested tmpfs ceiling is checked before launch and enforced by the native mount", async () => {
  const budget = new WorkloadBudget({ version: 1, tmpfsMaxBytes: 1024 * 1024 }, "tmpfs-limit");
  try {
    assert.equal(budget.observation.supported, true);
    const task = startProcess(budget.command({ executable: "/usr/bin/bwrap", argv: ["--unshare-user", "--unshare-pid", "--unshare-net",
      "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--", "/usr/bin/python3", "-c",
      "import os,errno\ns=os.statvfs('/tmp');print(s.f_blocks*s.f_frsize)\ntry:\n with open('/tmp/fill','wb') as f:f.write(b'x'*(2*1024*1024))\nexcept OSError as e:\n assert e.errno==errno.ENOSPC;print('limited')\nelse:raise Exception('limit absent')"],
      env: { PATH: "/usr/bin:/bin" }, timeoutMs: 10000, stdoutBytes: 1024, stderrBytes: 4096 }));
    const result = await task.result; await task.closed;
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.match(result.stdout.toString(), /^1048576\nlimited\n$/);
  } finally { budget.close(); }
});
