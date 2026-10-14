// In-process society lease semantics: exclusivity, release, double-release,
// and inherited-fence recognition. (Cross-process race is inferred; the kernel
// abstract-name bind is the exclusivity primitive.)
import { tryHoldSociety, inheritedFence, societyLeaseName } from "../../../../dist/src/runtime/society-lease.js";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = mkdtempSync(join(tmpdir(), "oma-adv-G04-lease-"));
const stateRoot = join(base, "state");
mkdirSync(stateRoot, { recursive: true });

try {
  const lease = tryHoldSociety(stateRoot);
  console.log("parent holds:", lease !== null);
  console.log("inheritedFence recognises own fence:", lease && inheritedFence(lease.fence, stateRoot).kind);
  const second = tryHoldSociety(stateRoot);
  console.log("second acquire (same proc):", second === null ? "none(correct)" : "HELD(bug)");
  lease?.release();
  const third = tryHoldSociety(stateRoot);
  console.log("after release re-acquire:", third !== null ? "held(correct)" : "none(bug)");
  console.log("double release safe:", (() => { try { lease?.release(); return true; } catch { return false; } })());
  third?.release();
  console.log("lease name stable:", societyLeaseName(stateRoot) === societyLeaseName(stateRoot));
} catch (e) {
  console.log("ERROR:", String(e));
} finally {
  rmSync(base, { recursive: true, force: true });
}
