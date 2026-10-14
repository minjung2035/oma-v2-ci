import { packageDirectories } from "../platform/package-files.js";
/** DR25 on macOS: the engine's side of `oma pi` -- the packages the Mac
 * installed made the engine's store, and every project's roles brought to
 * them (entry/guest-packages.ts runs this for guesthost's packages.replace).
 *
 * The store is a link to one generation, published whole under the digest of
 * what arrived and never changed after, so an engine that loaded an extension
 * from an earlier generation keeps reading the files it pinned. Published
 * generations with reader leases are collected only after an exclusive
 * inode lock proves no live engine holds them. Unmarked legacy generations
 * stay because their reader lifetime cannot be proven.
 *
 * guesthost runs a request cut off before its outcome again, so every step is
 * one that may have been done already: the generation is published once under
 * its digest, the link is switched to it, and what the store held before is
 * recorded once for the request, before anything changes, so a run after a
 * crash finds the same packages added as the first would have. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { StoreError } from "../domain/errors.js";
import { defaultSocietyFor } from "../config/defaults.js";
import { sha256Hex } from "../hash.js";
import { readPackageArchive } from "../platform/package-archive.js";
import { PACKAGE_GENERATIONS, PACKAGE_READER_MARKER, PACKAGE_STORE, PACKAGE_INDEX_BYTES, collectPackageGenerations, decodePackageIndex, readPackageIndex, writePackageIndex, type InstalledPackage } from "../runtime/packages/index.js";
import { ProcessLock } from "../runtime/process-lock.js";
import { withAsyncCleanup } from "../process/cleanup.js";
import { readUserFile } from "../runtime/user-files.js";
import { ensureOwnedDurableDirectory, publishNoReplace } from "../storage/durable-fs.js";
import { removeOwnedTree } from "../storage/directory.js";
import { publishStagedDirectory, replaceDerivedSymlink } from "../storage/staged-tree.js";
import { applyPackageChange } from "./project-settings.js";

/** The steps of an application, for a test that stops one after each. */
export type ApplyStep = "recorded" | "published" | "switched" | "collected";

async function digestOf(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function beforeImage(path: string): { before: readonly InstalledPackage[]; previous: string | null } {
  const invalid = (): never => { throw new StoreError("STORE_CORRUPT", "the saved package before-image is malformed"); };
  // The live index's bound plus the JSON envelope and one generation name.
  const bytes = readUserFile(path, PACKAGE_INDEX_BYTES + Buffer.byteLength(JSON.stringify({ before: [], previous: `p-${sha256Hex("")}` })), { singleName: true });
  let value: unknown;
  try { value = JSON.parse(bytes ?? ""); } catch { return invalid(); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  const saved = value as Record<string, unknown>;
  if (Object.keys(saved).length !== 2 || !Object.hasOwn(saved, "before") || !Object.hasOwn(saved, "previous") ||
      (saved.previous !== null && (typeof saved.previous !== "string" || !/^p-[0-9a-f]{64}$/.test(saved.previous)))) return invalid();
  return { before: decodePackageIndex(saved.before), previous: saved.previous as string | null };
}

export async function applyPackageArchive(options: { readonly data: string; readonly archive: string; readonly libdir: string;
  readonly mirror?: string | undefined; readonly activate?: string | undefined }, after?: (step: ApplyStep) => void): Promise<{ readonly added: string[]; readonly said: string[]; readonly ok: boolean }> {
  const owner = ProcessLock.acquire(join(options.data, ".packages-publication.lock"));
  return withAsyncCleanup(() => applyOwnedPackageArchive(options, after), () => owner.close());
}
async function applyOwnedPackageArchive(options: { readonly data: string; readonly archive: string; readonly libdir: string;
  readonly mirror?: string | undefined; readonly activate?: string | undefined }, after?: (step: ApplyStep) => void): Promise<{ readonly added: string[]; readonly said: string[]; readonly ok: boolean }> {
  const { data, archive, libdir, mirror } = options;
  const store = join(data, PACKAGE_STORE);
  const generations = join(data, PACKAGE_GENERATIONS);
  const current = lstatSync(store, { throwIfNoEntry: false });
  if (current !== undefined && !current.isSymbolicLink())
    throw new StoreError("STORE_CORRUPT", "the engine's package store is not the link oma keeps it as");
  // What the store held before this request, and the generation it was, once
  // for the request: a run after a crash reads them instead of the store it changed.
  const recorded = `${archive}.before.json`;
  const link = current === undefined ? null : readlinkSync(store);
  if (link !== null && !/^\.packages-generations\/p-[0-9a-f]{64}$/.test(link))
    throw new StoreError("STORE_CORRUPT", "the package store link does not name a published generation");
  publishNoReplace(recorded, JSON.stringify({ before: readPackageIndex(store),
    previous: link === null ? null : link.split("/").at(-1)! }));
  const { before } = beforeImage(recorded);
  after?.("recorded");
  // `data` and everything beneath it is oma's own tree in the guest: the
  // owner-bits repair runs on the walk so a mode-000 generations directory
  // cannot wedge a packages.replace before it starts.
  ensureOwnedDurableDirectory(generations, data, 0o700);
  const id = `p-${await digestOf(archive)}`;
  const target = join(generations, id);
  if (lstatSync(target, { throwIfNoEntry: false }) === undefined) {
    const staging = join(generations, `.staging-${randomUUID()}`);
    ensureOwnedDurableDirectory(staging, data, 0o755);
    try {
      readPackageArchive(archive, staging);
      // Which files are extensions is the engine's answer, asked where they now are.
      await writePackageIndex(staging, packageDirectories);
      publishNoReplace(join(staging, PACKAGE_READER_MARKER), "oma-reader-leases-v1\n");
      publishStagedDirectory(staging, target, () => {});
    } finally { removeOwnedTree(staging); }
  }
  after?.("published");
  replaceDerivedSymlink(store, `${PACKAGE_GENERATIONS}/${id}`);
  after?.("switched");
  collectPackageGenerations(data, id);
  after?.("collected");
  const now = readPackageIndex(store);
  const project = mirror === undefined ? null : (() => { const real = realpathSync(mirror); return defaultSocietyFor(real, sha256Hex(real)); })();
  const { ok, said } = applyPackageChange({ dataRoot: data, project, libdir, before, after: now, activate: options.activate });
  const added = now.filter(item => !before.some(earlier => earlier.source === item.source)).map(item => item.source);
  return { added, said, ok };
}
