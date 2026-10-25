/** DR48: closed, physically quiescent session workspaces are restorable caches.
 * Restic snapshots and immutable checkpoints precede reclamation. SQLite,
 * receipts, mail and conversations stay in place; no model sees this store. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { closeSync, fstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { StoreError } from "@oma/domain/errors";
import { cleanupAll, withAsyncCleanup } from "@oma/native/cleanup";
import { openRegularBeneath, withinDirectory } from "@oma/native/files";
import { ProcessLock } from "@oma/native/process-lock";
import { cacheDirectoryPresent, digestCacheTrees, moveCacheTree, regularFileDigest } from "@oma/storage/cache-trees";
import { ensureOwnedDurableDirectory, fsyncTree, publishNoReplace, replaceDerivedFile, writeExclusiveFsyncedFile } from "@oma/storage/durable-fs";
import { listOwnedDirectory, removeOwnedFile, removeOwnedTree, repairOwnedEntryMode } from "@oma/storage/directory";
import { collectLeasedTree, leasePathOf, TreeLease } from "@oma/storage/tree-lease";
import { observeProjectBinding } from "./project-binding.js";
import { ResticProcess } from "@oma/process/restic";
import { openResticTool } from "@oma/storage/restic-tool";
import { verifyResticDump } from "@oma/storage/restic-tar";
import { verifyResticInventory } from "@oma/storage/restic-verification";
import { parseStorageState, readStorageText, type SessionStorageState, type StorageCheckpoint, type StorageResident } from "./session-storage-state.js";

interface StorageOptions {
  readonly stateRoot: string; readonly society: string; readonly fence: number;
  readonly quiesce: (residents: readonly StorageResident[], action: "stop" | "confirm") => void | Promise<void>;
  readonly log: (line: string) => void;
  readonly env?: NodeJS.ProcessEnv;
}
async function optionalDigest(path: string, signal?: AbortSignal): Promise<string | null> {
  try { return await regularFileDigest(path, signal); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export class SessionStorage {
  readonly projectRoot: string;
  private readonly statePath: string;
  private readonly enabledPath: string;
  private constructor(private readonly options: StorageOptions, private readonly project: string) {
    this.projectRoot = join(dirname(options.stateRoot), ".session-storage", createHash("sha256").update(project).digest("hex"));
    this.statePath = join(options.stateRoot, "session-storage.json");
    this.enabledPath = join(options.stateRoot, "session-storage.enabled");
  }
  static forSociety(options: StorageOptions): SessionStorage | null {
    const observed = observeProjectBinding(options.stateRoot);
    if (observed.kind === "absent") return null;
    if (observed.kind !== "bound" || observed.binding.society !== options.society)
      throw new StoreError("STORE_CORRUPT", "session storage requires the society's committed project binding");
    return new SessionStorage(options, observed.binding.canonicalProjectPath);
  }
  private get hot(): SessionStorageState {
    return { kind: "oma-session-storage-v1", society: this.options.society, project: this.project, checkpoint: null };
  }
  private selection(): SessionStorageState | null {
    const text = readStorageText(this.statePath), enabled = readStorageText(this.enabledPath);
    if (enabled !== null && enabled !== JSON.stringify(this.hot)) throw new StoreError("STORE_CORRUPT", "session storage identity differs");
    if (text === null) {
      if (enabled !== null) throw new StoreError("STORE_CORRUPT", "session storage selection is missing; no workspace is provisioned");
      return null;
    }
    const state = parseStorageState(text, this.options.society, this.project);
    if (state.checkpoint !== null && enabled === null) throw new StoreError("STORE_CORRUPT", "cold session storage identity is missing");
    return state;
  }
  private async ledger(signal?: AbortSignal): Promise<readonly (string | null)[]> {
    const files: (string | null)[] = [];
    const empty = createHash("sha256").digest("hex");
    for (const suffix of ["", "-wal", "-journal"]) {
      const digest = await optionalDigest(join(this.options.stateRoot, `runtime.sqlite${suffix}`), signal);
      // A read-only SQLite connection can create a zero-byte WAL. It has no
      // frames/rollback data. The main DB and every nonempty sidecar remain
      // byte-bound; merely inspecting a cold DB must not strand its workspace.
      files.push(suffix !== "" && digest === empty ? null : digest);
    }
    if (files[0] === null) throw new StoreError("STORE_CORRUPT", "a session checkpoint requires its closed runtime database");
    return files;
  }
  private async assertLedger(expected: readonly (string | null)[], signal?: AbortSignal): Promise<void> {
    const empty = createHash("sha256").digest("hex");
    const normalized = expected.map((digest, index) => index !== 0 && digest === empty ? null : digest);
    if (JSON.stringify(await this.ledger(signal)) !== JSON.stringify(normalized))
      throw new StoreError("STORE_CORRUPT", "the closed database differs from its workspace checkpoint; existing data was retained");
  }
  private async repository<T>(cold: boolean, run: (restic: ResticProcess, stage: string, lock: ProcessLock) => Promise<T>, signal?: AbortSignal): Promise<T | null> {
    const cleanups: (() => void)[] = [];
    return withAsyncCleanup(async () => {
      const tool = await openResticTool(this.options.env);
      if (tool === null) {
        if (cold) throw new StoreError("BROKER_UNAVAILABLE", "this session is archived; run npm run setup:storage before reopening it");
        this.options.log("Session workspace retained: install the verified storage tool with npm run setup:storage."); return null;
      }
      cleanups.unshift(() => closeSync(tool));
      const boundary = dirname(this.projectRoot);
      ensureOwnedDurableDirectory(this.projectRoot, boundary, 0o700);
      const lockPath = join(this.projectRoot, "owner.lock"); repairOwnedEntryMode(lockPath);
      let lock: ProcessLock | null;
      while ((lock = ProcessLock.tryAcquire(lockPath)) === null) {
        signal?.throwIfAborted(); await setTimeout(50, undefined, signal === undefined ? {} : { signal });
      }
      const held = lock; cleanups.unshift(() => held.close());
      signal?.throwIfAborted();
      // A marked archive stage holds metadata/spools, never a recovery copy.
      // An unmarked or restore stage remains until its recovery proof exists.
      for (const entry of listOwnedDirectory(this.options.stateRoot, { required: true })) {
        if (!entry.isDirectory() || !/^\.session-storage-stage-[0-9a-f-]{36}$/.test(entry.name)) continue;
        const old = join(this.options.stateRoot, entry.name);
        if (readStorageText(join(old, "operation-kind")) === "archive") collectLeasedTree(old);
      }
      const stage = join(this.options.stateRoot, `.session-storage-stage-${randomUUID()}`);
      const lease = TreeLease.take(stage, true); cleanups.unshift(() => lease.release());
      ensureOwnedDurableDirectory(stage, stage, 0o700);
      // Failed restore trees may contain the last readable copy. Retain them;
      // after a successful restore of the same checkpoint they are collectible.
      let completed = !cold;
      cleanups.unshift(() => { if (completed) cleanupAll([() => removeOwnedTree(stage), () => removeOwnedFile(leasePathOf(stage))]); });
      writeExclusiveFsyncedFile(join(stage, "operation-kind"), cold ? "restore" : "archive");
      const keyPath = join(this.projectRoot, "password");
      const readyPath = join(this.projectRoot, "repository-ready"), identity = JSON.stringify({ kind: "oma-session-repository-v1", project: this.project });
      const ready = readStorageText(readyPath);
      if (ready !== null && ready !== identity) throw new StoreError("STORE_CORRUPT", "the session repository identity differs");
      const config = await optionalDigest(join(this.projectRoot, "repository/config"), signal);
      if (config === null && (cold || ready !== null)) throw new StoreError("STORE_CORRUPT", "the session repository is missing; no new history was initialized");
      // Before the first ready publication, an interrupted empty initialization
      // can retry with the same key. A nonempty unknown tree is never reset.
      if (config === null && listOwnedDirectory(this.projectRoot, { required: true }).some(entry => entry.name === "repository") &&
          listOwnedDirectory(join(this.projectRoot, "repository"), { required: true }).length !== 0)
        throw new StoreError("STORE_CORRUPT", "an uninitialized nonempty repository exists; retained for recovery");
      repairOwnedEntryMode(keyPath);
      if (readStorageText(keyPath) === null) {
        if (cold || config !== null) throw new StoreError("STORE_CORRUPT", "the session repository credential is missing; no replacement was created");
        publishNoReplace(keyPath, randomBytes(32).toString("hex") + "\n", 0o600);
      }
      const password = withinDirectory(keyPath, (parent, name) => openRegularBeneath(parent, name));
      cleanups.unshift(() => closeSync(password));
      const stat = fstatSync(password);
      if (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.nlink !== 1)
        throw new StoreError("STORE_CORRUPT", "session repository credential is not private");
      const restic = new ResticProcess({ tool, password, fence: this.options.fence, projectLock: held.descriptor,
        stageLease: lease.descriptor, projectRoot: this.projectRoot, stage, source: this.options.stateRoot,
        ...(signal === undefined ? {} : { signal }) });
      if (config === null) {
        await restic.init(); fsyncTree(join(this.projectRoot, "repository"));
      }
      publishNoReplace(readyPath, identity);
      held.assertHeld(lockPath);
      const result = await run(restic, stage, held); completed = true; return result;
    }, () => cleanupAll(cleanups));
  }
  /** Must run before prepareSociety or opening SQLite. Missing recovery metadata
   * never licenses seeding a fresh canonical repository over an existing DB. */
  async restore(signal?: AbortSignal): Promise<void> {
    const selected = this.selection(), checkpoint = selected?.checkpoint;
    if (checkpoint === null || checkpoint === undefined) {
      if (await optionalDigest(join(this.options.stateRoot, "runtime.sqlite"), signal) !== null &&
          !cacheDirectoryPresent(join(this.options.stateRoot, "repos/project.git")))
        throw new StoreError("STORE_CORRUPT", "an existing session has no canonical repository or cold checkpoint; provisioning was refused");
      return;
    }
    const committed = readStorageText(join(this.options.stateRoot, "session-checkpoints", `${checkpoint.snapshot}.json`));
    if (committed !== JSON.stringify(selected)) throw new StoreError("STORE_CORRUPT", "the selected immutable session checkpoint is missing or differs");
    await this.assertLedger(checkpoint.ledger, signal);
    await this.options.quiesce(checkpoint.residents, "stop");
    this.options.log("Restoring archived session workspace…");
    await this.repository(true, async (restic, stage, lock) => {
      writeExclusiveFsyncedFile(join(stage, "restore-snapshot"), checkpoint.snapshot);
      const target = join(stage, "restored");
      await restic.restore(checkpoint.snapshot, target);
      if ((await digestCacheTrees(target, checkpoint.roots, signal)).digest !== checkpoint.digest)
        throw new StoreError("STORE_CORRUPT", "restored session differs from its verified checkpoint; existing data was retained");
      fsyncTree(target, "workspace-links");
      await this.assertLedger(checkpoint.ledger, signal);
      await this.options.quiesce(checkpoint.residents, "confirm");
      signal?.throwIfAborted(); lock.assertHeld(lock.path);
      for (const root of checkpoint.roots) {
        ensureOwnedDurableDirectory(dirname(join(this.options.stateRoot, root)), this.options.stateRoot, 0o700);
        removeOwnedTree(join(this.options.stateRoot, root));
        moveCacheTree(this.options.stateRoot, `${stage.slice(this.options.stateRoot.length + 1)}/restored/${root}`, root);
      }
      if ((await digestCacheTrees(this.options.stateRoot, checkpoint.roots, signal)).digest !== checkpoint.digest)
        throw new StoreError("STORE_CORRUPT", "published session cache differs; cold selection was retained for recovery");
      await this.assertLedger(checkpoint.ledger, signal);
      await this.options.quiesce(checkpoint.residents, "confirm");
      signal?.throwIfAborted(); lock.assertHeld(lock.path);
      replaceDerivedFile(this.statePath, JSON.stringify(this.hot));
      // A fresh verified restore supersedes only old stages of this exact
      // immutable snapshot, and only after every inherited lease is free.
      for (const entry of listOwnedDirectory(this.options.stateRoot, { required: true })) {
        if (!entry.isDirectory() || !/^\.session-storage-stage-[0-9a-f-]{36}$/.test(entry.name)) continue;
        const old = join(this.options.stateRoot, entry.name);
        if (old === stage) continue;
        try { if (readStorageText(join(old, "restore-snapshot")) === checkpoint.snapshot) collectLeasedTree(old); }
        catch (error) { this.options.log(`Retained an old storage stage: ${String(error)}`); }
      }
      this.options.log("Archived session workspace restored and verified.");
    }, signal);
  }
  /** Called only after the Broker drain and Store.close have both completed.
   * Failure before cold selection leaves every original workspace in place. */
  async archive(residents: readonly StorageResident[]): Promise<void> {
    if (this.selection()?.checkpoint) throw new StoreError("STORE_CORRUPT", "a cold session cannot be archived again before restoration");
    await this.repository(false, async (restic, stage, lock) => {
      await this.options.quiesce(residents, "stop");
      const roots = ["repos", "staging", ...residents.flatMap(actor => [`agents/${actor.name}/workspace`, `agents/${actor.name}/home`])]
        .filter(root => cacheDirectoryPresent(join(this.options.stateRoot, root)));
      if (!roots.includes("repos")) throw new StoreError("STORE_CORRUPT", "canonical session repositories are missing");
      const ledger = await this.ledger();
      const before = await digestCacheTrees(this.options.stateRoot, roots);
      const list = join(stage, "roots"); writeExclusiveFsyncedFile(list, Buffer.from(roots.join("\0") + "\0"));
      this.options.log("Saving and verifying session workspace…");
      const snapshot = await restic.backup(this.options.society, list);
      await verifyResticInventory(await restic.inventory(snapshot), snapshot, roots.map(root => join(this.options.stateRoot, root)), before);
      await verifyResticDump(before, consume => restic.dump(snapshot, consume));
      if ((await digestCacheTrees(this.options.stateRoot, roots)).digest !== before.digest)
        throw new StoreError("REF_STATE_UNKNOWN", "session changed during backup; original workspace retained");
      await this.assertLedger(ledger);
      fsyncTree(join(this.projectRoot, "repository"));
      const checkpoint: StorageCheckpoint = { snapshot, roots, residents, digest: before.digest, ledger };
      const state: SessionStorageState = { ...this.hot, checkpoint };
      parseStorageState(JSON.stringify(state), this.options.society, this.project);
      ensureOwnedDurableDirectory(join(this.options.stateRoot, "session-checkpoints"), this.options.stateRoot, 0o700);
      const immutable = join(this.options.stateRoot, "session-checkpoints", `${snapshot}.json`), text = JSON.stringify(state);
      if (publishNoReplace(immutable, text) === "existing" && readStorageText(immutable) !== text)
        throw new StoreError("STORE_CORRUPT", "an immutable session checkpoint differs");
      // The permanent identity detects loss of the mutable selection. Publish
      // hot first so an interruption before the first cold commit stays hot.
      if (readStorageText(this.statePath) === null) publishNoReplace(this.statePath, JSON.stringify(this.hot));
      publishNoReplace(this.enabledPath, JSON.stringify(this.hot));
      await this.options.quiesce(residents, "confirm"); await this.assertLedger(ledger); lock.assertHeld(lock.path);
      replaceDerivedFile(this.statePath, text);
      for (const root of roots) removeOwnedTree(join(this.options.stateRoot, root));
      this.options.log(`Session workspace archived; reclaimed ${before.bytes} logical file bytes.`);
    });
  }
}
