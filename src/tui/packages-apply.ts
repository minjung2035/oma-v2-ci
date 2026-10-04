/** DR25 on macOS: the engine's side of `oma pi` -- the packages the Mac
 * installed made the engine's store, and every project's roles brought to
 * them (entry/guest-packages.ts runs this for guesthost's packages.replace).
 *
 * The store is a link to one generation, published whole under the digest of
 * what arrived and never changed after, so an engine that loaded an extension
 * from the last generation keeps reading the files it pinned; the current and
 * the previous generation are kept.
 *
 * guesthost runs a request cut off before its outcome again, so every step is
 * one that may have been done already: the generation is published once under
 * its digest, the link is switched to it, and what the store held before is
 * recorded once for the request, before anything changes, so a run after a
 * crash finds the same packages added as the first would have. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { StoreError } from "../domain/errors.js";
import { defaultSocietyFor } from "../config/defaults.js";
import { sha256Hex } from "../hash.js";
import { readPackageArchive } from "../platform/package-archive.js";
import { PACKAGE_GENERATIONS, PACKAGE_STORE, readPackageIndex, writePackageIndex, type InstalledPackage } from "../runtime/pi-packages.js";
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

export async function applyPackageArchive(options: { readonly data: string; readonly archive: string; readonly libdir: string;
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
  publishNoReplace(recorded, JSON.stringify({ before: readPackageIndex(store),
    previous: current === undefined ? null : readlinkSync(store).split("/").at(-1) ?? null }));
  const { before, previous } = JSON.parse(readFileSync(recorded, "utf8")) as { before: InstalledPackage[]; previous: string | null };
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
      await writePackageIndex(staging);
      publishStagedDirectory(staging, target, () => {});
    } finally { removeOwnedTree(staging); }
  }
  after?.("published");
  replaceDerivedSymlink(store, `${PACKAGE_GENERATIONS}/${id}`);
  after?.("switched");
  // What no engine can still be reading: every generation but this one and the one before it.
  for (const name of readdirSync(generations))
    if (name !== id && name !== previous) removeOwnedTree(join(generations, name));
  after?.("collected");
  const now = readPackageIndex(store);
  const project = mirror === undefined ? null : (() => { const real = realpathSync(mirror); return defaultSocietyFor(real, sha256Hex(real)); })();
  const { ok, said } = applyPackageChange({ dataRoot: data, project, libdir, before, after: now, activate: options.activate });
  const added = now.filter(item => !before.some(earlier => earlier.source === item.source)).map(item => item.source);
  return { added, said, ok };
}
