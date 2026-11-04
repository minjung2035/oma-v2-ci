/** Trusted host helper; no candidate code or package scripts execute here. */
import { fillDownloadCache, publicDownloads } from "@oma/git/download-cache";
let input = Buffer.alloc(0);
for await (const chunk of process.stdin) {
  if (input.length + chunk.length > 20 * 1024 * 1024) throw new Error("cache input exceeds lockfile observation bound");
  input = Buffer.concat([input, chunk]);
}
const { root, key, lockfile } = JSON.parse(input.toString("utf8")) as { root: string; key: string; lockfile: string };
await fillDownloadCache(root, key, publicDownloads(Buffer.from(lockfile, "base64")));
