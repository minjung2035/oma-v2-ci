import { constants, closeSync, existsSync, fstatSync, lstatSync, openSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { contextFileCheck } from "../../domain/context-policy.js";
import { fail } from "../exit.js";
import { readBounded, sha256Hex } from "../effects.js";
import { cliContextBytes } from "../transport.js";

type ContextFile = { path: string; bytes: number; sha256: string; data: Uint8Array };

/** P0V-78: the documents together are one context stream, so each is read
 * only up to what the stream has left -- a tree larger than a request can
 * carry is refused before the file that overflows it is read. */
function walk(dir: string, streamBytes: number): ContextFile[] {
  const out: ContextFile[] = [];
  let total = 0;
  const walker = (directoryPath: string, relative: string): void => {
    if (!lstatSync(directoryPath).isDirectory()) fail(`unsupported context directory ${relative}`, 2);
    const directory = openSync(
      directoryPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      const pinned = `/proc/self/fd/${directory}`;
      for (const file of readdirSync(pinned).sort()) {
        const full = join(pinned, file);
        const stat = lstatSync(full);
        const relPath = relative ? `${relative}/${file}` : file;
        if (stat.isDirectory()) {
          if (relPath !== "decisions") fail(`unsupported context directory ${relPath}`, 2);
          walker(full, relPath);
          continue;
        }
        if (!stat.isFile() || stat.nlink !== 1) fail(`unsupported file type/link at ${relPath}`, 2);
        const fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const opened = fstatSync(fd);
          if (!opened.isFile() || opened.nlink !== 1)
            fail(`unsupported file type/link at ${relPath}`, 2);
          const data = readBounded(fd, streamBytes - total, true, refusal => fail(refusal === "size"
            ? `context is larger than a request can carry (${streamBytes} bytes) at ${relPath}`
            : refusal === "grew" ? `file grew while it was read: ${relPath}`
              : `unsupported file type/link at ${relPath}`, 2));
          total += data.length;
          const invalid = contextFileCheck(relPath, data);
          if (invalid) fail(`${invalid}: ${relPath}`, 2);
          out.push({ path: relPath, bytes: data.length, sha256: sha256Hex(data), data });
        } finally {
          closeSync(fd);
        }
      }
    } finally {
      closeSync(directory);
    }
  };
  walker(dir, "");
  return out;
}

export interface PreparedContextEffects {
  entries: { path: string; bytes: number; sha256: string }[];
  content: Buffer;
  digest: { bytes: number; sha256: string };
}

/** Local no-follow directory observation only; request transport remains elsewhere. */
export function prepareContextEffects(dir: string): PreparedContextEffects {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`not a directory: ${dir}`, 2);
  const files = walk(dir, cliContextBytes());
  if (!files.some((entry) => entry.path === "GOAL.md")) fail("GOAL.md is required", 2);
  const content = Buffer.concat(files.map((entry) => entry.data));
  return {
    entries: files.map((entry) => ({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256 })),
    content,
    digest: { bytes: content.length, sha256: sha256Hex(content) },
  };
}
