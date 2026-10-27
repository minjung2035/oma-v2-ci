/** Independent real-Darwin failure/positive controls. Fixture-owned files and
 * children only; none of these observations proves arbitrary-descendant death,
 * exact executable binding or complete actor authorization. */
import assert from "node:assert/strict";
import { closeSync, constants, createWriteStream, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer, connect } from "node:net";
import { finished } from "node:stream/promises";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { prepareSeatbelt, bundledSeatbeltHelper } from "@oma/platform-mac/seatbelt";
import { controlPipe } from "@oma/native/control-socket";
import { cleanupAll, withAsyncCleanup } from "@oma/native/cleanup";
import { startProcess, spawnWithPrivateInputs } from "@oma/process/async";

assert.equal(process.platform, "darwin", "Seatbelt fault controls require a real Darwin kernel");
const mode = process.argv[2], root = realpathSync(process.cwd());
const work = join(root, '한 글자 " quote\\slash'); mkdirSync(work);
const marker = join(work, "executed"), node = realpathSync(process.execPath);
const policy = { readable: [], writable: [{ path: work, kind: "directory" }], denied: [],
  executable: [{ path: node, kind: "file" }], unixSockets: [], machServices: [], environmentKeys: ["HOME", "TMPDIR", "PATH", "LANG"] };
const env = { HOME: work, TMPDIR: work, PATH: "/usr/bin:/bin", LANG: "C" };
const target = { executable: node, argv: ["--input-type=module", "-e",
  "import {writeFileSync} from 'node:fs'; writeFileSync(process.argv[1],'executed');", marker],
  cwd: work, env, timeoutMs: 20000, stdoutBytes: 65536, stderrBytes: 65536 };
