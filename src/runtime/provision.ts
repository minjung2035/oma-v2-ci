/** CFG-002/TUI-002: bringing a society's state tree into existence.
 *
 * The broker refuses to start against a state tree that is not already there:
 * it opens a ledger, reads a canonical repository and asks it for a pinned
 * `main`. Until now nothing created any of that, so `oma` in a fresh project
 * had no broker, and with no broker there were no residents and no observed
 * status. This module is the missing step, and it runs on every start because
 * it is idempotent: it creates what is absent and touches nothing that exists.
 *
 * `oma` names the society after the project directory, so the society works
 * on that project: the canonical `main` starts at the project's committed
 * `HEAD`. Only committed history is taken — what a clone would take — never
 * uncommitted files, and never anything past the first start: afterwards the
 * canonical repository moves only through OMA's own integration. A directory
 * that is not a repository, or one with no commit yet, starts from an empty
 * root commit, and the report says which happened.
 *
 * REC-007: this only ever creates. Correcting something that is there and
 * wrong is a write over state that may belong to another process's society, so
 * it is a separate pass -- `repairSociety` -- which the product runs only once
 * it holds the society lease. What this finds and cannot create is reported,
 * not fixed.
 *
 * Where two starts can race to create the same thing, the loser adopts what
 * the winner made rather than failing: a society has one canonical `main`, and
 * which of two simultaneous starts wrote it is not a distinction worth having.
 * That has to hold for the repository itself and not only for its refs. `git
 * init` into the final path is several writes -- make the directory, copy the
 * templates, write the config -- and a second start can see the first one's
 * half-built tree, or land its templates on top of it. So a repository is
 * built under a name nothing else can be using and moved into place in one
 * step.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { StoreError } from "../domain/errors.js";
import { runGitText } from "../process/policies.js";
import { ensureDurableDirectory } from "../storage/durable-fs.js";
import { hostSystemLayout, prepareResidentRootfs } from "./resident-rootfs.js";

/** The trusted rootfs OMA builds for its Residents (SB-001). */
export function residentRootfsPath(stateRoot: string): string { return join(stateRoot, "rootfs"); }

/** Directories the broker, mail and Git modules expect to already exist. */
const OWNED_DIRECTORIES: readonly string[] = Object.freeze([
  "repos", "world", "agents",
  join("mail", "objects"),
  join("mail", "inboxes"),
  join("mail", "archive", "new"),
  join("mail", "archive", "cur"),
  join("mail", "archive", "tmp"),
  // The Principal's own private space. The product starts an engine whose
  // working directory is this path, and a process cannot be started in a
  // directory that does not exist, so it is provisioned like the rest of the
  // tree rather than left for the first run to discover (TUI-004).
  join("principal", "private"),
  // Where the Principal's engine keeps its session: inside its own private
  // space (PR-003), not beside the runner artifacts of other agents.
  join("principal", "private", "sessions"),
]);

export interface ProvisionReport {
  /** Directories this call created. Empty on an already-provisioned society. */
  readonly created: readonly string[];
  /** True when this call seeded the canonical repository's first commit. */
  readonly seeded: boolean;
  /** Where the canonical `main` came from, when this call seeded it. */
  readonly seedSource: "project" | "empty" | null;
  /** Why a project directory was not used, when it was offered and not used. */
  readonly seedNote: string | null;
  /** Rootfs entries that exist, are not what OMA generates, and were left
   * exactly as they are because correcting them is a write this pass is not
   * entitled to make. `repairSociety` is what puts them back. */
  readonly pendingRepairs: readonly string[];
}

export interface ProvisionOptions {
  /** The directory `oma` was started in; its committed `HEAD` seeds `main`. */
  readonly projectDir?: string;
}

