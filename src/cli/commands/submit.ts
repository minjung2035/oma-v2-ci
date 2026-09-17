import { constants, closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PublicMethods } from "../../../implementation/contracts.js";
import { StoreError } from "../../domain/errors.js";
import { exportRefForRequestKey } from "../../domain/derived.js";
import { runGitText } from "../../process/policies.js";
import { keyOf, multiOpt, opt } from "../arguments.js";
import { readBody, resolveOid, sha256Hex } from "../effects.js";
import { finishFailure, fail, usage } from "../exit.js";
import { effect, randKey } from "../request-service.js";
import { explicitFullOid } from "../request-intent.js";
import { call } from "../transport.js";

function git(cwd: string, args: string[]): string {
  const result = runGitText(args, { cwd });
  if (result.status !== 0) fail(`git ${args[0] ?? "?"}: ${result.stderr.slice(0, 200)}`, 2);
  return result.stdout.trim();
}

/** GIT-004: only an observed local ancestor advertised by the broker is usable. */
function submitPrerequisites(cwd: string, candidate: string, known: readonly string[]): string[] {
  for (const oid of new Set(known)) {
    if (oid === candidate || oid.length !== candidate.length) continue;
    const local = runGitText(["rev-parse", "--verify", "--quiet", `${oid}^{commit}`], { cwd });
    if (local.status === 1) continue;
    if (local.status !== 0 || local.stdout.trim() !== oid)
      throw new StoreError("INVALID_OID", "cannot observe advertised prerequisite locally");
    const ancestry = runGitText(["merge-base", "--is-ancestor", oid, candidate], { cwd });
    if (ancestry.status === 0) return [oid];
    if (ancestry.status !== 1)
      throw new StoreError("REF_STATE_UNKNOWN", "cannot observe candidate ancestry");
  }
  return [];
}

/** The random 0700 directory owns the Git output; no key-derived shared path.
 * Throw rather than process.exit inside this scope so every settled error cleans up. */
function submitBundle(cwd: string, exportRef: string, prerequisites: readonly string[]): Buffer {
  const directory = mkdtempSync(join(tmpdir(), "oma-submit-"));
  try {
    const path = join(directory, "candidate.bundle");
    const result = runGitText(
      ["bundle", "create", path, exportRef, ...prerequisites.map((oid) => `^${oid}`)],
      { cwd },
    );
    if (result.status !== 0)
      throw new StoreError("INVALID_REQUEST", `git bundle: ${result.stderr.slice(0, 200)}`);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1)
        throw new StoreError("INVALID_REQUEST", "bundle output is not an owned regular file");
      return readFileSync(fd);
    } finally {
      closeSync(fd);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function runSubmitCommand(args: string[]): Promise<never> {
  const revision = args[0];
  if (!revision) usage();
  const key = keyOf(args) ?? randKey();
  return effect(
    "git.submit",
    key,
    async () => {
      const cwd = process.cwd();
      const candidate = resolveOid(revision);
      const to = multiOpt(args, "--to");
      const subject = opt(args, "--subject") ?? "Re: submit";
      const body = readBody(opt(args, "--file"));
      const paths = multiOpt(args, "--path");
      const exportRef = exportRefForRequestKey(key);
      const reply = (await call("git.known", { candidate }))[0];
      if (!reply?.ok) finishFailure(reply, "git.known: ");
      // The production channel already decoded this method's closed result.
      const known = reply.result as PublicMethods["git.known"]["result"];
      const prerequisites = known.hasCandidate
        ? []
        : submitPrerequisites(cwd, candidate, known.prerequisites);
      git(cwd, ["update-ref", exportRef, candidate]);
      const params: Record<string, unknown> = {
        candidate,
        exportRef,
        prerequisites,
        to: to.length > 0 ? to : ["commons"],
        subject,
        body,
        paths,
      };
      if (known.hasCandidate) return { method: "git.submit", params };
      const content = submitBundle(cwd, exportRef, prerequisites);
      const digest = { bytes: content.length, sha256: sha256Hex(content) };
      params.bundle = { ...digest, mediaType: "application/x-git-bundle" };
      return { method: "git.submit", params, digest, stream: content };
    },
    () => {
      const to = multiOpt(args, "--to");
      return {
        to: to.length > 0 ? to : ["commons"],
        subject: opt(args, "--subject") ?? "Re: submit",
        paths: multiOpt(args, "--path"),
        ...explicitFullOid("candidate", revision),
      };
    },
  );
}
