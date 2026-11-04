/** Actual held filesystem observation plus platform policy. Synthetic mount
 * facts test policy only; they do not claim a real NFS/FUSE mount was run. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertStateRoot } from "#oma-test/app/runtime/assets";

test("001. Actual state-root observation uses the existing local ancestor and the OS filesystem namespace", t => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "oma-state-filesystem-")));
  t.after(() => rmSync(parent, { recursive: true }));
  const root = join(parent, "missing", "society"); assertStateRoot(root);
  const seen = [];
  const observe = value => path => { seen.push(path); return value; };
  if (process.platform === "darwin") {
    const local = { type: 0x6969, name: "apfs", local: true, readOnly: false, userSpace: false };
    // 0x6969 is Linux's NFS magic, not a Darwin filesystem classification.
    assertStateRoot(root, observe(local));
    for (const value of [{ ...local, name: "nfs", local: false }, { ...local, name: "smbfs", local: false },
      { ...local, name: "macfuse" }, { ...local, userSpace: true }, { ...local, readOnly: true }, { type: 1 }])
      assert.throws(() => assertStateRoot(root, observe(value)), { code: "UNSUPPORTED_PROFILE" });
  } else {
    assertStateRoot(root, observe({ type: 0xef53 }));
    assert.throws(() => assertStateRoot(root, observe({ type: 0x6969 })), { code: "UNSUPPORTED_PROFILE" });
  }
  assert.ok(seen.length > 0); assert.deepEqual([...new Set(seen)], [parent]);
});
