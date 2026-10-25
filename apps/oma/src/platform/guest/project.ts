/** The guest's side of project sync (macos-platform §6.3, §6.4).
 *
 * Import brings the Mac's commits into the project mirror and nowhere else:
 * the mirror is made with the bundle's object format, the bundle is verified
 * and fetched with object checks into `refs/remotes/mac/<branch>` only, and
 * the mirror's HEAD is left on that commit. Canonical `main` changes only
 * through the paths the norms already have (MAC-411). Export bundles the
 * society's canonical `main` for the host. Every git here runs with the
 * product's trusted configuration (GIT-001).
 */
import { createHash } from "node:crypto";
import { closeSync, createReadStream, existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { isValidSocietyName } from "@oma/domain/identifiers";
import { runGitText } from "@oma/process/policies";
import { projectGitPathAt } from "@oma/domain/paths";
import { isUuid } from "@oma/protocol/host-guest";
import type { RequestLedger } from "./requests.js";
import { ProjectMutations } from "./project-mutations.js";

/** The product's trusted git, with object checks on everything fetched. */
function git(argv: readonly string[], cwd?: string): { status: number; stdout: string; stderr: string } {
  return runGitText(["-c", "fetch.fsckObjects=true", "-c", "transfer.fsckObjects=true", "-c", "protocol.allow=never",
    "-c", "protocol.file.allow=always", ...argv], cwd === undefined ? {} : { cwd });
}
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!\/)[A-Za-z0-9._/-]{1,200}(?<!\/)(?<!\.lock)$/;

/** Guest-owned mirrors have no working tree to snapshot. Older releases made
 * a non-bare repository without checking it out; preserve its objects/refs but
 * identify it as a commit source before the Society's first provisioning. */
export function prepareMirrorForSeed(mirror: string): void {
  const bare = git(["-C", mirror, "rev-parse", "--is-bare-repository"]);
  if (bare.status !== 0 || (bare.stdout.trim() !== "true" &&
      git(["-C", mirror, "config", "core.bare", "true"]).status !== 0))
    throw new StoreError("BROKER_UNAVAILABLE", "the imported project mirror could not be prepared");
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** The object format a bundle's header declares (v3 `@object-format=`), or
 * sha1 for a v2 bundle, which has no such line. */
/** The bundle's header up to the end of its capabilities, at most this many
 * bytes (P0V-106, G13-02): a v3 bundle states its capabilities -- the
 * object format among them -- right after its signature line, and a header
 * whose capabilities do not end within this is refused, not read as sha1. */
const BUNDLE_CAPABILITIES_BYTES = 64 * 1024;

export function bundleObjectFormat(path: string): "sha1" | "sha256" {
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(BUNDLE_CAPABILITIES_BYTES);
    let count = 0;
    for (let read = -1; read !== 0 && count < head.length;) { read = readSync(fd, head, count, head.length - count, count); count += read; }
    const lines = head.subarray(0, count).toString("latin1").split("\n");
    if (lines[0] !== "# v2 git bundle" && lines[0] !== "# v3 git bundle") throw new StoreError("BUNDLE_INVALID", "not a git bundle");
    // Capabilities are the `@` lines after the signature; the first other
    // line ends them. One that is still going at the end of what was read
    // (the last element is an unfinished line) is a header too long to trust.
    let end = 1;
    while (end < lines.length - 1 && lines[end]!.startsWith("@")) end += 1;
    if (end === lines.length - 1 && count === head.length) throw new StoreError("BUNDLE_INVALID", "the bundle's header is longer than a bundle's header is");
    const declared = lines.slice(1, end).find(line => line.startsWith("@object-format="));
    const format = declared === undefined ? "sha1" : declared.slice("@object-format=".length);
    if (format !== "sha1" && format !== "sha256") throw new StoreError("BUNDLE_INVALID", "the bundle's object format is unknown");
    return format;
  } finally { closeSync(fd); }
}

export type ImportParams = Record<string, unknown> & { projectId?: unknown; branch?: unknown; bundle?: unknown };

export class GuestProjects {
  readonly mutations = new ProjectMutations();
  constructor(private readonly projectsDir: string, private readonly societiesDir: string, private readonly ledger: RequestLedger) {}

  mirrorOf(projectId: string): string { return join(this.projectsDir, projectId); }

