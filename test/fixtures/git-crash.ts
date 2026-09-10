import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { GitModule, gitEnv, type GitPaths } from "../../src/git.js";
import { MailModule } from "../../src/mail.js";
import { Store } from "../../src/store.js";
import { sha256Hex } from "../../src/hash.js";
import { ALL_CAPS } from "./spec.js";
import type { AuthContext } from "../../implementation/contracts.js";

export const gitAuth: AuthContext = { actor: "a", incarnation: 1, role: "resident", channel: "actor", capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
export function gitCommand(root: string, args: string[]): string {
  const out = spawnSync("/usr/bin/git", args, { cwd: root, env: gitEnv, encoding: "utf8", timeout: 30000 });
  if (out.status !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr}`);
  return out.stdout.trim();
}
export function gitFixture(root: string, store: Store) {
  const paths: GitPaths = {
    stateRoot: root, projectGit: join(root, "repos/project.git"), contextGit: join(root, "repos/context.git"), worldDir: join(root, "world"), society: "crash",
    quarantineTmpBytes: 256 * 1024 * 1024, quarantineResources: { cpuSeconds: 30, memoryBytes: 512 * 1024 * 1024, tasks: 4096 }, checkTimeoutSeconds: 30,
  };
  const mail = new MailModule({ stateRoot: root, society: "crash" }, store, 64);
  const git = new GitModule(paths, store, mail, { policyRevision: "crash-policy", protectedPaths: [], checks: [] });
  return { git, mail, paths };
}
export function seedGit(root: string, format: "sha1" | "sha256" = "sha1"): void {
  const seed = join(root, "seed");
  mkdirSync(seed, { recursive: true });
  mkdirSync(join(root, "repos"), { recursive: true });
  gitCommand(seed, ["init", "-q", "-b", "main", `--object-format=${format}`]);
  writeFileSync(join(seed, "base.txt"), "base\n".repeat(4096));
  gitCommand(seed, ["add", "."]);
  const commit = () => gitCommand(seed, ["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-qm", "fixture"]);
  commit();
  const base = gitCommand(seed, ["rev-parse", "HEAD"]);
  gitCommand(root, ["clone", "--bare", seed, join(root, "repos/project.git")]);
  gitCommand(root, ["init", "--bare", "-b", "main", `--object-format=${format}`, join(root, "repos/context.git")]);
  writeFileSync(join(seed, "change.txt"), "candidate\n");
  gitCommand(seed, ["add", "."]);
  commit();
  const candidate = gitCommand(seed, ["rev-parse", "HEAD"]);
  const exportRef = "refs/oma/export/crash";
  gitCommand(seed, ["update-ref", exportRef, candidate]);
  gitCommand(seed, ["bundle", "create", join(root, "candidate.bundle"), exportRef, `^${base}`]);
  writeFileSync(join(root, "git-fixture.json"), JSON.stringify({ base, candidate, exportRef }));
}
export async function submitFixture(root: string, git: GitModule, key = "git-crash") {
  const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
  const bytes = readFileSync(join(root, "candidate.bundle"));
  return git.submit(gitAuth, key, { candidate: info.candidate, exportRef: info.exportRef, prerequisites: [info.base], to: ["b"], subject: "candidate", body: "fixed candidate", paths: ["change.txt"], bundle: { bytes: bytes.length, sha256: sha256Hex(bytes), mediaType: "application/x-git-bundle" } }, (async function* () { yield bytes; })());
}
export async function contextFixture(git: GitModule) {
  const bytes = Buffer.from("# GOAL\nverify crash recovery\n");
  return git.publishContext(gitAuth, "git-crash", { expected: null, entries: [{ path: "GOAL.md", bytes: bytes.length, sha256: sha256Hex(bytes) }], content: { bytes: bytes.length, sha256: sha256Hex(bytes), mediaType: "application/vnd.oma.context-v1" } }, (async function* () { yield bytes; })());
}
