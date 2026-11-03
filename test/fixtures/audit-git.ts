import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const gitEnvironment = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };

type AuditPaths = { dir: string; state: string };
/** Each caller retains its own repository, environment and actual Git process. */
export const auditGit = (env: AuditPaths) => (args: string[], cwd = env.dir): string => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8",
    env: gitEnvironment });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return (result.stdout ?? "").trim();
};

export function seedAuditProject(env: AuditPaths): string {
    const seed = join(env.dir, "seed");
    mkdirSync(seed, { recursive: true });
    const sh = auditGit(env);
    sh(["init", "-q", "-b", "main"], seed);
    writeFileSync(join(seed, "base.txt"), "b".repeat(65536) + "\n", "utf8");
    sh(["add", "-A"], seed);
    sh([
        "-c",
        "user.name=O",
        "-c",
        "user.email=o@localhost",
        "commit",
        "-qm",
        "base",
    ], seed);
    const base = sh(["rev-parse", "HEAD"], seed);
    sh(["clone", "-q", "--bare", seed, join(env.state, "repos", "project.git")]);
    sh([
        "--git-dir",
        join(env.state, "repos", "project.git"),
        "symbolic-ref",
        "HEAD",
        "refs/heads/main",
    ]);
    return base;
}
