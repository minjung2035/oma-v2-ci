import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export async function runBoundedScript(entry, args, { timeoutMs = 300000, stopMs = 5000 } = {}) {
  if (![timeoutMs, stopMs].every(value => Number.isSafeInteger(value) && value > 0))
    throw new TypeError("script lifetime requires positive bounded deadlines");
  const group = process.platform !== "win32";
  const child = spawn(process.execPath, [entry, ...args], { stdio: "inherit", detached: group, shell: false });
  let exited = false, closed = false, failure, drainTimer;
  let resolveClose, rejectClose;
  const closure = new Promise((resolve, reject) => { resolveClose = resolve; rejectClose = reject; });
  const stop = reason => {
    failure ??= reason;
    if (!exited && child.pid !== undefined) {
      try { if (group) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") failure = new AggregateError([failure, error], "Script termination failed"); }
    }
    drainTimer ??= setTimeout(() => {
      child.unref(); rejectClose(new Error("Script child termination is unconfirmed"));
    }, stopMs);
  };
  const onError = error => stop(error);
  const onExit = () => { exited = true; };
  const onClose = (code, signal) => { closed = true; resolveClose({ code, signal }); };
  const onTerm = () => stop(new Error("Script interrupted by SIGTERM"));
  const onInt = () => stop(new Error("Script interrupted by SIGINT"));
  child.once("error", onError); child.once("exit", onExit); child.once("close", onClose);
  process.once("SIGTERM", onTerm); process.once("SIGINT", onInt);
  const timer = setTimeout(() => stop(new Error("Script exceeded its bounded lifetime")), timeoutMs);
  try {
    const result = await closure;
    if (failure) throw failure;
    if (result.signal !== null || result.code === null) throw new Error("Script did not exit normally");
    return result.code;
  } finally {
    clearTimeout(timer); clearTimeout(drainTimer);
    process.off("SIGTERM", onTerm); process.off("SIGINT", onInt);
    if (closed) { child.off("error", onError); child.off("exit", onExit); child.off("close", onClose); }
  }
}

export async function enterBoundedScript(url, options) {
  const entry = fileURLToPath(url), marker = `--owned-functional-script=${entry}`;
  if (process.argv.at(-1) === marker) { process.argv.pop(); return true; }
  process.exitCode = await runBoundedScript(entry, [...process.argv.slice(2), marker], options);
  return false;
}
