/** G01-r2: replaceDerivedSymlink names its temporary with the same
 * `.<name>.<uuid>.tmp` grammar as locked publications, but it neither locks
 * the temporary nor collects dead ones. A process lost between symlinkSync and
 * renameSync leaves an orphan temp symlink that no later publication of the
 * same name removes (collectDeadTemporaries opens O_NOFOLLOW -> ELOOP -> skip),
 * unlike replaceDerivedFile / publishNoReplace whose temps self-collect.
 *
 * We cannot SIGKILL mid-primitive from here, so we reproduce the *observable
 * post-crash state* (an orphan temp symlink) and show a subsequent
 * replaceDerivedFile on the same name does not remove it.
 */
import { mkdtempSync, symlinkSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { replaceDerivedFile } from "../../../../dist/src/storage/durable-fs.js";

const dir = mkdtempSync(join(tmpdir(), "oma-adv-G01-storage-fs-r2-"));
try {
  const name = "current";
  // The exact residue a crash between symlinkSync(temp) and renameSync leaves.
  const orphan = `.${name}.${randomUUID()}.tmp`;
  symlinkSync("revisions/abc", join(dir, orphan));

  const listBefore = readdirSync(dir).filter(e => e.endsWith(".tmp"));
  // A later derived publication of the SAME name runs collectDeadTemporaries.
  replaceDerivedFile(join(dir, name), "x\n");
  const listAfter = readdirSync(dir).filter(e => e.endsWith(".tmp"));

  console.log("orphan temp before:", listBefore);
  console.log("orphan temp after publish of same name:", listAfter);
  console.log(
    listAfter.includes(orphan)
      ? "CONFIRMED: orphan temp symlink from replaceDerivedSymlink is never collected"
      : "NOT CONFIRMED",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