  /** §6.3. The bundle was staged under this key by a stream (§4.8). */
  import(key: unknown, params: ImportParams): Promise<Record<string, unknown>> {
    return this.ledger.run(key, "project.import", params, async () => {
      const { projectId, branch, bundle } = params;
      if (!isUuid(projectId)) throw new StoreError("INVALID_REQUEST", "projectId must be a UUID");
      if (typeof branch !== "string" || !BRANCH.test(branch)) throw new StoreError("INVALID_REQUEST", "invalid branch name");
      const declared = bundle as { bytes?: unknown; sha256?: unknown } | null;
      if (declared === null || typeof declared !== "object" || typeof declared.sha256 !== "string" || typeof declared.bytes !== "number")
        throw new StoreError("INVALID_REQUEST", "bundle must be { bytes, sha256 }");
      const staged = this.ledger.staging(key as string, "bundle");
      if (!existsSync(staged) || statSync(staged).size !== declared.bytes || await sha256File(staged) !== declared.sha256)
        throw new StoreError("STREAM_INVALID", "the bundle did not arrive as declared");
      const format = bundleObjectFormat(staged);
      const mirror = this.mirrorOf(projectId);
      if (!existsSync(mirror)) {
        const made = git(["init", "--bare", "-q", `--object-format=${format}`, mirror]);
        if (made.status !== 0) throw new StoreError("INTERNAL_ERROR", "the project mirror could not be made");
      } else if (git(["-C", mirror, "rev-parse", "--show-object-format"]).stdout.trim() !== format)
        throw new StoreError("BUNDLE_INVALID", "the bundle's object format is not the project's");
      const verified = git(["-C", mirror, "bundle", "verify", "-q", staged]);
      if (verified.status !== 0)
        throw new StoreError(/prerequisite|lacks these/i.test(verified.stderr) ? "PREREQUISITE_MISSING" : "BUNDLE_INVALID", "the bundle does not verify against the project");
      const ref = `refs/remotes/mac/${branch}`;
      const fetched = git(["-C", mirror, "fetch", "--no-tags", "--no-write-fetch-head", staged, `+refs/heads/${branch}:${ref}`]);
      if (fetched.status !== 0) throw new StoreError("BUNDLE_INVALID", "the bundle does not carry that branch");
      const head = git(["-C", mirror, "rev-parse", "--verify", `${ref}^{commit}`]).stdout.trim();
      if (git(["-C", mirror, "update-ref", "--no-deref", "HEAD", head]).status !== 0)
        throw new StoreError("INTERNAL_ERROR", "the project mirror could not be moved");
      // What a bundle cannot carry is said, not dropped silently (§6.3). UX-09:
      // the gitlink paths are named — the same paths the canonical repository's
      // integration gate will refuse while they are carried.
      const notCarried: string[] = [];
      const tree = git(["-C", mirror, "ls-tree", "-r", head]);
      const gitlinks = tree.status === 0
        ? tree.stdout.split("\n").filter(line => line.startsWith("160000 ")).map(line => line.slice(line.indexOf("\t") + 1))
        : [];
      if (gitlinks.length > 0) notCarried.push(`submodule contents (${gitlinks.join(", ")})`);
      // The initial snapshot materializes the working tree, so a registered
      // submodule that is not checked out is dropped before the mirror sees
      // it; only the .gitmodules declaration reaches here to say so.
      else if (git(["-C", mirror, "cat-file", "-e", `${head}:.gitmodules`]).status === 0) notCarried.push("submodule contents");
      const attributes = git(["-C", mirror, "cat-file", "-p", `${head}:.gitattributes`]);
      if (attributes.status === 0 && /filter=lfs/.test(attributes.stdout)) notCarried.push("large files (LFS)");
      return { head, ref, objectFormat: format, notCarried };
    }, run => isUuid(params.projectId) ? this.mutations.run(params.projectId, run) : run());
  }

  /** §6.4: the society's canonical main, as a bundle staged for the host. */
  export(key: unknown, params: { society: unknown; since?: unknown }): Promise<Record<string, unknown>> {
    // The intent digest covers what the request was: an absent `since` and an
    // explicit `since: undefined` are the same request, and neither is a JSON
    // value the canonical encoder can name.
    const intent: Record<string, unknown> = params.since === undefined
      ? { society: params.society } : { society: params.society, since: params.since };
    return this.ledger.run(key, "project.export", intent, async () => {
      if (!isValidSocietyName(params.society)) throw new StoreError("INVALID_REQUEST", "invalid society name");
      const canonical = projectGitPathAt(join(this.societiesDir, params.society));
      const head = git(["--git-dir", canonical, "rev-parse", "--verify", "refs/heads/main^{commit}"]);
      if (head.status !== 0) throw new StoreError("INVALID_REQUEST", "the society has no main to export");
      const since = typeof params.since === "string" && git(["--git-dir", canonical, "cat-file", "-e", `${params.since}^{commit}`]).status === 0 &&
        git(["--git-dir", canonical, "merge-base", "--is-ancestor", head.stdout.trim(), params.since]).status !== 0
        ? [`^${params.since}`] : [];
      const staged = this.ledger.staging(key as string, "export.bundle");
      const made = git(["--git-dir", canonical, "bundle", "create", "-q", staged, "refs/heads/main", ...since]);
      if (made.status !== 0) throw new StoreError("INTERNAL_ERROR", "the export bundle could not be made");
      return { head: head.stdout.trim(), bytes: statSync(staged).size, sha256: await sha256File(staged) };
    });
  }
}
