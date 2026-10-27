import { renameAt, linkAt, unlinkAt } from "@oma/native/posix-files";
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
 * on that project: the first canonical `main` captures its current worktree,
 * with committed HEAD as parent (or no parent for an unborn/plain directory).
 * The user's index, refs and worktree are not written. After the first start,
 * canonical history moves only through OMA's own integration. A bare source
 * is an already-frozen imported snapshot and supplies its committed HEAD.
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
import { closeSync, existsSync, fstatSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { StoreError, unobserved } from "@oma/domain/errors";
import { isValidSocietyName } from "@oma/domain/identifiers";
import { modelWorkspaceFor } from "@oma/domain/derived";
import { runGitText } from "@oma/process/policies";
import { withProjectSnapshot, SNAPSHOT_GIT_OPTIONS } from "@oma/git/project-snapshot";
import { createCanonicalObserver, createCanonicalRef } from "@oma/git/canonical-command";
import { repositoryHealthCommand } from "@oma/git/repository-health";
import { ensureOwnedDurableDirectory, fsyncHeldDir, fsyncTree, writeExclusiveFsyncedFile } from "@oma/storage/durable-fs";
import { ensureOwnedDirectory, removeOwnedFile } from "@oma/storage/directory";
import { TreeLease, collectLeasedTree } from "@oma/storage/tree-lease";
import { openRegularBeneath, withinDirectory } from "@oma/native/files";
import { hostSystemLayout, prepareResidentRootfs, residentRootfsPath } from "@oma/platform-linux/resident-rootfs";
import { projectGitPathAt, projectMirrorPathAt } from "@oma/domain/paths";


/** Directories the broker, mail and Git modules expect to already exist. */
const OWNED_DIRECTORIES: readonly string[] = Object.freeze([
  "repos", "world", "agents",
  join("mail", "objects"),
  join("mail", "inboxes"),
  join("mail", "archive", "new"),
  join("mail", "archive", "cur"),
  join("mail", "archive", "tmp"),
  // mail-v1: worker-only review mail publishes to its own archive, bound into
  // each Resident's sandbox; the bind never targets a missing directory.
  join("mail", "workers", "new"),
  join("mail", "workers", "cur"),
  join("mail", "workers", "tmp"),
  // The Principal's own private space. The product starts an engine whose
  // working directory is this path, and a process cannot be started in a
  // directory that does not exist, so it is provisioned like the rest of the
  // tree rather than left for the first run to discover (TUI-004).
  join("principal", "private"),
  // Where the Principal's engine keeps its session: inside its own private
  // space (PR-003), not beside the runner artifacts of other agents.
  join("principal", "private", "sessions"),
  // The Principal's private scratch, apart from the sessions beside it: its
  // engine starts there and its CLI keeps its cache there (PR-003/PR-004,
  // FS-003).
  modelWorkspaceFor("principal"),
]);

export interface ProvisionReport {
  /** Fresh strict history validation plus Git-created snapshot, never persisted. */
  readonly verifiedMain?: string;
  /** Directories this call created. Empty on an already-provisioned society. */
  readonly created: readonly string[];
  /** True when this call seeded the canonical repository's first commit. */
  readonly seeded: boolean;
  /** Where the canonical `main` came from, when this call seeded it. */
  readonly seedSource: "project" | "empty" | null;
  /** Why a project directory was not used, when it was offered and not used. */
  readonly seedNote: string | null;
  /** DR18 (D-8): why the project mirror was not refreshed this start, when a
   * project directory was offered; null when it was. */
  readonly mirrorNote: string | null;
  /** UX-09: why the canonical `main` will refuse every integration, naming the
   * submodule gitlink paths it carries; null when it carries none or could
   * not be observed (the integration gate is the authoritative refusal). */
  readonly gitlinkNote: string | null;
  /** Rootfs entries that exist, are not what OMA generates, and were left
   * exactly as they are because correcting them is a write this pass is not
   * entitled to make. `repairSociety` is what puts them back. */
  readonly pendingRepairs: readonly string[];
}

export interface ProvisionOptions {
  /** The directory `oma` was started in; its committed `HEAD` seeds `main`. */
  readonly projectDir?: string;
  /** The host prepares private UI paths; the fenced broker owns repository work. */
  readonly conversationOnly?: boolean;
  /** Internal preparation: overlap a strict check of the owned history with
   * file capture. The consumer waits before publishing canonical main. */
  readonly verifyHistory?: (repository: string, transfer?: FreshHistoryTransfer) => Promise<void>;
}

/** Only this invocation's completed strict Git transfer into a new owned
 * repository. Never persisted or inferred from an existing mirror. It is an
 * observation of checked objects, not permission to publish canonical main. */
export interface FreshHistoryTransfer {
  readonly kind: "strict-transfer";
  readonly repository: string;
}

/** The project's committed `HEAD` and object format, or why there is none.
 * WP16.04: "none" is only a directory that is not a repository or a
 * repository whose HEAD is unborn. A Git observation that fails any other way
 * is an error, never a reason to start the society from an empty root. */
function projectHead(projectDir: string): { oid: string; format: string } | { note: string } {
  const repository = runGitText(["-C", projectDir, "rev-parse", "--git-dir"]);
  if (repository.status !== 0) {
    // Git reports an unreadable `.git` exactly as it reports no repository at
    // all, so the directory's own `.git` entry decides which one this is.
    let dotGit;
    try { dotGit = lstatSync(join(projectDir, ".git"), { throwIfNoEntry: false }); }
    catch (error) { throw unobserved(error, "the project directory") ?? new StoreError("STORE_CORRUPT", `the project directory cannot be observed: ${error instanceof Error ? error.message : String(error)}`); }
    if (dotGit === undefined && /not a git repository/i.test(repository.stderr)) return { note: "the project directory is not a Git repository" };
    throw new StoreError("STORE_CORRUPT", `the project repository cannot be observed: ${repository.stderr.trim().slice(0, 200)}`);
  }
  const head = runGitText(["-C", projectDir, "rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  if (head.status !== 0 || head.stdout.trim().length === 0) {
    const unborn = runGitText(["-C", projectDir, "symbolic-ref", "--quiet", "HEAD"]);
    const branch = unborn.stdout.trim();
    const ref = branch.length > 0 ? runGitText(["-C", projectDir, "rev-parse", "--verify", "--quiet", branch]) : null;
    if (head.stderr.trim() === "" && unborn.status === 0 && ref !== null && ref.status !== 0 && ref.stderr.trim() === "")
      return { note: "the project directory has no committed HEAD" };
    throw new StoreError("STORE_CORRUPT", `the project's HEAD cannot be observed: ${head.stderr.trim().slice(0, 200) || "not a commit"}`);
  }
  const format = runGitText(["-C", projectDir, "rev-parse", "--show-object-format"]);
  if (format.status !== 0 || format.stdout.trim().length === 0)
    throw new StoreError("STORE_CORRUPT", "the project's object format cannot be observed");
  return { oid: head.stdout.trim(), format: format.stdout.trim() };
}

function git(argv: readonly string[], gitDir?: string, inheritedFds: readonly number[] = []): string {
  const result = runGitText(argv, { ...(gitDir === undefined ? {} : { gitDir }), inheritedFds });
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
function ensureBareRepository(path: string, format = "sha1", clone?: {
  source: string; keepHeads: boolean; verify?: boolean; immutableOwnedObjects?: true;
}): boolean {
  if (existsSync(path)) return false;
  if (format !== "sha1" && format !== "sha256")
    throw new StoreError("UNSUPPORTED_PROFILE", `the project uses an unsupported object format ${format}`);
  const parent = dirname(path);
  // P0-8: `repos` is oma's own under the state root; a stray's mode is
  // repaired within that boundary rather than wedging the repository create.
  ensureOwnedDirectory(parent, dirname(parent), 0o700);
  const stagingName = `.${basename(path)}.staging.${randomBytes(8).toString("hex")}`;
  const staging = join(parent, stagingName);
  // R6-04: the lease first, held by the git that makes the tree, so a start
  // after a crash can tell a finished staging from one still being written.
  const lease = TreeLease.take(staging);
  try {
    if (clone === undefined)
      git(["init", "--quiet", "--bare", "--initial-branch=main", `--object-format=${format}`, staging], undefined, [lease.descriptor]);
    else {
      // Human object stores can contain private index/stash/unreachable data.
      // Only the Git protocol selects reachable advertised branch history;
      // local copying is reserved for OMA's immutable owned repositories.
      git([...SNAPSHOT_GIT_OPTIONS, "clone", "--quiet", "--bare",
        ...(clone.immutableOwnedObjects === true ? ["--local"] : ["--no-local", "--no-hardlinks"]),
        "--dissociate", "--no-tags", clone.source, staging], undefined, [lease.descriptor]);
      if (clone.verify) git(["fsck", "--full", "--no-dangling", "--no-progress"], staging, [lease.descriptor]);
      // A cloned branch is never canonical main. Only the CAS below makes it.
      if (!clone.keepHeads) {
        const deletions = git(["for-each-ref", "--format=delete %(refname)"], staging);
        if (deletions) {
          const result = runGitText(["update-ref", "--stdin"], { gitDir: staging, input: `${deletions}\n`, inheritedFds: [lease.descriptor] });
          if (result.status !== 0) throw new StoreError("STORE_CORRUPT", "cloned refs could not be cleared before publication");
        }
        git(["symbolic-ref", "HEAD", "refs/heads/main"], staging);
      }
    }
    // WP16.04: everything the final name will expose is durable before it is
    // exposed, and the name itself is durable before this reports success.
    fsyncTree(staging);
    // FS-005 / architecture section 4: the rename names both entries through one resolution of their parent.
    try { withinDirectory(path, (directory, name) => { renameAt(directory, stagingName, directory, name); fsyncHeldDir(directory, parent); }); }
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
    // is no staging directory to remove, and after a lost race there is. The
    // lease goes with it once nothing holds it.
    lease.release();
    collectLeasedTree(staging);
  }
}

/** The canonical `main` the broker requires. The commit is empty and its
 * identity is fixed here rather than read from the user's Git configuration,
 * so provisioning does not depend on, or record, who is running it. */
function hasCanonicalMain(projectGit: string): boolean {
  const existing = runGitText(["rev-parse", "--verify", "--quiet", "refs/heads/main^{commit}"], { gitDir: projectGit });
  if (existing.status === 0 && existing.stdout.trim().length > 0) return true;
  // WP16.04: `--quiet` answers a missing ref with status 1 and nothing on
  // stderr. Any other failure is a repository that cannot be read, and treating
  // it as "no main" would seed a society over state that already exists.
  if (existing.status === 1 && existing.stderr.trim() === "") return false;
  throw new StoreError("STORE_CORRUPT", `the canonical repository cannot be observed: ${existing.stderr.trim().slice(0, 200)}`);
}

/** P0V-85 (R6-08, P0-7): `main` is created once, only from nothing, through
 * the canonical CAS -- the one durable effect the boundary gate sees for a
 * ref, and one whose outcome is the ref observed after the command, not the
 * command's exit status (GIT-004). A concurrent start that created it first
 * made the same canonical history; losing to it is not a failure. */
function createCanonicalMain(projectGit: string, oid: string, what: string): boolean {
  const { after, created } = createCanonicalRef(createCanonicalObserver(), projectGit, "refs/heads/main", oid);
  if (after.kind === "candidate") return created;
  if (after.kind === "third") return false;
  if (after.kind === "unknown") throw new StoreError("REF_STATE_UNKNOWN", `the canonical main could not be observed after ${what}`);
  throw new StoreError("STORE_CORRUPT", `society provisioning could not create the canonical main from ${what}`);
}

/** Seeds `main` from the project's committed history. The fetch runs under the
 * trusted Git environment: no hooks, no user or system configuration, and
 * `upload-pack` ignores command-running settings in repository configuration.
 * It brings the objects only; `main` itself is made by the CAS above. */
function seedFromProject(projectGit: string, projectDir: string, oid: string): boolean {
  const present = runGitText(["cat-file", "-e", `${oid}^{commit}`], { gitDir: projectGit });
  if (present.status === 0) return createCanonicalMain(projectGit, oid, "the copied project's HEAD");
  const fetched = runGitText([...SNAPSHOT_GIT_OPTIONS, "fetch", "--no-tags", "--quiet", projectDir, oid],
    { gitDir: projectGit, timeout: 10 * 60 * 1000 });
  if (fetched.status !== 0)
    throw new StoreError("STORE_CORRUPT",
      `society provisioning could not import the project's history: ${fetched.stderr.trim().slice(0, 200)}`);
  return createCanonicalMain(projectGit, oid, "the project's HEAD");
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
  return createCanonicalMain(projectGit, commit.stdout.trim(), "the canonical root commit");
}

/** Brings a society's state tree to the point where the broker will start, by
 * creating what is absent and nothing else. Safe to call on every run and safe
 * to lose a race with another start; it reports what it had to create, and
 * what it found wrong and deliberately did not touch. */
export function provisionSociety(stateRoot: string, options: ProvisionOptions & { verifyHistory: (repository: string) => Promise<void> }): Promise<ProvisionReport>;
export function provisionSociety(stateRoot: string, options?: ProvisionOptions): ProvisionReport;
export function provisionSociety(stateRoot: string, options: ProvisionOptions = {}): ProvisionReport | Promise<ProvisionReport> {
  // P0-4: a binding publication that died before or after its link left its
  // private temporary; only the tenure holder writes one, and it runs this.
  collectBindingTemporaries(stateRoot);
  collectRepositoryStaging(stateRoot);
  const created: string[] = [];
  for (const relative of [".", ...OWNED_DIRECTORIES]) {
    const path = relative === "." ? stateRoot : join(stateRoot, relative);
    // P0-8: durable because a half-created tree that survives a crash would
    // make the next start fail in a way that looks like corruption, and owned
    // because a mode-000 component a stray left is repaired -- never trusted
    // and never mistaken for absent by a plain existence check.
    const made = ensureOwnedDurableDirectory(path, dirname(stateRoot), 0o700);
    if (made.includes(path)) created.push(relative);
  }
  if (options.conversationOnly === true) {
    const report = Object.freeze({ created: Object.freeze(created), seeded: false, seedSource: null, seedNote: null,
      mirrorNote: null, gitlinkNote: null, pendingRepairs: Object.freeze([]) });
    return options.verifyHistory === undefined ? report : Promise.resolve(report);
  }
  const projectGit = projectGitPathAt(stateRoot);
  // The project is consulted only while the canonical repository has no main;
  // after that its history belongs to the society, not to this directory.
  const fresh = !existsSync(projectGit) || !hasCanonicalMain(projectGit);
  const project = fresh && options.projectDir !== undefined ? projectHead(options.projectDir) : null;
  const bare = project !== null && "oid" in project &&
    git(["-C", options.projectDir!, "rev-parse", "--is-bare-repository"]) === "true";
  const sourceIsGit = project !== null && ("oid" in project || project.note === "the project directory has no committed HEAD");
  const format = project !== null && "oid" in project ? project.format : sourceIsGit
    ? git(["-C", options.projectDir!, "rev-parse", "--show-object-format"]) : "sha1";
  if (ensureBareRepository(join(stateRoot, "repos", "context.git"))) created.push(join("repos", "context.git"));
  const freshHistory = fresh && !bare && project !== null && "oid" in project;
  const concurrent = freshHistory && options.verifyHistory !== undefined;
  const mirror = options.projectDir === undefined ? { note: null, fresh: false }
    : observeProjectMirrorRefresh(stateRoot, options.projectDir, !freshHistory);
  const mirrorNote = mirror.note;
  // This read-only verifier inherits the tree lease. It must finish even when
  // capture fails, so no native child loses its owner during cleanup.
  const mirrorPath = projectMirrorPathAt(stateRoot);
  const verification = concurrent && mirrorNote === null ? options.verifyHistory!(mirrorPath,
    mirror.fresh ? Object.freeze({ kind: "strict-transfer", repository: mirrorPath }) : undefined) : null;
  if (freshHistory && mirrorNote === null && verification === null && !mirror.fresh)
    git([...repositoryHealthCommand(projectMirrorPathAt(stateRoot)).argv.slice(2).filter(arg => arg !== "--progress"),
      "--no-progress", "--no-dangling"], projectMirrorPathAt(stateRoot));
  let seedSource: ProvisionReport["seedSource"] = null;
  let verifiedMain: string | undefined;
  const finish = (): ProvisionReport => {
    const seeded = seedSource !== null;
    const seedNote = project !== null && "note" in project && seeded ? project.note : null;
    const gitlinkNote = gitlinksOnMain(projectGit);
    // Darwin uses physical Seatbelt paths and has no Linux skeleton to build.
    if (process.platform !== "linux" && process.platform !== "darwin")
      throw new StoreError("UNSUPPORTED_PROFILE", "Society preparation requires Linux or macOS");
    const pendingRepairs = process.platform === "linux"
      ? prepareResidentRootfs(residentRootfsPath(stateRoot), hostSystemLayout(),
        process.getuid!(), process.getgid!(), "create").deferred : [];
    return Object.freeze({ created: Object.freeze(created), seeded, seedSource, seedNote, mirrorNote, gitlinkNote,
      pendingRepairs, ...(verifiedMain === undefined ? {} : { verifiedMain }) });
  };
  try {
    if (!existsSync(projectGit) || !hasCanonicalMain(projectGit)) {
      // Reported only by the start that actually seeded. A start that lost the
      // race created nothing and says so, so the product does not tell the user
      // it started a society that was already there.
      if (bare && project !== null && "oid" in project) {
        if (ensureBareRepository(projectGit, format)) created.push(join("repos", "project.git"));
        if (seedFromProject(projectGit, options.projectDir!, project.oid)) seedSource = "project";
      } else if (options.projectDir !== undefined) {
        if (format !== "sha1" && format !== "sha256") throw new StoreError("UNSUPPORTED_PROFILE", "unsupported project object format");
        const result = withProjectSnapshot({ source: options.projectDir, parent: project !== null && "oid" in project ? project.oid : null,
          sourceIsGit, format, temporaryParent: dirname(projectGit), executable: "/usr/bin/git",
          ...(project !== null && "oid" in project && mirrorNote === null ? { historySource: projectMirrorPathAt(stateRoot) } : {}) }, snapshot => {
          const publish = (): void => {
            if (ensureBareRepository(projectGit, format, { source: snapshot.repository, keepHeads: false, immutableOwnedObjects: true })) created.push(join("repos", "project.git"));
            if (seedFromProject(projectGit, snapshot.repository, snapshot.head)) {
              seedSource = snapshot.empty && (project === null || !("oid" in project)) ? "empty" : "project";
              if (verification !== null) verifiedMain = snapshot.head;
            }
          };
          return verification === null ? publish() : verification.then(publish);
        });
        if (result !== undefined) return result.then(finish);
      } else {
        if (ensureBareRepository(projectGit, format)) created.push(join("repos", "project.git"));
        if (seedEmptyRoot(projectGit)) seedSource = "empty";
      }
    }
  } catch (error) {
    if (verification !== null) return verification.then(() => { throw error; }, failure => {
      throw new AggregateError([error, failure], "capture and history verification failed");
    });
    throw error;
  }
  const report = finish();
  return options.verifyHistory === undefined ? report : Promise.resolve(report);
}

/** UX-09: provisioning stays permissive — a seeded or mirrored `main` may
 * carry submodule gitlinks and the society still works for sessions — but
 * every later integration refuses them, so the start that can see them says
 * so, naming the paths, instead of letting the first merge discover them.
 * The check is advisory: anything but a clean "present" declines the note
 * and leaves the integration gate as the authoritative refusal. */
function gitlinksOnMain(projectGit: string): string | null {
  const observations = createCanonicalObserver();
  const main = observations.ref(projectGit, "refs/heads/main");
  if (main.kind !== "present") return null;
  const links = observations.gitlinks(projectGit, main.value);
  if (links.kind !== "present" || links.value.length === 0) return null;
  return `the canonical history carries submodule gitlinks (${links.value.join(", ")}): ` +
    "Residents can work and submit, but every integration is refused while a candidate's tree contains one — remove the gitlinks for merges to pass";
}

/** DR18 (D-8): the project's committed branch history, brought into the
 * society's mirror on every start. A Resident may fetch it (read-only in its
 * sandbox) and submit what it builds on it by the existing path (GIT-006,
 * GIT-008); canonical `main` is untouched here (MAC-411). Branch heads only:
 * no index, stash, worktree or configuration of the project. The fetch runs
 * under the trusted Git environment with object checks, local transport only.
 * The canonical repository does not depend on the mirror, so a project that
 * cannot be read now is a note, not a failed start; its answer is null when
 * the mirror is current. */
export function refreshProjectMirror(stateRoot: string, projectDir: string, verify = true): string | null {
  return observeProjectMirrorRefresh(stateRoot, projectDir, verify).note;
}

function observeProjectMirrorRefresh(stateRoot: string, projectDir: string, verify: boolean): { note: string | null; fresh: boolean } {
  const project = projectHead(projectDir);
  const mirror = projectMirrorPathAt(stateRoot);
  // A project that never had history has nothing to mirror, which is not news
  // at every start; one whose history the mirror holds and cannot now be read is.
  if ("note" in project) return { note: existsSync(mirror) ? project.note : null, fresh: false };
  // This path always uses --no-local plus fetch/transfer.fsckObjects=true.
  // Git validates every received object and link before the clone exits.
  if (ensureBareRepository(mirror, project.format, { source: projectDir, keepHeads: true, verify })) return { note: null, fresh: true };
  const format = runGitText(["rev-parse", "--show-object-format"], { gitDir: mirror });
  if (format.status !== 0 || format.stdout.trim() !== project.format)
    return { note: "the project's object format differs from its mirror's; the mirror was not refreshed", fresh: false };
  const fetched = runGitText(["-c", "fetch.fsckObjects=true", "-c", "transfer.fsckObjects=true", "-c", "protocol.allow=never",
    "-c", "protocol.file.allow=always", "fetch", "--no-tags", "--prune", "--quiet", projectDir, "+refs/heads/*:refs/heads/*"],
  { gitDir: mirror, timeout: 10 * 60 * 1000 });
  if (fetched.status !== 0) return { note: `the project's history could not be brought into its mirror: ${fetched.stderr.trim().slice(0, 200)}`, fresh: false };
  return { note: null, fresh: false };
}

/** Puts back the generated rootfs entries `provisionSociety` found wrong and
 * left alone, and answers which ones it corrected.
 *
 * This writes over state that exists, so the product calls it only once it
 * holds the society lease. Keeping it out of `provisionSociety` is what lets
 * both rules be true at once: a rootfs that lies about who the agent is gets
 * corrected, and a process that does not own the society corrects nothing. */
export function repairSociety(stateRoot: string): readonly string[] {
  if (process.platform !== "linux") throw new StoreError("UNSUPPORTED_PROFILE", "Linux rootfs repair is not a portable operation");
  return prepareResidentRootfs(residentRootfsPath(stateRoot), hostSystemLayout(),
    process.getuid?.() ?? 0, process.getgid?.() ?? 0, "repair").corrected;
}

export { PROJECT_BINDING, observeProjectBinding, type ProjectBinding, type ProjectBindingObservation } from "./project-binding.js";
import { PROJECT_BINDING, BINDING_KIND, BINDING_MAX_BYTES, observeProjectBinding, type ProjectBinding, type ProjectBindingObservation } from "./project-binding.js";

/** Whether a state root already holds a society (anything but a binding or
 * its temporaries): such a tree is never bound implicitly. */
export function stateRootHasSociety(stateRoot: string): boolean {
  let entries: string[];
  try { entries = readdirSync(stateRoot); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw unobserved(error, "the state root") ?? new StoreError("STORE_CORRUPT", `the state root cannot be observed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return entries.some(entry => entry !== "session-mode.json" && entry !== PROJECT_BINDING && !entry.startsWith(`.${PROJECT_BINDING}.`));
}

export type ProjectBindingDecision =
  | { readonly kind: "proceed" }
  | { readonly kind: "publish" }
  | { readonly kind: "refuse"; readonly reason: string; readonly code: "BROKER_UNAVAILABLE" | "STORE_CORRUPT" | "INVALID_REQUEST" };
/** D05: pure. A society is acted on only for the project it is bound to. A
 * missing binding is written for a new society, or for an existing one only
 * when the operator explicitly asked (`--bind-project`); a mismatch is refused
 * even for an explicit --society, and an unreadable binding is refused. The
 * refusal's code says which: a binding that cannot be read now is not known
 * (BROKER_UNAVAILABLE), one that was read and cannot be vouched for is
 * corrupt host metadata (STORE_CORRUPT), a binding to another society or
 * project is a fact the operator decides on (INVALID_REQUEST). */
export function projectBindingDecision(input: { readonly observation: ProjectBindingObservation; readonly society: string;
  readonly canonicalProjectPath: string; readonly hasSociety: boolean; readonly bindRequested: boolean }): ProjectBindingDecision {
  const observed = input.observation;
  if (observed.kind === "unavailable") return { kind: "refuse", code: "BROKER_UNAVAILABLE", reason: `the society's project binding cannot be read now: ${observed.reason}` };
  if (observed.kind === "unreadable") return { kind: "refuse", code: "STORE_CORRUPT", reason: `the society's project binding cannot be read: ${observed.reason}` };
  if (observed.kind === "bound") {
    if (observed.binding.society !== input.society)
      return { kind: "refuse", code: "INVALID_REQUEST", reason: `the state root is bound to society ${observed.binding.society}, not ${input.society}` };
    if (observed.binding.canonicalProjectPath !== input.canonicalProjectPath)
      return { kind: "refuse", code: "INVALID_REQUEST", reason: `society ${input.society} belongs to the project at ${observed.binding.canonicalProjectPath}` };
    return { kind: "proceed" };
  }
  if (!input.hasSociety || input.bindRequested) return { kind: "publish" };
  return { kind: "refuse", code: "INVALID_REQUEST", reason: `society ${input.society} predates project bindings; review which project it belongs to, then run once with --bind-project` };
}

const BINDING_TEMPORARY = /^\.project-binding\.json\.[0-9a-f]{16}\.tmp$/;
/** The temporaries `publishProjectBinding` names, left by a publication that
 * did not finish. They are never a binding (`stateRootHasSociety` and the
 * observer ignore them); the process holding the society's tenure removes them. */
/** R6-04, P0-4: a repository staging a crashed start left, with its lease.
 * Removed when its lease proves nothing still writes it; kept otherwise --
 * including one made before leases, of which nothing is proven. */
const REPOSITORY_STAGING = /^\.[^/]+\.staging\.[0-9a-f]{16}$/;
export function collectRepositoryStaging(stateRoot: string): { readonly removed: readonly string[]; readonly kept: readonly string[] } {
  const repos = join(stateRoot, "repos");
  let entries: string[];
  try { entries = readdirSync(repos); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { removed: [], kept: [] }; throw error; }
  const trees = new Set(entries.map(entry => entry.endsWith(".lease") ? entry.slice(0, -".lease".length) : entry).filter(entry => REPOSITORY_STAGING.test(entry)));
  const removed: string[] = []; const kept: string[] = [];
  for (const tree of [...trees].sort()) (collectLeasedTree(join(repos, tree)).kind === "quiescent" ? removed : kept).push(tree);
  return { removed, kept };
}

export function collectBindingTemporaries(stateRoot: string): readonly string[] {
  let entries: string[];
  try { entries = readdirSync(stateRoot); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const removed = entries.filter(entry => BINDING_TEMPORARY.test(entry));
  for (const entry of removed) removeOwnedFile(join(stateRoot, entry));
  return removed;
}
export function publishProjectBinding(stateRoot: string, binding: Omit<ProjectBinding, "kind">): void {
  ensureOwnedDurableDirectory(stateRoot, dirname(stateRoot), 0o700);
  const record: ProjectBinding = { kind: BINDING_KIND, society: binding.society, canonicalProjectPath: binding.canonicalProjectPath };
  const bytes = `${JSON.stringify(record, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > BINDING_MAX_BYTES) throw new StoreError("INVALID_REQUEST", "the project path is too long to bind");
  const final = join(stateRoot, PROJECT_BINDING);
  const temporaryName = `.${PROJECT_BINDING}.${randomBytes(8).toString("hex")}.tmp`;
  const temporary = join(stateRoot, temporaryName);
  writeExclusiveFsyncedFile(temporary, bytes, 0o600);
  // FS-005 / architecture section 4: the link, the cleanup and the flush address one resolution of the root.
  withinDirectory(final, (directory, name) => {
  try {
    try { linkAt(directory, temporaryName, directory, name); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Another start bound it first: the same binding is adoption, any other is a refusal.
      const observed = observeProjectBinding(stateRoot);
      if (observed.kind === "unavailable")
        throw new StoreError("BROKER_UNAVAILABLE", `the binding another start published cannot be read now: ${observed.reason}`);
      if (observed.kind !== "bound" || observed.binding.society !== record.society ||
          observed.binding.canonicalProjectPath !== record.canonicalProjectPath)
        throw new StoreError("POLICY_CHANGED", "another binding was published for this state root");
    }
  } finally { unlinkAt(directory, temporaryName); }
  fsyncHeldDir(directory, stateRoot);
  });
}
