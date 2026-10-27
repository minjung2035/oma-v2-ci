/** Schedule actual filesystem changes at publication/launch boundaries. The
 * child still runs the unmodified installer and actual spawnSync/kernel exec. */
import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const config = JSON.parse(fs.readFileSync(process.env.OMA_RESTIC_SETUP_TEST, "utf8"));
const originalSpawn = childProcess.spawnSync, originalSync = fs.fsyncSync;
const observed = { action: config.action, mutations: 0, downloads: 0, execution: null };
const identity = stat => ({ device: String(stat.dev), inode: String(stat.ino) });
let executable;
function replaceTarget() {
  observed.before = identity(fs.lstatSync(config.target, { bigint: true }));
  if (config.action === "unlink") fs.unlinkSync(config.target);
  else {
    fs.renameSync(config.target, config.target + ".verified");
    fs.copyFileSync(config.replacement, config.target);
  }
  observed.after = config.action === "unlink" ? null : identity(fs.lstatSync(config.target, { bigint: true }));
  observed.mutations++;
}

globalThis.fetch = async url => {
  assert.equal(url, config.url);
  assert.ok(config.archive, "an existing installation must not download");
  observed.downloads++;
  return new Response(fs.readFileSync(config.archive));
};
fs.fsyncSync = fd => {
  const result = originalSync(fd);
  if (config.action === "replace-publication" && observed.mutations === 0 && fs.existsSync(config.target)) replaceTarget();
  return result;
};
childProcess.spawnSync = (command, args, options) => {
  if (args?.length !== 1 || args[0] !== "version") return originalSpawn(command, args, options);
  executable = options?.stdio?.[3];
  if (Number.isInteger(executable)) observed.held = identity(fs.fstatSync(executable, { bigint: true }));
  if (config.action === "replace" || config.action === "unlink") replaceTarget();
  if (Number.isInteger(executable)) observed.heldLinksAtLaunch = String(fs.fstatSync(executable, { bigint: true }).nlink);
  if (config.action === "deny-execution") fs.chmodSync(config.target, 0o600);
  const result = originalSpawn(command, args, options);
  observed.execution = { command, status: result.status, signal: result.signal, error: result.error?.code ?? null, stdout: result.stdout };
  return result;
};
syncBuiltinESMExports();
process.on("exit", () => {
  if (Number.isInteger(executable)) {
    try { fs.fstatSync(executable); observed.descriptorClosed = false; }
    catch (error) { observed.descriptorClosed = error.code === "EBADF"; }
  }
  fs.writeFileSync(config.observation, JSON.stringify(observed) + "\n");
});
