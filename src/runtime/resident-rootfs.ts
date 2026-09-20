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
 * bytes. This runs on every `oma` start, before anything knows which process
 * owns the society, so a start that loses that race must leave the tree byte
 * for byte as it found it -- including inode identity and timestamps, which a
 * rewrite of identical content destroys.
 */
import { lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { StoreError } from "../domain/errors.js";
import { DEPLOYMENT_LAYOUT } from "../domain/deployment.js";
import { RESIDENT_PATHS, SYSTEM_BIND_CANDIDATES } from "../sandbox.js";

export interface SystemLayout {
  /** Host paths bound read-only at the same path. */
  readonly binds: readonly string[];
  /** Top-level links the host has (merged-/usr distributions), reproduced in
   * the skeleton so `/bin/sh` resolves inside the same way it does outside. */
  readonly links: readonly { readonly path: string; readonly target: string }[];
}

function kind(path: string): "dir" | "file" | "link" | "absent" {
  const stat = lstatSync(path, { throwIfNoEntry: false });
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

function ensureDirectory(path: string): void {
  const found = kind(path);
  if (found === "dir") return;
  if (found !== "absent")
    throw new StoreError("STORE_CORRUPT", `rootfs mount target ${path} is not a directory`);
  mkdirSync(path, { recursive: true, mode: 0o755 });
}

function ensureFile(path: string, content = ""): void {
  const found = kind(path);
  if (found === "file") {
    // Generated content is written only when what is there is not already it.
    // A write that reproduces the same bytes is still a write: it replaces the
    // file every time the product starts, which is the one thing this module
    // says it does not do to something that exists. An empty content means the
    // file is a mount target and its contents are not this module's business.
    if (content.length > 0 && readExisting(path) !== content)
      writeFileSync(path, content, { mode: 0o644 });
    return;
  }
  if (found !== "absent")
    throw new StoreError("STORE_CORRUPT", `rootfs mount target ${path} is not a file`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  writeFileSync(path, content, { mode: 0o644 });
}

/** What is in a generated file now. Unreadable is not "different": it is a
 * rootfs entry this module cannot account for, and rewriting it would be the
 * silent overwrite this module refuses elsewhere. */
function readExisting(path: string): string {
  try { return readFileSync(path, "utf8"); }
  catch (error) {
    throw new StoreError("STORE_CORRUPT",
      `rootfs identity file ${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function ensureLink(path: string, target: string): void {
  const found = kind(path);
  if (found === "link") {
    if (readlinkSync(path) === target) return;
    // Only a symlink is ever removed here, and only to point it back.
    unlinkSync(path);
  } else if (found !== "absent") {
    throw new StoreError("STORE_CORRUPT", `rootfs entry ${path} is not the expected link`);
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  symlinkSync(target, path);
}

/** TUI-003: which of the product surface's installed files exist, so the mount
 * plan can hide them. A link is refused: hiding the link would leave its
 * target, and the installation has no reason to contain one. */
export function productSurfaceMasks(libdir: string): readonly { path: string; kind: "dir" | "file" }[] {
  const masks: { path: string; kind: "dir" | "file" }[] = [];
  for (const path of DEPLOYMENT_LAYOUT.productSurface) {
    const found = kind(join(libdir, path));
    if (found === "absent") continue;
    if (found === "link")
      throw new StoreError("UNSUPPORTED_PROFILE", `installed product path ${path} is a link`);
    masks.push({ path, kind: found });
  }
  return Object.freeze(masks);
}

/** Creates or repairs the skeleton at `rootfs` for the given host layout. */
export function prepareResidentRootfs(rootfs: string, layout: SystemLayout, uid: number, gid: number): void {
  ensureDirectory(rootfs);
  const inside = (path: string): string => join(rootfs, path);
  for (const path of ["/proc", "/dev", "/tmp", "/etc", dirname(RESIDENT_PATHS.node),
    RESIDENT_PATHS.workspace, RESIDENT_PATHS.home, RESIDENT_PATHS.archive, RESIDENT_PATHS.selfMail,
    RESIDENT_PATHS.view, RESIDENT_PATHS.world, RESIDENT_PATHS.projectGit, RESIDENT_PATHS.sessions,
    RESIDENT_PATHS.libdir])
    ensureDirectory(inside(path));
  for (const path of [RESIDENT_PATHS.node, RESIDENT_PATHS.socket, RESIDENT_PATHS.inference])
    ensureFile(inside(path));
  for (const path of layout.binds)
    if (kind(path) === "file") ensureFile(inside(path));
    else ensureDirectory(inside(path));
  for (const link of layout.links) ensureLink(inside(link.path), link.target);
  // bwrap cannot create this on a read-only root; it must already be there.
  ensureLink(inside("/inbox.md"), `${RESIDENT_PATHS.view}/inbox.md`);
  // Programs that ask who they are get an answer that names only the agent.
  ensureFile(inside("/etc/passwd"), `agent:x:${uid}:${gid}:agent:${RESIDENT_PATHS.home}:/bin/sh\n`);
  ensureFile(inside("/etc/group"), `agent:x:${gid}:\n`);
}
