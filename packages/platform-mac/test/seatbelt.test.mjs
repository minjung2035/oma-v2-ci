import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { prepareSeatbelt, seatbeltProfile } from "@oma/platform-mac/seatbelt";

const dir = path => ({ path, kind: "directory" });
const policy = () => ({ readable: [dir("/oma/shared")], writable: [dir("/oma/private")],
  denied: [dir("/oma/private/credential")], executable: [{ path: "/opt/oma/node", kind: "file" }],
  unixSockets: ["/oma/run/actor.sock"], machServices: [`com.oma.rpc.${"a".repeat(64)}`],
  environmentKeys: ["HOME", "TMPDIR", "PATH", "LANG"] });
const source = () => ({ executable: "/opt/oma/node", argv: ["an argument", '$(literal);"'],
  env: { HOME: "/oma/private/home", TMPDIR: "/oma/private/tmp", PATH: "/usr/bin:/bin", LANG: "C" },
  cwd: "/oma/private/work", input: "stdin belongs to the command", timeoutMs: 20000, stdoutBytes: 1024, stderrBytes: 1024 });

test("Seatbelt preparation keeps arguments and stdin separate from the profile transport", () => {
  const command = source();
  const result = prepareSeatbelt(command, policy());
  assert.ok(result.command.executable.endsWith("/seatbelt/oma-seatbelt"));
  assert.deepEqual(result.command.argv.slice(-3), [command.executable, ...command.argv]);
  assert.equal(result.command.input, command.input);
  assert.equal(result.privateInputs.length, 1); assert.equal(result.privateInputs[0].fd, 3);
  const frame = Buffer.from(result.privateInputs[0].bytes);
  assert.equal(frame.subarray(0, 8).toString(), "OMASBPL1");
  assert.equal(frame.readBigUInt64BE(8), BigInt(Buffer.byteLength(result.profile)));
  assert.equal(frame.subarray(16).toString(), result.profile);
  assert.ok(result.profile.startsWith("(version 1)\n(deny default)\n"));
  command.argv[0] = "changed after preparation"; command.env.HOME = "/human";
  assert.equal(result.command.argv.at(-2), "an argument");
  assert.equal(result.command.env.HOME, "/oma/private/home");
});
test("Seatbelt preparation refuses ambient loader credentials and roots outside the writable view", () => {
  for (const key of ["DYLD_INSERT_LIBRARIES", "LD_PRELOAD", "BASH_ENV", "ENV", "NODE_OPTIONS", "NODE_PATH", "SSH_AUTH_SOCK", "__XPC_DYLD_FRAMEWORK_PATH"]) {
    const command = source(), allowed = policy(); command.env[key] = "/human/credential";
    allowed.environmentKeys.push(key);
    assert.throws(() => prepareSeatbelt(command, allowed), { code: "UNSUPPORTED_PROFILE" });
  }
  for (const key of ["HOME", "TMPDIR"]) {
    const command = source(); command.env[key] = "/oma/private-sibling";
    assert.throws(() => prepareSeatbelt(command, policy()), { code: "UNSUPPORTED_PROFILE" });
  }
  assert.throws(() => prepareSeatbelt({ ...source(), cwd: "/oma/shared" }, policy()), { code: "UNSUPPORTED_PROFILE" });
  const extra = source(); extra.env.PROVIDER_SECRET = "must not inherit";
  assert.throws(() => prepareSeatbelt(extra, policy()), { code: "UNSUPPORTED_PROFILE" });
});
test("Seatbelt policy refuses untrusted IPC names and noncanonical roots", () => {
  for (const service of ["*", "com.oma.rpc.*", "com.apple.SecurityServer", "com.apple.securityd.xpc", "x\") (allow default) ("]) {
    assert.throws(() => seatbeltProfile({ ...policy(), machServices: [service] }), { code: "UNSUPPORTED_PROFILE" });
  }
  for (const path of ["/", "/oma//root", "/oma/../human", "/oma/./private", "/oma/private/", "/oma/\0bad"]) {
    assert.throws(() => seatbeltProfile({ ...policy(), writable: [dir(path)] }), { code: "UNSUPPORTED_PROFILE" });
  }
});
test("Seatbelt trusted Node preload is exact, read-only and interpreted only by the sandboxed target", () => {
  const command = source(), selected = policy(), preload = '/oma/shared/한 글자 "preload.mjs';
  selected.environmentKeys.push('NODE_OPTIONS'); selected.nodePreload = preload;
  command.env.NODE_OPTIONS = `--import=${pathToFileURL(preload).href}`;
  const prepared = prepareSeatbelt(command, selected);
  assert.equal(prepared.command.env.NODE_OPTIONS, command.env.NODE_OPTIONS);
  for (const options of ['--require=/human/x.js', command.env.NODE_OPTIONS + ' --inspect=0.0.0.0:9229', '--import=file:///other.mjs'])
    assert.throws(() => prepareSeatbelt({ ...command, env: { ...command.env, NODE_OPTIONS: options } }, selected), { code: 'UNSUPPORTED_PROFILE' });
  for (const nodePreload of ['/human/x.js', '/oma/private/x.js', '/oma/private/credential/x.js'])
    assert.throws(() => prepareSeatbelt(command, { ...selected, nodePreload }), { code: 'UNSUPPORTED_PROFILE' });
});
test("Seatbelt profile paths remain literals and aggregate profiles never enter argv", () => {
  const selected = policy();
  selected.readable = Array.from({ length: 1500 }, (_, i) => dir(`/oma/shared/한 글자-${i}`));
  selected.denied.push(dir('/oma/private/a"\\b) (allow default)'));
  const prepared = prepareSeatbelt(source(), selected);
  assert.ok(Buffer.byteLength(prepared.profile) > 65536);
  assert.ok(prepared.command.argv.every(value => !value.includes("(version 1)")));
  assert.ok(prepared.profile.includes(JSON.stringify('/oma/private/a"\\b) (allow default)')));
});
test("Seatbelt retains only explicit sorted non-bootstrap descriptor slots", () => {
  const kept=[8,6], selected={...policy(),preserveFds:kept}, prepared=prepareSeatbelt(source(),selected);
  assert.deepEqual(kept,[8,6]); assert.equal(prepared.command.argv[0],'--keep-fds=6,8');
  assert.equal(prepared.command.argv[1],source().executable);
  assert.equal(prepareSeatbelt(source(),policy()).command.argv[0],source().executable);
  for(const preserveFds of [null,'6',[3],[0],[-1],[6,6],[2147483647],[6.5],[,6]])
    assert.throws(()=>prepareSeatbelt(source(),{...policy(),preserveFds}),{code:'UNSUPPORTED_PROFILE'});
});
test("Seatbelt noninteractive setup uses ordinary input and refuses to overwrite target stdin", () => {
  const {input, ...command} = source();
  const prepared = prepareSeatbelt(command, {...policy(),profileInput:'stdin',preserveFds:[8,6]});
  assert.deepEqual(prepared.privateInputs, []);
  assert.deepEqual(prepared.command.argv.slice(0,3), ['--profile-stdin','--keep-fds=6,8',command.executable]);
  const frame = Buffer.from(prepared.command.input);
  assert.equal(frame.subarray(0,8).toString(),'OMASBPL1');
  assert.equal(frame.readBigUInt64BE(8),BigInt(Buffer.byteLength(prepared.profile)));
  assert.equal(frame.subarray(16).toString(),prepared.profile);
  for (const input of ['',Buffer.alloc(0),'target input'])
    assert.throws(()=>prepareSeatbelt({...command,input},{...policy(),profileInput:'stdin'}),{code:'UNSUPPORTED_PROFILE'});
  assert.throws(()=>prepareSeatbelt({...command,stdinFd:0},{...policy(),profileInput:'stdin'}),{code:'UNSUPPORTED_PROFILE'});
  for (const profileInput of [null,'pipe',0])
    assert.throws(()=>prepareSeatbelt(command,{...policy(),profileInput}),{code:'UNSUPPORTED_PROFILE'});
  assert.equal(prepareSeatbelt(source(),{...policy(),profileInput:'descriptor'}).command.input,input);
});
test('Seatbelt readonly mapping permits loading dylibs without widening process execution',()=>{
  const selected={...policy(),mapped:[dir('/opt/toolchain/frameworks')]},profile=seatbeltProfile(selected);
  assert.ok(profile.includes('(allow file-read* (subpath "/opt/toolchain/frameworks"))'));
  assert.ok(profile.includes('(allow file-map-executable (subpath "/opt/toolchain/frameworks"))'));
  assert.ok(!profile.includes('(allow process-exec* (subpath "/opt/toolchain/frameworks"))'));
  assert.ok(!profile.includes('(allow file-write* (subpath "/opt/toolchain/frameworks"))'));
  for(const mapped of [null,'/opt/toolchain',{}])assert.throws(()=>seatbeltProfile({...policy(),mapped}),{code:'UNSUPPORTED_PROFILE'});
});