const prepared = prepareSeatbelt(target, policy), original = Buffer.from(prepared.privateInputs[0].bytes);
assert.equal(original.subarray(0, 8).toString(), "OMASBPL1");
assert.equal(original.readBigUInt64BE(8), BigInt(original.length - 16));
function frame(payload) {
  const bytes = Buffer.from(payload), header = Buffer.from(original.subarray(0, 16));
  header.writeBigUInt64BE(BigInt(bytes.length), 8); return Buffer.concat([header, bytes]);
}
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function raw(command, bytes, extraFds = [], profileOnStdin = false) {
  const pipe = controlPipe(); let read = pipe.read, write = pipe.write, writer, task;
  return withAsyncCleanup(async () => {
    writer = createWriteStream("", { fd: write, autoClose: true }); write = undefined;
    const returned = finished(writer, { cleanup: true }).then(() => undefined, error => error);
    task = startProcess(profileOnStdin ? { ...command, input: undefined, stdinFd: read } : command,
      { inheritedFds: profileOnStdin ? extraFds : [read, ...extraFds] });
    const fd = read; read = undefined; closeSync(fd);
    writer.end(bytes);
    const result = await task.result;
    await task.closed;
    const failure = await returned;
    // An expected early refusal may stop reading the pipe; unrelated write
    // failures must remain visible instead of certifying the tested refusal.
    if (failure !== undefined && failure.code !== "EPIPE") throw failure;
    assert.equal(result.kind, "exited", JSON.stringify(result));
    assert.equal(result.signal, null); assert.equal(result.stdoutTruncated, false); assert.equal(result.stderrTruncated, false);
    return result;
  }, async () => {
    task?.cancel(); writer?.destroy();
    try { cleanupAll([
      () => { if (read !== undefined) closeSync(read); },
      () => { if (write !== undefined) closeSync(write); },
    ]); } finally { await Promise.all([task?.closed, writer === undefined ? undefined : finished(writer, { cleanup: true }).catch(() => {})]); }
  });
}
async function good(command, selectedPolicy) {
  const recipe = prepareSeatbelt(command, selectedPolicy);
  const child = spawnWithPrivateInputs(recipe.command.executable, recipe.command.argv, recipe.command.cwd, recipe.command.env, recipe.privateInputs);
  const chunks = [[], []], faults = []; let bytes = 0;
  const closed = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  child.on("error", error => faults.push(error)); child.stdin.on("error", error => faults.push(error));
  for (const [i, stream] of [child.stdout, child.stderr].entries()) stream.on("data", value => {
    bytes += value.length;
    if (bytes > 65536) { faults.push(new Error("probe output exceeded its bound")); child.kill("SIGKILL"); }
    else chunks[i].push(value);
  });
  const timer = setTimeout(() => { faults.push(new Error("probe deadline exceeded")); child.kill("SIGKILL"); }, 30000);
  return withAsyncCleanup(async () => {
    child.stdin.end(command.input ?? ""); const status = await closed;
    assert.deepEqual(faults, []); assert.equal(status.code, 0, Buffer.concat(chunks[1]).toString()); assert.equal(status.signal, null);
    return Buffer.concat(chunks[0]).toString();
  }, async () => { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await closed; });
}
async function framing() {
  const wrongMagic = Buffer.from(original); wrongMagic[0] ^= 0xff;
  const overflow = Buffer.from(original.subarray(0, 16)); overflow.writeBigUInt64BE(0xffffffffffffffffn, 8);
  const options = {
    "seatbelt-profile-header": [original.subarray(0, 15), /profile is truncated/],
    "seatbelt-profile-magic": [wrongMagic, /profile framing is invalid/],
    "seatbelt-profile-overflow": [overflow, /profile size/],
    "seatbelt-profile-truncated": [original.subarray(0, original.length - 1), /profile is truncated/],
    "seatbelt-profile-trailing": [Buffer.concat([original, Buffer.from("x")]), /profile has trailing bytes/],
    "seatbelt-profile-nul": [frame(Buffer.from("(version 1)\n(deny default)\0(allow default)\n")), /profile contains NUL/],
    "seatbelt-profile-empty": [frame(Buffer.alloc(0)), /profile size/],
    "seatbelt-profile-syntax": [frame("(version 1)\n(oma-invalid-operation-for-fixture)\n"), /Seatbelt apply failed/],
  };
  const [bytes, error] = options[mode];
  const result = await raw(prepared.command, bytes);
  assert.equal(result.exitCode, 125, result.stderr.toString()); assert.match(result.stderr.toString(), error);
  assert.equal(existsSync(marker), false, "a refused profile must never execute its target");
  // A separate real positive execution rules out a merely broken launcher.
  const positive = await raw(prepared.command, original);
  assert.equal(positive.exitCode, 0, positive.stderr.toString()); assert.equal(readFileSync(marker, "utf8"), "executed");
  return { refusedBeforeExec: true, positiveTargetExecuted: true, directChildrenClosed: true, frameSha256: digest(bytes) };
}
async function argvAndEnvironment() {
  const args = ["한 글자", 'quote";$(literal)', "\\backslash", "line\nbreak", "--not-a-node-option"];
  process.env.OMA_AMBIENT_CANARY = "fixture-only-must-not-inherit";
  const command = { ...target, input: "stdin has its own stream\n", argv: ["--input-type=module", "-e",
    `import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs';
     assert.deepEqual(process.argv.slice(1),${JSON.stringify(args)});
     assert.equal(process.env.OMA_AMBIENT_CANARY,undefined);
     assert.equal(readFileSync(0,'utf8'),'stdin has its own stream\\n'); console.log('verified');`, "--", ...args] };
  assert.equal((await good(command, policy)).trim(), "verified");
  return { literalArgv: true, ambientEnvAbsent: true, independentStdin: true, directChildClosed: true };
}
async function trustedPreload() {
  const installation = join(root, 'trusted readonly " 설치'), preload = join(installation, 'preload.mjs'), secret = join(root, 'host-secret');
  mkdirSync(installation); writeFileSync(secret, 'fixture host canary');
  writeFileSync(join(installation, 'package.json'), '{"type":"module"}');
  writeFileSync(preload, `import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs';
    assert.throws(()=>readFileSync(${JSON.stringify(secret)}),e=>['EACCES','EPERM'].includes(e.code));
    globalThis[Symbol.for('oma.fixture.preload')]='sandbox already applied';`);
  assert.equal(readFileSync(secret, 'utf8'), 'fixture host canary');
  const selected = { ...policy, readable: [{ path: installation, kind: 'directory' }],
    environmentKeys: [...policy.environmentKeys, 'NODE_OPTIONS'], nodePreload: preload };
  const command = { ...target, env: { ...env, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` },
    argv: ['--input-type=module','-e',`import assert from 'node:assert/strict';
      assert.equal(globalThis[Symbol.for('oma.fixture.preload')],'sandbox already applied'); console.log('verified');`] };
  assert.equal((await good(command, selected)).trim(), 'verified');
  return { readonlyPreloadExecuted: true, preloadHostReadDenied: true, ownerReadPositive: true, directChildClosed: true };
}
async function stdinProfile() {
  async function execute(command) {
    const task = startProcess(command);
    return withAsyncCleanup(async () => {
      const result = await task.result; await task.closed;
      assert.equal(result.kind, 'exited', JSON.stringify(result));
      assert.equal(result.signal, null); assert.equal(result.stdoutTruncated, false); assert.equal(result.stderrTruncated, false);
      return result;
    }, async () => { task.cancel(); await task.closed; });
  }
  const selected = {...policy,profileInput:'stdin'};
  const command = {...target,argv:['--input-type=module','-e',
    `import assert from 'node:assert/strict'; import {readFileSync,fstatSync} from 'node:fs';
     assert.equal(fstatSync(0).isCharacterDevice(),true); assert.equal(readFileSync(0,'utf8'),''); console.log('empty target stdin');`]};
  const recipe = prepareSeatbelt(command,selected);
  assert.deepEqual(recipe.privateInputs,[]);
  const positive = await execute(recipe.command);
  assert.equal(positive.exitCode,0,positive.stderr.toString()); assert.equal(positive.stdout.toString(),'empty target stdin\n');
  const writesMarker = prepareSeatbelt(target,selected), bytes = Buffer.from(writesMarker.command.input);
  const badMagic = Buffer.from(bytes); badMagic[0] ^= 0xff;
  for (const [input,error] of [[badMagic,/framing is invalid/], [bytes.subarray(0,15),/profile is truncated/],
    [bytes.subarray(0,bytes.length-1),/profile is truncated/], [Buffer.concat([bytes,Buffer.from('x')]),/trailing bytes/],
    [frame('(version 1)\n(deny default)\0'),/contains NUL/], [frame('(version 1)\n(oma-invalid-operation-for-fixture)\n'),/apply failed/]]) {
    // Feed negative frames through a real owned pipe so expected early EPIPE
    // belongs to this fixture writer, not an unobserved positive command.
    const result = await raw(writesMarker.command,input,[],true);
    assert.equal(result.exitCode,125,result.stderr.toString()); assert.match(result.stderr.toString(),error);
    assert.equal(existsSync(marker),false,'an invalid stdin profile must not execute its target');
  }
  for (const options of [['--profile-stdin','--profile-stdin'],['--profile-stdin','--keep-fds=6','--keep-fds=8'],['--unknown-launch-option']]) {
    const result = await raw({...writesMarker.command,argv:[...options,target.executable,...target.argv]},bytes,[],true);
    assert.equal(result.exitCode,125); assert.match(result.stderr.toString(),/option is invalid or repeated/);
    assert.equal(existsSync(marker),false);
  }
  const final = await execute(writesMarker.command);
  assert.equal(final.exitCode,0,final.stderr.toString()); assert.equal(readFileSync(marker,'utf8'),'executed');
  return {ordinaryInputOwner:true,targetStdinIsDevNull:true,framingFaultsRefusedBeforeExec:true,
    duplicateOptionsRefused:true,positiveTargetExecuted:true,directChildrenClosed:true};
}
async function fdClosure() {
  const actorSource = fileURLToPath(new URL("./darwin-fd-observer.c", import.meta.url)), actor = join(work, "fd-observer");
  const helperRoot = dirname(bundledSeatbeltHelper());
  const helperSource = readFileSync(join(helperRoot, "main.c"), "utf8");
  const helperHeader = readFileSync(join(helperRoot, "launch-fds.h"), "utf8");
  const mutantRoot = join(work, "leaky-helper"); mkdirSync(mutantRoot);
  const mutantSource = join(mutantRoot, "main.c"), mutant = join(mutantRoot, "intentionally-leaky");
  writeFileSync(mutantSource, helperSource);
  writeFileSync(join(mutantRoot, "launch-fds.h"), helperHeader.replace("close(fd)", "0 /* explicit negative control: inherited FD retained */"));
  for (const [source, output, extra] of [[actorSource, actor, []], [mutantSource, mutant, ["-lsandbox", "-lproc"]]]) {
    const compiled = spawnSync("/usr/bin/xcrun", ["clang", "-Wall", "-Wextra", "-Werror", "-I", dirname(bundledSeatbeltHelper()), source, ...extra, "-o", output],
      { encoding: "utf8", timeout: 30000, killSignal: "SIGKILL", maxBuffer: 65536 });
    assert.equal(compiled.error, undefined); assert.equal(compiled.signal, null); assert.equal(compiled.status, 0, compiled.stderr);
  }
  const canary = join(root, "descriptor-canary"); writeFileSync(canary, "fixture canary");
  const held = openSync(canary, constants.O_RDONLY), info = fstatSync(held, { bigint: true });
  return withAsyncCleanup(async () => {
    const selected = { ...policy, readable: [{ path: canary, kind: "file" }], executable: [{ path: actor, kind: "file" }] };
    const recipe = prepareSeatbelt({ ...target, executable: actor, argv: [String(info.dev), String(info.ino)] }, selected);
    const negative = await raw({ ...recipe.command, executable: mutant }, Buffer.from(recipe.privateInputs[0].bytes), [held]);
    assert.equal(negative.exitCode, 3, negative.stderr.toString()); assert.equal(JSON.parse(negative.stdout).leaked, true,
      "the same real kernel must expose the deliberately leaked canary to the oracle");
    const positive = await raw(recipe.command, Buffer.from(recipe.privateInputs[0].bytes), [held]);
    assert.equal(positive.exitCode, 0, positive.stderr.toString()); assert.equal(JSON.parse(positive.stdout).leaked, false);
    return { canaryLeakDetectedInControl: true, installedHelperReturnedDescriptor: true, directChildrenClosed: true,
      actorSha256: digest(readFileSync(actor)), negativeControlSha256: digest(readFileSync(mutant)) };
  }, () => closeSync(held));
}
async function ipcDenial() {
  // Short canonical paths keep this IPC test independent of sun_path limits;
  // the profile/files tests separately exercise long/non-ASCII host paths.
  const directory = realpathSync(mkdtempSync("/tmp/oma-ipc-")), paths = [join(directory, "a"), join(directory, "b")];
  const servers = [], sockets = new Set();
  return withAsyncCleanup(async () => {
    for (const path of paths) {
      const server = createServer(socket => { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); socket.end("echo"); });
      servers.push(server); const ready = once(server, "listening"); server.listen(path); await ready;
    }
    for (const path of paths) {
      const socket = connect(path), data = []; sockets.add(socket); socket.once("close", () => sockets.delete(socket));
      socket.on("data", bytes => data.push(bytes)); await once(socket, "close"); assert.equal(Buffer.concat(data).toString(), "echo");
    }
    const command = { ...target, argv: ["--input-type=module", "-e",
      `import assert from 'node:assert/strict'; import {connect} from 'node:net';
       const allowed=connect(process.argv[1]); let text=''; allowed.on('data',b=>text+=b);
       await new Promise((r,j)=>{allowed.once('error',j);allowed.once('close',r)}); assert.equal(text,'echo');
       const refused=connect(process.argv[2]); const error=await new Promise((r,j)=>{refused.once('error',r);refused.once('connect',()=>j(new Error('foreign socket connected')))});
       assert.ok(['EACCES','EPERM'].includes(error.code),String(error)); refused.destroy(); console.log('verified');`, ...paths] };
    assert.equal((await good(command, { ...policy, unixSockets: [paths[0]] })).trim(), "verified");
    return { bothHostPositiveControls: true, ownSocketEchoed: true, foreignSocketDenied: true, directChildClosed: true };
  }, async () => {
    for (const socket of sockets) socket.destroy();
    const returned = await Promise.allSettled(servers.map(server => new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()))));
    try { rmSync(directory, { recursive: true, force: true }); }
    catch (reason) { returned.push({ status: "rejected", reason }); }
    const errors = returned.filter(row => row.status === "rejected").map(row => row.reason);
    if (errors.length) throw new AggregateError(errors, "IPC fixture cleanup failed");
  });
}
async function keptDescriptors() {
  const actorSource=fileURLToPath(new URL('./darwin-fd-observer.c',import.meta.url)),actor=join(work,'kept-observer');
  const compiled=spawnSync('/usr/bin/xcrun',['clang','-Wall','-Wextra','-Werror',actorSource,'-o',actor],
    {encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});
  assert.equal(compiled.error,undefined);assert.equal(compiled.signal,null);assert.equal(compiled.status,0,compiled.stderr);
  const canary=join(root,'kept-canary');writeFileSync(canary,'fixture explicit channels');
  // This separate real SDK program invokes the same production exec leaf with
  // CLOEXEC stdio/kept channels and an FD above lowered soft AND hard limits.
  const pruneSource=fileURLToPath(new URL('./descriptor-prune-control.c',import.meta.url)),prune=join(work,'prune-control');
  const pruning=spawnSync('/usr/bin/xcrun',['clang','-Wall','-Wextra','-Werror','-I',dirname(bundledSeatbeltHelper()),pruneSource,'-lproc','-o',prune],
    {encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});
  assert.equal(pruning.error,undefined);assert.equal(pruning.signal,null);assert.equal(pruning.status,0,pruning.stderr);
  function observe(list,options={}){
    const child=spawnSync(prune,[canary,list],{encoding:'utf8',timeout:10000,killSignal:'SIGKILL',maxBuffer:65536,...options});
    assert.equal(child.error,undefined);assert.equal(child.signal,null);return child;
  }
  const unpruned=observe('negative-control');assert.equal(unpruned.status,3,unpruned.stderr);
  assert.deepEqual(JSON.parse(unpruned.stdout),{kept:true,outsideSoftLimitOpen:true,lowClosed:true,inheritable:true,samePid:true,stdioInherited:true,hardLimit:16});
  for(const list of ['6,8','none']){
    const child=observe(list);assert.equal(child.status,0,child.stderr);
    assert.deepEqual(JSON.parse(child.stdout),{kept:list!=='none',outsideSoftLimitOpen:false,lowClosed:true,inheritable:list!=='none',samePid:true,stdioInherited:true,hardLimit:16});
  }
  const missing=observe('5');assert.equal(missing.status,125);assert.match(missing.stderr,/Seatbelt target exec/);
  const absent=observe('6,8',{argv0:join(work,'absent-target')});assert.equal(absent.status,125);assert.match(absent.stderr,/Seatbelt target exec/);
  const held=openSync(canary,constants.O_RDONLY),info=fstatSync(held,{bigint:true});
  return withAsyncCleanup(async()=>{
    const command={...target,executable:actor,argv:[String(info.dev),String(info.ino),'6','8']};
    const selected={...policy,readable:[{path:canary,kind:'file'}],executable:[{path:actor,kind:'file'}],preserveFds:[6,8]};
    const recipe=prepareSeatbelt(command,selected),frame=Buffer.from(recipe.privateInputs[0].bytes),inherited=Array(5).fill(held);
    const positive=await raw(recipe.command,frame,inherited);
    assert.equal(positive.exitCode,0,positive.stderr.toString());
    assert.equal(JSON.parse(positive.stdout).keptCount,2);assert.equal(JSON.parse(positive.stdout).leaked,false);
    // The same explicit slots must survive stdin transport. Unlike raw(),
    // this path uses only the ordinary CommandSpec.input/process owner.
    const stdin = prepareSeatbelt(command,{...selected,profileInput:'stdin'});
    const task = startProcess(stdin.command,{inheritedFds:Array(6).fill(held)});
    await withAsyncCleanup(async()=>{
      const result=await task.result;await task.closed;
      assert.equal(result.kind,'exited');assert.equal(result.exitCode,0,result.stderr.toString());
      assert.equal(result.signal,null);assert.equal(JSON.parse(result.stdout).keptCount,2);assert.equal(JSON.parse(result.stdout).leaked,false);
    },async()=>{task.cancel();await task.closed;});
    // Intentionally retain one additional real canary; the independent actor
    // must detect it instead of declaring every inherited channel harmless.
    const leaky=prepareSeatbelt(command,{...selected,preserveFds:[4,6,8]});
    const negative=await raw(leaky.command,Buffer.from(leaky.privateInputs[0].bytes),inherited);
    assert.equal(negative.exitCode,3,negative.stderr.toString());assert.equal(JSON.parse(negative.stdout).leaked,true);
    for(const flag of ['--keep-fds=3','--keep-fds=6,6']){
      const refused=await raw({...recipe.command,argv:[flag,...recipe.command.argv.slice(1)]},frame,inherited);
      assert.equal(refused.exitCode,125);assert.match(refused.stderr.toString(),/descriptor policy/);
    }
    return {exactChannelsRetained:true,stdinTransportRetainedSameChannels:true,extraCanaryDetectedInControl:true,malformedPolicyRefused:true,directChildrenClosed:true,
      samePidAfterExec:true,loweredHardLimitPruned:true,stdioCloexecRetained:true,emptyKeepListPruned:true,missingChannelRefused:true,missingTargetRefused:true,
      actorSha256:digest(readFileSync(actor)),pruneControlSha256:digest(readFileSync(prune))};
  },()=>closeSync(held));
}
let observation;
if (mode?.startsWith("seatbelt-profile-")) observation = await framing();
else if (mode === "seatbelt-argv-env") observation = await argvAndEnvironment();
else if (mode === "seatbelt-trusted-preload") observation = await trustedPreload();
else if (mode === "seatbelt-stdin-profile") observation = await stdinProfile();
else if (mode === "seatbelt-fd-close") observation = await fdClosure();
else if (mode === "seatbelt-ipc-denial") observation = await ipcDenial();
else if (mode === "seatbelt-kept-fds") observation = await keptDescriptors();
else throw new Error(`unknown Seatbelt fault case ${mode}`);
console.log(JSON.stringify({ case: mode, seatbeltFault: observation }));
