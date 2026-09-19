/** CFG-002/TUI-002: bringing a society's state tree into existence.
 *
 * The broker refuses to start against a state tree that is not already there:
 * it opens a ledger, reads a canonical repository and asks it for a pinned
 * `main`. Until now nothing created any of that, so `oma` in a fresh project
 * had no broker, and with no broker there were no residents and no observed
 * status. This module is the missing step, and it runs on every start because
 * it is idempotent: it creates what is absent and touches nothing that exists.
 *
 * It seeds an empty root commit. Copying the user's working tree into OMA's
 * canonical repository would be a separate and much larger decision about
 * whose code the society operates on, and doing it silently on first run is
 * exactly the kind of surprise a bring-up step must not cause.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { StoreError } from "../domain/errors.js";
import { runGitText } from "../process/policies.js";
import { ensureDurableDirectory } from "../storage/durable-fs.js";

/** Directories the broker, mail and Git modules expect to already exist. */
const OWNED_DIRECTORIES: readonly string[] = Object.freeze([
  "repos", "world", "agents",
  join("mail", "objects"),
  join("mail", "inboxes"),
  join("mail", "archive", "new"),
  join("mail", "archive", "cur"),
  join("mail", "archive", "tmp"),
]);

export interface ProvisionReport {
  /** Directories this call created. Empty on an already-provisioned society. */
  readonly created: readonly string[];
  /** True when this call seeded the canonical repository's first commit. */
  readonly seeded: boolean;
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
function ensureBareRepository(path: string): boolean {
  if (existsSync(path)) return false;
  git(["init", "--quiet", "--bare", "--initial-branch=main", "--object-format=sha1", path]);
  return true;
}

/** The canonical `main` the broker requires. The commit is empty and its
 * identity is fixed here rather than read from the user's Git configuration,
 * so provisioning does not depend on, or record, who is running it. */
function ensureCanonicalMain(projectGit: string): boolean {
  const existing = runGitText(["rev-parse", "--verify", "--quiet", "refs/heads/main^{commit}"], { gitDir: projectGit });
  if (existing.status === 0 && existing.stdout.trim().length > 0) return false;
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
  return true;
}

/** Brings a society's state tree to the point where the broker will start.
 * Safe to call on every run; it reports what it had to create. */
export function provisionSociety(stateRoot: string): ProvisionReport {
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
  if (ensureBareRepository(projectGit)) created.push(join("repos", "project.git"));
  if (ensureBareRepository(join(stateRoot, "repos", "context.git"))) created.push(join("repos", "context.git"));
  const seeded = ensureCanonicalMain(projectGit);
  return Object.freeze({ created: Object.freeze(created), seeded });
}
