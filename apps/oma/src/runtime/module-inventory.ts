/** Installed npm bytes and loader links. This observes physical deployment
 * input only; it supplies no role, current-run or immutable-generation proof. */
import { closeSync, constants, fstatSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { directoryNames } from "@oma/file-descriptors";
import { openBeneath, pinBeneath } from "@oma/native/files";
import { statAt, readlinkBytesAt } from "@oma/native/posix-files";
import { withCleanup, withIteratorCleanup, completeIterator } from "@oma/native/cleanup";
import { StoreError } from "@oma/domain/errors";
import { decodeUtf8 } from "@oma/domain/utf8";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";

export interface DeploymentLink { readonly path: string; readonly target: string }
function fail(): never { throw new StoreError("UNSUPPORTED_PROFILE", "installed runtime module inventory is unsupported or changed"); }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === "ENOENT";
function canonical(path: string): boolean {
  return path.length > 0 && !isAbsolute(path) && !path.includes("\\") && !path.includes("\0") &&
    path.split("/").every(part => part !== "" && part !== "." && part !== "..");
}
/** The lock's complete non-development top-level payloads, including nested
 * production dependencies. Missing optional entries require an actual absence
 * observation; EACCES is never treated as an absent dependency. */
export function productionModuleRoots(lock: unknown, present: (path: string) => boolean): readonly string[] {
  if (!object(lock) || lock.lockfileVersion !== 3 || !object(lock.packages)) fail();
  const roots = new Set<string>();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.startsWith("node_modules/")) continue;
    if (!canonical(path) || !object(entry) || entry.dev !== undefined && typeof entry.dev !== "boolean" ||
        entry.optional !== undefined && typeof entry.optional !== "boolean") fail();
    if (entry.dev === true || entry.optional === true && !present(path)) continue;
    const parts = path.split("/");
    if (parts.length < 2 || parts[1]!.startsWith("@") && parts.length < 3 || parts[1]!.startsWith(".")) fail();
    roots.add(parts.slice(0, parts[1]!.startsWith("@") ? 3 : 2).join("/"));
  }
  return [...roots].sort();
}
interface Callbacks {
  entry(): void;
  file(parent: number, name: string, path: string): void;
  directory(path: string): void;
  bound(path: string, directory: boolean): boolean;
}
/** Shares the deployment owner's held root, byte/entry budget and file
 * hashing. Links are pinned separately from files and must resolve directly
 * to included regular bytes/directories, never outside the installation. */
interface ModuleInventory { readonly links: readonly DeploymentLink[]; readonly directories: readonly string[] }
export function inventoryRuntimeModules(root: string, held: number, lock: unknown, callbacks: Callbacks): ModuleInventory {
  return completeIterator(inventoryRuntimeModuleSteps(root, held, lock, callbacks));
}
export function* inventoryRuntimeModuleSteps(root: string, held: number, lock: unknown, callbacks: Callbacks): Generator<void, ModuleInventory, void> {
  const links: DeploymentLink[] = [], directories = new Set<string>(), regular = new Set<string>();
  const metadata = (path: string) => {
    const parent = openBeneath(held, dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    return withCleanup(() => statAt(parent, basename(path), { throwIfNoEntry: false }), () => closeSync(parent));
  };
  const present = (path: string): boolean => {
    try { return metadata(path) !== undefined; }
    catch (error) { if (missing(error)) return false; throw error; }
  };
  const roots = [...productionModuleRoots(lock, present)];
  // A Node consumer also searches the namespaces above its dist directory.
  // Include real workspace/group namespaces, not just lockfile hoist targets.
  for (const path of new Set(DEPLOYMENT_LAYOUT.workspaces.flatMap(workspace => [
    workspace.root + "/node_modules", dirname(workspace.root) + "/node_modules",
  ]))) if (present(path)) roots.push(path);
  const selected = [...new Set(roots)].sort().filter(path => !roots.some(parent => path !== parent && path.startsWith(parent + "/")));
  const walk = function* (parent: number, name: string, path: string, depth: number): Generator<void, void, void> {
    if (depth > 32) fail();
    const entry = statAt(parent, name);
    if (entry.isFile()) { regular.add(path); callbacks.file(parent, name, path); yield; return; }
    callbacks.entry();
    if (entry.isSymbolicLink()) {
      const text = decodeUtf8(readlinkBytesAt(parent, name));
      const target = relative(root, resolve(dirname(join(root, path)), text));
      if (!text || !canonical(target)) fail();
      links.push(Object.freeze({ path, target })); return;
    }
    if (!entry.isDirectory()) fail();
    const directory = openBeneath(parent, name, constants.O_RDONLY | constants.O_DIRECTORY);
    yield* withIteratorCleanup(function* () {
      directories.add(path); if (name === "node_modules") callbacks.directory(path); yield;
      for (const child of directoryNames(directory)) yield* walk(directory, child, path + "/" + child, depth + 1);
    }, () => closeSync(directory));
  };
  for (const path of selected) {
    const parent = openBeneath(held, dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    yield* withIteratorCleanup(() => walk(parent, basename(path), path, 0), () => closeSync(parent));
  }
  for (const link of links) {
    // The contained no-link target pin also rejects link chains and loops.
    // npm's workspace aliases and direct bin links need no escaping resolver.
    const target = pinBeneath(held, link.target);
    withCleanup(() => {
      const stat = fstatSync(target), directory = stat.isDirectory();
      if (!directory && !stat.isFile() || !(directory ? directories.has(link.target) : regular.has(link.target)) &&
          !callbacks.bound(link.target, directory)) fail();
    }, () => closeSync(target));
    yield;
  }
  links.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return Object.freeze({ links: Object.freeze(links), directories: Object.freeze([...directories].sort()) });
}
