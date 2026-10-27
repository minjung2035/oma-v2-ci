import { statAt, readlinkAt, unlinkAt, symlinkAt } from "@oma/native/posix-files";
/** SB-001/002: the trusted rootfs a Resident runs on, made by OMA itself.
 *
 * SB-001 asks for a rootfs holding pinned tools and empty mount targets, and
 * forbids binding the host `/` or `/home`. Asking every user to build one would
 * make confinement something nobody turns on, so `oma` builds it: a directory
 * of empty mount targets, mounted read-only as `/`, with the operating
 * system's programs and libraries bound read-only over it. Nothing from the
 * host's `/etc` is copied in; the few identity files a program needs are
 * generated and name only the agent.
 *
 * The skeleton is idempotent and conservative: it creates what is missing,
 * corrects a symlink that points elsewhere, and refuses — rather than deletes —
 * anything else it does not expect, because a mount target with content in it
 * means something other than OMA put it there.
 *
 * Idempotent means no write at all, not a write that happens to land the same
 * bytes: the inode and the timestamps are what a concurrent owner, and a
 * program reading inside the sandbox, actually observe.
 *
 * Creating what is absent and correcting what is wrong are two policies, not
 * one, and they need different authority. Creating is safe for anyone: the
 * entry did not exist, so nothing that exists is disturbed, and two starts
 * racing to create the same thing agree on the result. Correcting is a write
 * over state that may belong to another process's society, and REC-007 says a
 * process that does not own the society does not make one. So the pass is
 * named: `"create"` leaves anything that exists but differs alone and reports
 * it, and `"repair"` -- which only an owner runs -- puts it back.
 */
