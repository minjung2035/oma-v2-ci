/** Publication links, not frozen/unaccepted objects, form the Human overview. */
import { closeSync, constants } from "node:fs";
import { openBeneath, openDirectory } from "@oma/native/files";
import { directoryNames } from "@oma/file-descriptors";
import { statAt } from "@oma/native/posix-files";
import { join } from "node:path";
import { isValidMessageId } from "@oma/domain/identifiers";
import { READ_BOUNDS } from "@oma/domain/surface-bounds";
export const publishedMailId = (name: string): string => name.endsWith(":2,") ? name.slice(0, -3) : name;
export function publishedMailEntries(stateRoot: string, control: { readonly directoryFd?: number } = {}) {
  const entries: { name: string; directory: string; deliveredAtMs: number }[] = [];
  let unreadable: string | null = null;
  let root: number | undefined = control.directoryFd;
  try {
    root ??= openDirectory(stateRoot);
    for (const audience of ["archive", "workers"]) for (const position of ["new", "cur"]) {
      const directory = join(stateRoot, "mail", audience, position);
      let held: number | undefined;
      try {
        held = openBeneath(root, `mail/${audience}/${position}`, constants.O_RDONLY | constants.O_DIRECTORY);
        for (const name of directoryNames(held)) {
          if (!isValidMessageId(publishedMailId(name))) continue;
          try {
            const stat = statAt(held, name);
            if (stat.isFile()) entries.push({ name, directory, deliveredAtMs: stat.mtimeMs });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") unreadable ??= `Could not read ${directory}`;
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") unreadable ??= `Could not read ${directory}`;
      } finally { if (held !== undefined) closeSync(held); }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") unreadable ??= `Could not read ${stateRoot}`;
  } finally { if (control.directoryFd === undefined && root !== undefined) closeSync(root); }
  entries.sort((a, b) => b.deliveredAtMs - a.deliveredAtMs || a.name.localeCompare(b.name));
  const seen = new Set<string>();
  const unique = entries.filter(entry => {
    const id = publishedMailId(entry.name);
    if (seen.has(id)) return false;
    seen.add(id); return true;
  });
  return { entries: unique.slice(0, READ_BOUNDS.mailListRows.value), unreadable,
    omitted: Math.max(0, unique.length - READ_BOUNDS.mailListRows.value) };
}
