import { constants, closeSync, existsSync, fstatSync, lstatSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { withCleanup } from "@oma/native/cleanup";
import { openBeneath, openDirectory, openRegularBeneath } from "@oma/native/files";
import { directoryNames } from "@oma/file-descriptors";
import { statAt } from "@oma/native/posix-files";
import { contextFileCheck } from "@oma/domain/context-policy";
import { fail } from "@oma/client/errors";
import { readBounded, sha256Hex } from "../effects.js";
import { contextBytes as cliContextBytes } from "@oma/client/settings";

type ContextFile = { path: string; bytes: number; sha256: string; data: Uint8Array };

/** P0V-78: the documents together are one context stream, so each is read
 * only up to what the stream has left -- a tree larger than a request can
 * carry is refused before the file that overflows it is read. */
function walk(dir: string, streamBytes: number): ContextFile[] {
  const out: ContextFile[] = [];
  let total = 0;
  const walker = (directory: number, relative: string): void => {
    for (const file of directoryNames(directory)) {
      const stat = statAt(directory, file);
      const relPath = relative ? `${relative}/${file}` : file;
      if (stat.isDirectory()) {
        if (relPath !== "decisions") fail(`unsupported context directory ${relPath}`, 2);
        const child = openBeneath(directory, file, constants.O_RDONLY | constants.O_DIRECTORY);
        withCleanup(() => walker(child, relPath), () => closeSync(child));
        continue;
      }
      if (!stat.isFile() || stat.nlink !== 1) fail(`unsupported file type/link at ${relPath}`, 2);
      const fd = openRegularBeneath(directory, file);
      withCleanup(() => {
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.nlink !== 1)
          fail(`unsupported file type/link at ${relPath}`, 2);
        const data = readBounded(fd, streamBytes - total, true, refusal => fail(refusal === "size"
          ? `context is larger than a request can carry (${streamBytes} bytes) at ${relPath}`
          : refusal === "grew" ? `file grew while it was read: ${relPath}`
            : refusal === "changed" ? `file changed while it was read: ${relPath}`
              : `unsupported file type/link at ${relPath}`, 2));
        total += data.length;
        const invalid = contextFileCheck(relPath, data);
        if (invalid) fail(`${invalid}: ${relPath}`, 2);
        out.push({ path: relPath, bytes: data.length, sha256: sha256Hex(data), data });
      }, () => closeSync(fd));
    }
  };
  if (!lstatSync(dir).isDirectory()) fail("unsupported context directory ", 2);
  const directory = openDirectory(resolve(dir));
  withCleanup(() => walker(directory, ""), () => closeSync(directory));
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