import { closeSync, constants, fstatSync, lstatSync, statSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { trustedAbsolutePath } from "@oma/protocol/run-lease";
import { StoreError, unobserved } from "@oma/domain/errors";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { RESIDENT_NODE_TOOLCHAIN, RESIDENT_PATHS } from "@oma/domain/resident-paths";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { openBeneath, openRegularBeneath, withinDirectory } from "@oma/native/files";

/** Linux-only mount policy; never part of the common HostConfig. */
export const SYSTEM_BIND_CANDIDATES: readonly string[] = Object.freeze([
  "/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc/alternatives", "/etc/ld.so.cache",
  "/etc/resolv.conf", "/etc/ssl/certs", "/etc/pki/ca-trust", "/etc/pki/tls/certs",
  "/etc/nsswitch.conf", "/etc/hosts", "/etc/localtime",
]);

/** The platform selects its owned skeleton from the trusted state root. */
export function residentRootfsPath(stateRoot: string): string {
  if (!trustedAbsolutePath(stateRoot)) throw new StoreError("UNSUPPORTED_PROFILE", "Linux confinement needs a trusted state root");
  return join(stateRoot, "rootfs");
}

export interface SystemLayout {
  /** Host paths bound read-only at the same path. */
  readonly binds: readonly string[];
  /** Top-level links the host has (merged-/usr distributions), reproduced in
   * the skeleton so `/bin/sh` resolves inside the same way it does outside. */
  readonly links: readonly { readonly path: string; readonly target: string }[];
}

function kind(path: string): "dir" | "file" | "link" | "absent" {
  return kindOf(lstatSync(path, { throwIfNoEntry: false }));
}
/** FS-005 / architecture section 4: an entry of a directory this pass holds. The rootfs is under the state
 * tree, so what is checked and what is then written are always the same entry,
 * named through one resolution of its parent. */
function kindAt(parent: number, name: string): "dir" | "file" | "link" | "absent" {
  return kindOf(statAt(parent, name, { throwIfNoEntry: false }));
}
function kindOf(stat: ReturnType<typeof lstatSync> | undefined): "dir" | "file" | "link" | "absent" {
  if (!stat) return "absent";
  if (stat.isSymbolicLink()) return "link";
  if (stat.isDirectory()) return "dir";
  return "file";
}

/** What of the host's operating system a Resident may see. A top-level link is
 * reproduced only when it stays inside `/usr`; anything else is not followed. */
export function hostSystemLayout(root = "/"): SystemLayout {
  const binds: string[] = [];
  const links: { path: string; target: string }[] = [];
  for (const path of SYSTEM_BIND_CANDIDATES) {
    const host = join(root, path);
    const found = kind(host);
    if (found === "absent") continue;
    if (path.startsWith("/etc/")) {
      const target = statSync(host, { throwIfNoEntry: false });
      if (target === undefined) continue;
      if (!target.isFile() && !target.isDirectory())
        throw new StoreError("UNSUPPORTED_PROFILE", `system mount ${path} is not a file or directory`);
      binds.push(path);
      continue;
    }
    if (found === "link") {
      const target = readlinkSync(host);
      if (/^(\/?usr)(\/[A-Za-z0-9._-]+)*$/.test(target) && !target.includes(".."))
        links.push({ path, target });
      continue;
    }
    binds.push(path);
  }
  if (!binds.includes("/usr"))
    throw new StoreError("UNSUPPORTED_PROFILE", "the host has no /usr to give a confined Resident its programs");
  return Object.freeze({ binds: Object.freeze(binds), links: Object.freeze(links) });
}

/** Which pass this is. `"create"` may only bring absent entries into
 * existence; `"repair"` may also correct an entry that is there and wrong. */
export type RootfsPass = "create" | "repair";

function ensureOwned(path: string, ownedFrom: string): void {
  // P0-8/DR32: every ensured path is under the rootfs, which is oma's own
  // under the state root -- the boundary is repaired component by component,
  // so a mode-000 skeleton directory a stray left cannot wedge provisioning.
  try { ensureOwnedDirectory(path, ownedFrom, 0o755); }
  catch (error) {
    if (error instanceof StoreError) throw new StoreError("STORE_CORRUPT", `rootfs mount target ${path} is not a directory`);
    throw error;
  }
}

/** provisionSociety is "safe to lose a race with another start": an entry
 * another start created between this one's look and its create (EEXIST) is
 * observed like any existing entry -- once; a second loss is not a race. */
function lostRace(error: unknown, retried: boolean): boolean {
  return !retried && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function ensureFile(path: string, pass: Pass, content = "", retried = false): void {
  ensureOwned(dirname(path), pass.boundary);
  withinDirectory(path, (parent, name) => {
    const found = kindAt(parent, name);
    if (found === "file") {
      // Generated content is written only when what is there is not already it.
      // A write that reproduces the same bytes is still a write: it replaces the
      // file every time the product starts, which is the one thing this module
      // says it does not do to something that exists. An empty content means the
      // file is a mount target and its contents are not this module's business.
      if (content.length === 0 || readExisting(parent, name, path) === content) return;
      if (pass.mode === "create") { pass.differing.push(path); return; }
      const fd = openBeneath(parent, name, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW);
      try { writeFileSync(fd, content); } finally { closeSync(fd); }
      pass.corrected.push(path);
      return;
    }
    if (found !== "absent")
      throw new StoreError("STORE_CORRUPT", `rootfs mount target ${path} is not a file`);
    let fd: number;
    try { fd = openBeneath(parent, name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644); }
    catch (error) { if (lostRace(error, retried)) { ensureFile(path, pass, content, true); return; } throw error; }
    try { writeFileSync(fd, content); } finally { closeSync(fd); }
  });
}

/** What is in a generated file now. Unreadable is not "different": it is a
 * rootfs entry this module cannot account for, and rewriting it would be the
 * silent overwrite this module refuses elsewhere. One that cannot be read now
 * is not known to be foreign either (DR13); both refuse the rewrite. */
function readExisting(parent: number, name: string, path: string): string {
  try {
    const fd = openRegularBeneath(parent, name);
    try { if (!fstatSync(fd).isFile()) throw new Error("not a regular file"); return readFileSync(fd, "utf8"); }
    finally { closeSync(fd); }
  } catch (error) {
    throw unobserved(error, `the rootfs identity file ${path}`) ?? new StoreError("STORE_CORRUPT",
      `rootfs identity file ${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function ensureLink(path: string, target: string, pass: Pass, retried = false): void {
  ensureOwned(dirname(path), pass.boundary);
  withinDirectory(path, (parent, name) => {
    const found = kindAt(parent, name);
    if (found === "link") {
      if (readlinkAt(parent, name) === target) return;
      if (pass.mode === "create") { pass.differing.push(path); return; }
      // Only a symlink is ever removed here, and only to point it back.
      unlinkAt(parent, name);
      symlinkAt(target, parent, name);
      pass.corrected.push(path);
      return;
    }
    if (found !== "absent")
      throw new StoreError("STORE_CORRUPT", `rootfs entry ${path} is not the expected link`);
    try { symlinkAt(target, parent, name); }
    catch (error) { if (lostRace(error, retried)) { ensureLink(path, target, pass, true); return; } throw error; }
  });
}

interface Pass {
  readonly mode: RootfsPass;
  /** The first component oma itself made on every path this pass ensures
   * (the rootfs): the owned repair runs from it down and never above it. */
  readonly boundary: string;
  /** Entries that exist, differ from what this module generates, and were left
   * alone because this pass may not correct them. */
  readonly differing: string[];
  /** Entries this pass put back. */
  readonly corrected: string[];
}

/** What a pass found it could not leave as it is. */
export interface RootfsOutcome {
  /** Entries a `"create"` pass left alone because correcting them is a write
   * over existing state; empty after a `"repair"` pass. */
  readonly deferred: readonly string[];
  /** Entries a `"repair"` pass put back; empty after a `"create"` pass. */
  readonly corrected: readonly string[];
}

/** TUI-003: which of the product surface's installed files exist, so the mount
 * plan can hide them. A link is refused: hiding the link would leave its
 * target, and the installation has no reason to contain one. */
/** Brings the skeleton at `rootfs` up for the given host layout.
 *
 * A `"create"` pass makes everything that is absent and reports -- rather than
 * corrects -- every generated entry that is there and differs, so it is safe
 * to run before this process is known to own the society. A `"repair"` pass
 * also corrects those, and only an owner runs one. */
export function prepareResidentRootfs(
  rootfs: string, layout: SystemLayout, uid: number, gid: number, mode: RootfsPass = "create",
): RootfsOutcome {
  const pass: Pass = { mode, boundary: rootfs, differing: [], corrected: [] };
  ensureOwned(rootfs, dirname(rootfs));
  const inside = (path: string): string => join(rootfs, path);
  for (const path of ["/proc", "/dev", "/tmp", "/etc", "/quarantine", "/bundle", dirname(RESIDENT_PATHS.node),
    RESIDENT_PATHS.workspace, RESIDENT_PATHS.home, RESIDENT_PATHS.archive, RESIDENT_PATHS.workerArchive, RESIDENT_PATHS.selfMail,
    RESIDENT_PATHS.view, RESIDENT_PATHS.world, RESIDENT_PATHS.projectGit, RESIDENT_PATHS.projectMirror, RESIDENT_PATHS.sessions,
    RESIDENT_PATHS.libdir, RESIDENT_PATHS.packages])
    ensureOwned(inside(path), pass.boundary);
  for (const path of ["/bundle/input.bundle", RESIDENT_PATHS.node, RESIDENT_PATHS.socket, RESIDENT_PATHS.inference, RESIDENT_PATHS.egress])
    ensureFile(inside(path), pass);
  // FI-2: the pinned Node's package managers, laid out as its distribution's
  // `bin/` is -- a relative link per command into a module mount target.
  for (const { command, module, entry } of RESIDENT_NODE_TOOLCHAIN) {
    ensureOwned(inside(`${RESIDENT_PATHS.nodeModules}/${module}`), pass.boundary);
    ensureLink(inside(`${dirname(RESIDENT_PATHS.node)}/${command}`),
      `${relative(dirname(RESIDENT_PATHS.node), RESIDENT_PATHS.nodeModules)}/${module}/${entry}`, pass);
  }
  for (const path of layout.binds)
    if (statSync(path).isFile()) ensureFile(inside(path), pass);
    else ensureOwned(inside(path), pass.boundary);
  for (const link of layout.links) ensureLink(inside(link.path), link.target, pass);
  // bwrap cannot create this on a read-only root; it must already be there.
  ensureLink(inside("/inbox.md"), `${RESIDENT_PATHS.view}/inbox.md`, pass);
  // Programs that ask who they are get an answer that names only the agent.
  ensureFile(inside("/etc/passwd"), pass, `agent:x:${uid}:${gid}:agent:${RESIDENT_PATHS.home}:/bin/sh\n`);
  ensureFile(inside("/etc/group"), pass, `agent:x:${gid}:\n`);
  return Object.freeze({ deferred: Object.freeze([...pass.differing]), corrected: Object.freeze([...pass.corrected]) });
}