/** The project's committed `HEAD` and object format, or why there is none. */
function projectHead(projectDir: string): { oid: string; format: string } | { note: string } {
  const head = runGitText(["-C", projectDir, "rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  if (head.status !== 0 || head.stdout.trim().length === 0)
    return { note: "the project directory has no committed HEAD" };
  const format = runGitText(["-C", projectDir, "rev-parse", "--show-object-format"]);
  return { oid: head.stdout.trim(), format: format.status === 0 ? format.stdout.trim() : "sha1" };
}

function git(argv: readonly string[], gitDir?: string): string {
  const result = runGitText(argv, gitDir === undefined ? {} : { gitDir });
  if (result.status !== 0)
    throw new StoreError("STORE_CORRUPT",
      `society provisioning could not run git ${argv[0] ?? ""}: ${result.stderr.trim().slice(0, 200)}`);
  return result.stdout.trim();
}

/** A bare repository on `main`, created only if the path is absent, and never
 * visible half-built. An existing path is left exactly as it is: a repository
 * that is present but broken is a condition for the operator to see, not one
 * to overwrite -- and a repository another start is creating right now is not
 * a failure either, so a lost race adopts what the winner made.
 *
 * The staging name is dot-prefixed and carries this process's identity, so no
 * two starts can pick the same one and nothing walking `repos/` mistakes it
 * for a society repository. `rename` onto a directory that already has the
 * winner's repository in it is refused by the kernel, which is exactly the
 * signal that this start lost. */
function ensureBareRepository(path: string, format = "sha1"): boolean {
  if (existsSync(path)) return false;
  if (format !== "sha1" && format !== "sha256")
    throw new StoreError("UNSUPPORTED_PROFILE", `the project uses an unsupported object format ${format}`);
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const staging = join(parent, `.${basename(path)}.staging.${randomBytes(8).toString("hex")}`);
  try {
    git(["init", "--quiet", "--bare", "--initial-branch=main", `--object-format=${format}`, staging]);
    try { renameSync(staging, path); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // The winner's repository is already there. Anything else is a real
      // failure and is not quietly read as "someone else did it".
      if (code !== "ENOTEMPTY" && code !== "EEXIST" && code !== "ENOTDIR") throw error;
      return false;
    }
    return true;
  } finally {
    // Nothing is left behind on either path: after a successful rename there
    // is no staging directory to remove, and after a lost race there is.
    rmSync(staging, { recursive: true, force: true });
  }
}

/** The canonical `main` the broker requires. The commit is empty and its
 * identity is fixed here rather than read from the user's Git configuration,
 * so provisioning does not depend on, or record, who is running it. */
function hasCanonicalMain(projectGit: string): boolean {
  const existing = runGitText(["rev-parse", "--verify", "--quiet", "refs/heads/main^{commit}"], { gitDir: projectGit });
  return existing.status === 0 && existing.stdout.trim().length > 0;
}

/** Seeds `main` from the project's committed history. The fetch runs under the
 * trusted Git environment: no hooks, no user or system configuration, and
 * `upload-pack` ignores command-running settings in repository configuration. */
function seedFromProject(projectGit: string, projectDir: string, oid: string): boolean {
  const fetched = runGitText(["fetch", "--no-tags", "--quiet", projectDir, `${oid}:refs/heads/main`],
    { gitDir: projectGit, timeout: 10 * 60 * 1000 });
  if (fetched.status !== 0) {
    // A concurrent start that seeded first leaves a `main` this fetch cannot
    // move. That is the other start's canonical history, not a failure.
    if (hasCanonicalMain(projectGit)) return false;
    throw new StoreError("STORE_CORRUPT",
      `society provisioning could not import the project's history: ${fetched.stderr.trim().slice(0, 200)}`);
  }
  const landed = runGitText(["rev-parse", "--verify", "refs/heads/main^{commit}"], { gitDir: projectGit });
  if (landed.status !== 0)
    throw new StoreError("STORE_CORRUPT", "the imported canonical main is not the project's HEAD");
  return landed.stdout.trim() === oid;
}

function seedEmptyRoot(projectGit: string): boolean {
  const tree = git(["hash-object", "-t", "tree", "-w", "--stdin"], projectGit);
  const identity = [
    "-c", "user.name=OMA", "-c", "user.email=oma@localhost",
    "-c", "committer.name=OMA", "-c", "committer.email=oma@localhost",
  ];
  const commit = runGitText(
    [...identity, "commit-tree", tree, "-m", "oma: canonical root"],
    { gitDir: projectGit, env: {
      GIT_AUTHOR_NAME: "OMA", GIT_AUTHOR_EMAIL: "oma@localhost",
      GIT_COMMITTER_NAME: "OMA", GIT_COMMITTER_EMAIL: "oma@localhost",
    } },
  );
  if (commit.status !== 0 || commit.stdout.trim().length === 0)
    throw new StoreError("STORE_CORRUPT", "society provisioning could not create the canonical root commit");
  // Created only from nothing: the old value must be absent, so a concurrent
  // provisioner that won the race is not overwritten -- and losing it is not a
  // failure, because what the winner created is the same canonical root.
  const created = runGitText(["update-ref", "--create-reflog", "refs/heads/main", commit.stdout.trim(), ""],
    { gitDir: projectGit });
  if (created.status === 0) return true;
  if (hasCanonicalMain(projectGit)) return false;
  throw new StoreError("STORE_CORRUPT",
    `society provisioning could not create the canonical main: ${created.stderr.trim().slice(0, 200)}`);
}

/** Brings a society's state tree to the point where the broker will start, by
 * creating what is absent and nothing else. Safe to call on every run and safe
 * to lose a race with another start; it reports what it had to create, and
 * what it found wrong and deliberately did not touch. */
export function provisionSociety(stateRoot: string, options: ProvisionOptions = {}): ProvisionReport {
  const created: string[] = [];
  for (const relative of [".", ...OWNED_DIRECTORIES]) {
    const path = relative === "." ? stateRoot : join(stateRoot, relative);
    if (existsSync(path)) continue;
    // Durable because a half-created tree that survives a crash would make the
    // next start fail in a way that looks like corruption.
    ensureDurableDirectory(path, 0o700);
    created.push(relative);
  }
  const projectGit = join(stateRoot, "repos", "project.git");
  // The project is consulted only while the canonical repository has no main;
  // after that its history belongs to the society, not to this directory.
  const fresh = !existsSync(projectGit) || !hasCanonicalMain(projectGit);
  const project = fresh && options.projectDir !== undefined ? projectHead(options.projectDir) : null;
  const format = project !== null && "oid" in project ? project.format : "sha1";
  if (ensureBareRepository(projectGit, format)) created.push(join("repos", "project.git"));
  if (ensureBareRepository(join(stateRoot, "repos", "context.git"))) created.push(join("repos", "context.git"));
  let seedSource: ProvisionReport["seedSource"] = null;
  if (!hasCanonicalMain(projectGit)) {
    // Reported only by the start that actually seeded. A start that lost the
    // race created nothing and says so, so the product does not tell the user
    // it started a society that was already there.
    if (project !== null && "oid" in project) {
      if (seedFromProject(projectGit, options.projectDir!, project.oid)) seedSource = "project";
    } else if (seedEmptyRoot(projectGit)) seedSource = "empty";
  }
  const seeded = seedSource !== null;
  const seedNote = project !== null && "note" in project && seeded ? project.note : null;
  // Confinement on by default: the rootfs is built here rather than being a
  // thing the user must assemble before Residents can be sandboxed.
  const rootfs = prepareResidentRootfs(residentRootfsPath(stateRoot), hostSystemLayout(),
    process.getuid?.() ?? 0, process.getgid?.() ?? 0, "create");
  return Object.freeze({
    created: Object.freeze(created), seeded, seedSource, seedNote,
    pendingRepairs: rootfs.deferred,
  });
}

/** Puts back the generated rootfs entries `provisionSociety` found wrong and
 * left alone, and answers which ones it corrected.
 *
 * This writes over state that exists, so the product calls it only once it
 * holds the society lease. Keeping it out of `provisionSociety` is what lets
 * both rules be true at once: a rootfs that lies about who the agent is gets
 * corrected, and a process that does not own the society corrects nothing. */
export function repairSociety(stateRoot: string): readonly string[] {
  return prepareResidentRootfs(residentRootfsPath(stateRoot), hostSystemLayout(),
    process.getuid?.() ?? 0, process.getgid?.() ?? 0, "repair").corrected;
}
