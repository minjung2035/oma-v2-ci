/** Called by verify-lane only AFTER its fresh build, in a new guarded process.
 * Tests the real production gate; this is not READY or environment certification. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [root, rawBytes] = process.argv.slice(2);
const bytes = Number(rawBytes);
if (!root || !Number.isSafeInteger(bytes) || bytes <= 0)
 throw new Error("invalid qualification probe arguments");
const { assertStorageQuotaSupported } = await import(
 pathToFileURL(resolve(root, "dist/src/domain/resources.js")).href
);
try {
 assertStorageQuotaSupported(bytes);
} catch (error) {
 if (
  !(error instanceof Error) ||
  !("code" in error) ||
  error.code !== "SPIKE_UNRESOLVED"
 )
  throw error;
 console.error(JSON.stringify({ code: error.code, message: error.message }));
 process.exitCode = 78;
}
