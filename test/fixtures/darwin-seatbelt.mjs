/** Actual Darwin Seatbelt observations; no process-scope or G-FILES oracle.
 * The driver owns this disposable cwd and records all raw failures separately. */
import assert from "node:assert/strict";
import { mkdirSync, realpathSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { prepareSeatbelt } from "@oma/platform-mac/seatbelt";
import { spawnWithPrivateInputs } from "@oma/process/async";
import { withAsyncCleanup } from "@oma/native/cleanup";

assert.equal(process.platform, "darwin", "Seatbelt observations require an actual Darwin kernel");
const mode = process.argv[2], root = realpathSync(process.cwd());
const work = join(root, '한 글자 work " quote'), readonly = join(root, "readonly"), outside = join(root, "outside");
for (const path of [work, readonly, outside]) mkdirSync(path);
const protectedParent = join(work, "protected parent"); mkdirSync(protectedParent);
const credential = join(protectedParent, "credential"); mkdirSync(credential);
const publicFile = join(readonly, "public"), secretFile = join(outside, "secret"), hiddenFile = join(credential, "secret");
writeFileSync(publicFile, "read only original"); writeFileSync(secretFile, "host canary"); writeFileSync(hiddenFile, "nested canary");
symlinkSync(outside, join(work, "alias"));
const node = realpathSync(process.execPath), directory = path => ({ path, kind: "directory" });
const policy = { readable: [directory(readonly)], writable: [directory(work)], denied: [directory(credential)],
  executable: [{ path: node, kind: "file" }], unixSockets: [], machServices: [], environmentKeys: ["HOME", "TMPDIR", "PATH", "LANG"] };
const input = "private stdin remains command input\n";
const env = { HOME: work, TMPDIR: work, PATH: "/usr/bin:/bin", LANG: "C" };
let program, expected;
if (mode === "seatbelt-files") {
  program = `import assert from 'node:assert/strict';
    import {readFileSync,writeFileSync,linkSync,renameSync,unlinkSync} from 'node:fs';
    import {spawnSync} from 'node:child_process';
    const [work,publicFile,secretFile,hiddenFile,protectedParent]=process.argv.slice(1);
    const denied = fn => assert.throws(fn, error => ['EACCES','EPERM'].includes(error.code));
    assert.equal(readFileSync(0,'utf8'),${JSON.stringify(input)});
    assert.equal(readFileSync(publicFile,'utf8'),'read only original');
    writeFileSync(work+'/written','allowed');
    renameSync(work+'/written',work+'/renamed'); unlinkSync(work+'/renamed');
    denied(()=>writeFileSync(publicFile,'must not change'));
    denied(()=>readFileSync(secretFile)); denied(()=>readFileSync(hiddenFile));
    denied(()=>readFileSync(work+'/alias/secret'));
    denied(()=>renameSync(protectedParent,work+'/moved-protected-parent'));
    denied(()=>renameSync(protectedParent+'/credential',work+'/moved-credential'));
    denied(()=>linkSync(publicFile,work+'/writable-hardlink'));
    const inherited=spawnSync(process.execPath,['--input-type=module','-e',
      "import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; assert.throws(()=>readFileSync(process.argv[1]),e=>['EACCES','EPERM'].includes(e.code));",secretFile],
      {env:process.env,encoding:'utf8',timeout:20000});
    assert.equal(inherited.status,0,inherited.stderr); assert.equal(inherited.signal,null);
    console.log(JSON.stringify({writable:true,readonly:true,denied:true,symlinkDenied:true,hardlinkDenied:true,inherited:true,ordinaryRenameUnlink:true,protectedParentPinned:true}));`;
  expected = { writable: true, readonly: true, denied: true, symlinkDenied: true, hardlinkDenied: true, inherited: true,
    ordinaryRenameUnlink: true, protectedParentPinned: true };
} else if (mode === "seatbelt-profile-stream") {
  // Framing failures have independent cases in darwin-seatbelt-faults.mjs.
  policy.readable.push(...Array.from({ length: 5000 }, (_, n) => directory(join(readonly, `profile-entry-${n}-longer-than-the-exec-argument-budget`))));
  program = `import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs';
    assert.equal(readFileSync(0,'utf8'),${JSON.stringify(input)}); console.log(JSON.stringify({stdin:true,profilePipe:true}));`;
  expected = { stdin: true, profilePipe: true };
} else throw new Error(`unknown Seatbelt probe ${mode}`);
const command = { executable: node, argv: ["--input-type=module", "-e", program, work, publicFile, secretFile, hiddenFile, protectedParent],
  cwd: work, env, input, timeoutMs: 45000, stdoutBytes: 65536, stderrBytes: 65536 };
const profileBytes = Buffer.byteLength(prepareSeatbelt(command, policy).profile);
if (mode === "seatbelt-profile-stream") assert.ok(profileBytes > 262144);
// Positive controls belong to the unsandboxed probe owner, never a mock.
assert.equal(readFileSync(secretFile, "utf8"), "host canary");
assert.equal(readFileSync(hiddenFile, "utf8"), "nested canary");
const prepared = prepareSeatbelt(command, policy);
const child = spawnWithPrivateInputs(prepared.command.executable, prepared.command.argv, prepared.command.cwd, prepared.command.env, prepared.privateInputs);
const stdout = [], stderr = [], faults = [];
let bytes = 0;
const closed = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
child.on("error", error => faults.push(error)); child.stdin.on("error", error => faults.push(error));
for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on("data", chunk => {
  bytes += chunk.length;
  if (bytes > 65536) { faults.push(new Error("Seatbelt probe output exceeded its bound")); child.kill("SIGKILL"); }
  else chunks.push(chunk);
});
const timer = setTimeout(() => { faults.push(new Error("Seatbelt probe deadline exceeded")); child.kill("SIGKILL"); }, 45000);
await withAsyncCleanup(async () => {
  child.stdin.end(input);
  const result = await closed;
  assert.deepEqual(faults, []);
  assert.equal(result.code, 0, JSON.stringify({ ...result, stderr: Buffer.concat(stderr).toString() })); assert.equal(result.signal, null);
  assert.deepEqual(JSON.parse(Buffer.concat(stdout).toString()), expected);
}, async () => { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await closed; });
assert.equal(readFileSync(publicFile, "utf8"), "read only original");
assert.equal(readFileSync(secretFile, "utf8"), "host canary");
console.log(JSON.stringify({ case: mode, seatbelt: { ...expected, profileBytes, directChildClosed: true } }));
