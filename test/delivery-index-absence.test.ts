/** Current ordinary read boundary: unavailable records never become empty mail. */
import test from "node:test";
import assert from "node:assert/strict";
import fs, { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containWorkspaceTools } from "@oma/tool-runtime/contained-tools";

type Tool = { name: string; execute(id: string, params: { path: string }, signal: undefined, update: undefined,
  context: unknown): Promise<{ content: { text?: string }[] }> };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-record-read-"));
  const workspace = join(root, "workspace"), view = join(root, "records"); mkdirSync(workspace);
  const tools = new Map<string, Tool>();
  containWorkspaceTools({ registerTool: (tool: Tool) => tools.set(tool.name, tool) } as never, workspace, false, true, [view]);
  const read = async (path = join(view, "inbox.md")) => {
    const result = await tools.get("read")!.execute("record", { path }, undefined, undefined, { cwd: workspace });
    return result.content.map(part => part.text ?? "").join("\n");
  };
  return { root, view, read, close: () => rmSync(root, { recursive: true, force: true }) };
}

for (const parentExists of [false, true])
  test(`001. Record read: an unpublished index with parentExists=${parentExists} reports unavailable, not empty mail`, async () => {
    const f = fixture();
    try {
      if (parentExists) mkdirSync(f.view);
      await assert.rejects(f.read(), "an absent record is an error, never a successful empty inbox");
      assert.equal(existsSync(join(f.view, "inbox.md")), false, "reading must not synthesize an empty view");
      mkdirSync(f.view, { recursive: true });
      const body = join(f.view, "known-body.txt"); writeFileSync(body, "Still readable without an inbox index.\n");
      assert.match(await f.read(body), /Still readable/);
      writeFileSync(join(f.view, "inbox.md"), "Published index: known-body.txt\n");
      assert.equal(await f.read(), "Published index: known-body.txt\n", "later publication must not be cached as absent");
    } finally { f.close(); }
  });

for (const invalid of ["symlink", "directory"] as const)
  test(`002. Record read: ${invalid} must not become a successful absent-index response`, async () => {
    const f = fixture();
    try {
      mkdirSync(f.view);
      const index = join(f.view, "inbox.md");
      switch (invalid) {
        case "symlink": {
          const target = join(f.root, "target"); writeFileSync(target, "not a trusted index"); symlinkSync(target, index); break;
        }
        case "directory": mkdirSync(index); break;
      }
      await assert.rejects(f.read());
    } finally { f.close(); }
  });

for (const code of ["EACCES", "EIO"])
  test(`003. Record read: ${code} stays an observation failure, never absent mail`, async t => {
    const f = fixture();
    mkdirSync(f.view);
    const index = join(f.view, "inbox.md"); writeFileSync(index, "valid index\n");
    const failure = Object.assign(new Error("injected index observation failure"), { code });
    const inode = fs.statSync(index).ino, read = fs.readSync;
    let injected = false;
    const mocked = t.mock.method(fs, "readSync", (fd: number, ...args: unknown[]) => {
      if (fs.fstatSync(fd).ino === inode) { injected = true; throw failure; }
      return Reflect.apply(read, fs, [fd, ...args]) as number;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(f.read(), error => error === failure); assert.equal(injected, true); }
    finally { mocked.mock.restore(); syncBuiltinESMExports(); f.close(); }
  });
