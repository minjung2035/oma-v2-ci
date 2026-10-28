// Investigation-only preload; remove after locating the native startup wait.
// Node's experimental built-in channel is diagnostic, never process/role authority.
// https://nodejs.org/api/diagnostics_channel.html#process
import { subscribe } from "node:diagnostics_channel";

const children = new Map();
subscribe("child_process", ({ process: child }) => {
  const stack = new Error("Personal child creation").stack;
  child.once("spawn", () => children.set(child, {
    pid: child.pid, executable: child.spawnfile, stack,
  }));
  child.once("exit", () => children.delete(child));
});
setTimeout(() => {
  process.stderr.write(JSON.stringify({ personalStartupWait: {
    pid: process.pid, entry: process.argv[1],
    resources: process.getActiveResourcesInfo(), children: [...children.values()],
  } }) + "\n");
}, 18000).unref();
