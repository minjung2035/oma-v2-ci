/** DR46-F02: verify the bytes the actual registration entry will import. */
import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyVendorBundle } from "@oma/tool-runtime/vendor-bundle";

for (const [tool, tag, bundle, target, method] of [
  ["lsp", "BL1", "pi-lsp", "command.js", "registerLspTools"],
  ["hashline", "BL3", "pi-hashline-edit-pro", "file-kind.js", "registerHashlineTools"],
  ["web", "BL4", "pi-web-access", "index.js", "registerWebTools"],
  ["mcp", "BL5", "pi-mcp-adapter", "index.js", "registerMcpTools"],
]) test(`${tag}: a bundle that fails verification registers no tools and refuses the session (actual owner; attempted override)`, { timeout: 60000 }, t => {
  const sourceEntry = fileURLToPath(import.meta.resolve(`@oma/tool-${tool}`));
  const packageRoot = dirname(dirname(sourceEntry));
  const scratch = mkdtempSync(join(tmpdir(), `oma-${tool}-owner-binding-`));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const owner = join(scratch, "owner"), probe = join(scratch, "valid-probe"), workspace = join(scratch, "workspace");
  mkdirSync(owner); mkdirSync(workspace);
  cpSync(join(packageRoot, "dist"), join(owner, "dist"), { recursive: true });
  cpSync(join(packageRoot, "package.json"), join(owner, "package.json"));
  // This oracle concerns binding, with explicit access to the product deps.
  // Independent tarball dependency closure is checked separately.
  const productRoot = dirname(dirname(packageRoot));
  symlinkSync(join(productRoot, "node_modules"), join(owner, "node_modules"));
  cpSync(join(owner, "dist/vendor", bundle), probe, { recursive: true });
  verifyVendorBundle(probe);
  appendFileSync(join(owner, "dist/vendor", bundle, "runtime", target), "\nglobalThis.__OMA_UNVERIFIED_PAYLOAD__ = true;\n");
  assert.throws(() => verifyVendorBundle(join(owner, "dist/vendor", bundle)), /changed/);
  const source = `
    import {pathToFileURL} from 'node:url';
    process.env.PI_CODING_AGENT_DIR=process.argv[2];
    const tools=[],hooks=new Map();
    const pi={registerTool:tool=>tools.push(tool.name),on(event,fn){hooks.set(event,[...(hooks.get(event)??[]),fn]);},
      events:{on(){},off(){},emit(){return false;}},appendEntry(){},sendMessage(){},sendUserMessage(){},
      getFlag(){},getActiveTools(){return [];},setActiveTools(){},getAllTools(){return tools.map(name=>({name}));},
      registerCommand(){},registerShortcut(){},registerFlag(){},exec(){throw new Error('unexpected external command');}};
    const module=await import(pathToFileURL(process.argv[1]).href);
    await module[${JSON.stringify(method)}](pi,{workspace:process.argv[2],readOnly:false,readableRoots:[],sandboxed:false,
      write:async()=>{throw new Error('unexpected mutation');},stateDir:process.argv[2]+'/state',agentDir:process.argv[2],
      config:{mcpServers:{}},bundleDir:process.argv[3]});
    const exits=[],original=process.exit,stop=new Error('captured refusal');
    if(tools.length===0){process.exit=code=>{exits.push(code);throw stop;};
      try{for(const handler of hooks.get('session_start')??[])try{await handler({},{});}catch(error){if(error!==stop)throw error;}}
      finally{process.exit=original;}}
    process.stdout.write(JSON.stringify({tools,evaluated:globalThis.__OMA_UNVERIFIED_PAYLOAD__===true,exits}));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source, join(owner, "dist/index.js"), workspace, probe],
    { encoding: "utf8", timeout: 30000, killSignal: "SIGKILL" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  const observed = JSON.parse(result.stdout);
  t.diagnostic(JSON.stringify({ tool, ...observed }));
  assert.equal(observed.evaluated, false, "an unrelated valid probe cannot authorize loading changed owned bytes");
  assert.deepEqual(observed.tools, []);
  assert.deepEqual(observed.exits, [1]);
});
