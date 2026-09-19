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
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
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

/** A bare repository on `main`, created only if the path is absent. An existing
 * path is left exactly as it is: a repository that is present but broken is a
 * condition for the operator to see, not one to overwrite. */
function ensureBareRepository(path: string, format = "sha1"): boolean {
  if (existsSync(path)) return false;
  if (format !== "sha1" && format !== "sha256")
    throw new StoreError("UNSUPPORTED_PROFILE", `the project uses an unsupported object format ${format}`);
  git(["init", "--quiet", "--bare", "--initial-branch=main", `--object-format=${format}`, path]);
  return true;
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
function seedFromProject(projectGit: string, projectDir: string, oid: string): void {
  const fetched = runGitText(["fetch", "--no-tags", "--quiet", projectDir, `${oid}:refs/heads/main`],
    { gitDir: projectGit, timeout: 10 * 60 * 1000 });
  if (fetched.status !== 0)
    throw new StoreError("STORE_CORRUPT",
      `society provisioning could not import the project's history: ${fetched.stderr.trim().slice(0, 200)}`);
  const landed = runGitText(["rev-parse", "--verify", "refs/heads/main^{commit}"], { gitDir: projectGit });
  if (landed.status !== 0 || landed.stdout.trim() !== oid)
    throw new StoreError("STORE_CORRUPT", "the imported canonical main is not the project's HEAD");
}

function seedEmptyRoot(projectGit: string): void {
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
  // provisioner that won the race is not overwritten.
  git(["update-ref", "--create-reflog", "refs/heads/main", commit.stdout.trim(), ""], projectGit);
}

/** Brings a society's state tree to the point where the broker will start.
 * Safe to call on every run; it reports what it had to create. */
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
    if (project !== null && "oid" in project) { seedFromProject(projectGit, options.projectDir!, project.oid); seedSource = "project"; }
    else { seedEmptyRoot(projectGit); seedSource = "empty"; }
  }
  const seeded = seedSource !== null;
  const seedNote = project !== null && "note" in project && seeded ? project.note : null;
  // Confinement on by default: the rootfs is built here rather than being a
  // thing the user must assemble before Residents can be sandboxed.
  prepareResidentRootfs(residentRootfsPath(stateRoot), hostSystemLayout(),
    process.getuid?.() ?? 0, process.getgid?.() ?? 0);
  return Object.freeze({ created: Object.freeze(created), seeded, seedSource, seedNote });
}
