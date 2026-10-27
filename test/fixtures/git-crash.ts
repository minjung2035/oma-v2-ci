import { residentRootfsPath } from "@oma/platform-linux/resident-rootfs";
import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { GitModule, type GitPaths } from "@oma/git";
import { GIT_ENV as gitEnv } from "@oma/process/policies";
import { MailModule } from "@oma/mail";
import { Store } from "@oma/storage";
import { sha256Hex } from "@oma/domain/canonical-json";
import { isValidFullOid } from "@oma/domain/identifiers";
import { checkExportRef } from "@oma/domain/validation";
import { ALL_CAPS } from "./spec.js";
import type { AuthContext } from "@oma/contracts";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { ExecutionRuntime } from "#oma-test/app/runtime/execution-runtime";
import { quarantineExecution } from "#oma-test/app/runtime/quarantine-execution";
import { prepareResidentRootfs, hostSystemLayout } from "@oma/platform-linux/resident-rootfs";
import { withAsyncCleanup } from "@oma/native/cleanup";
import type { QuarantineExecution } from "@oma/git/quarantine";
export const gitAuth: AuthContext = { actor: "a", incarnation: 1, role: "resident", channel: "actor", capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
export function gitCommand(root: string, args: string[]): string {
    const out = spawnSync("/usr/bin/git", args, { cwd: root, env: gitEnv, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024, killSignal: "SIGKILL" });
    if (out.error || out.signal || out.status !== 0)
        throw new Error(`git ${args.join(" ")}: ${out.stderr ?? out.error?.message ?? "unknown outcome"}`);
    return out.stdout.trim();
}
/** Disposable feature fixture backend. All phase effects use production
 * scope/journal primitives; no host import or fabricated death observation. */
export function nativeQuarantine(pathsInput: GitPaths, options: { afterImport?: () => void } = {}): QuarantineExecution {
    const root = pathsInput.stateRoot;
    const paths = { ...pathsInput,
      checkNode: pathsInput.checkNode ?? process.execPath, checkAssetsDir: pathsInput.checkAssetsDir ?? process.cwd() };
    // Disposable fixture state is explicitly initialized. Every effect uses
    // the production scope/journal and Linux sandbox; there is no host Git
    // import fallback. Each phase drains its owner before returning to Git.
    if (!existsSync(join(root, "execution/scopes.jsonl"))) ExecutionJournal.initialize(root);
    prepareResidentRootfs(residentRootfsPath(paths.stateRoot), hostSystemLayout(), process.getuid!(), process.getgid!());
    let active: ExecutionRuntime | null = null;
    const quarantine: QuarantineExecution = {
      confirmDead: () => active === null && ExecutionJournal.inspect(root).length === 0,
      async execute(request, authorize) {
        if (active !== null) throw new Error("test execution owner is already active or unconfirmed");
        const owner = new ExecutionRuntime(root); active = owner;
        const result = await withAsyncCleanup(() => quarantineExecution(paths, owner).execute(request, authorize),
          async () => { await owner.close(); active = null; });
        if (request.phase === "import" && result.kind === "exited" && result.exitCode === 0) options.afterImport?.();
        return result;
      },
    };
    return quarantine;
}
export function gitFixture(root: string, store: Store, options: { afterImport?: () => void } = {}) {
    const paths: GitPaths = {
        stateRoot: root, projectGit: join(root, "repos/project.git"), contextGit: join(root, "repos/context.git"), worldDir: join(root, "world"), society: "crash",
         checkNode: process.execPath, checkAssetsDir: process.cwd(),
    };
    const quarantine = nativeQuarantine(paths, options);
    const mail = createMailModule({ stateRoot: root, society: "crash" }, store, 64);
    const git = createGitModule(paths, store, mail, { policyRevision: "crash-policy", protectedPaths: [], checks: [] }, null, null, quarantine);
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
function isFixtureInfo(value: unknown): value is {
    base: string;
    candidate: string;
    exportRef: string;
} {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 3 &&
        "base" in value && isValidFullOid(value.base) && "candidate" in value && isValidFullOid(value.candidate) &&
        "exportRef" in value && typeof value.exportRef === "string" && checkExportRef(value.exportRef) === null;
}
export async function submitFixture(root: string, git: GitModule, key = "git-crash") {
    const info: unknown = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
    if (!isFixtureInfo(info))
        throw new Error("normal Git fixture metadata is invalid");
    const bytes = readFileSync(join(root, "candidate.bundle"));
    return git.submit(gitAuth, key, { candidate: info.candidate, exportRef: info.exportRef, prerequisites: [info.base], to: ["b"], subject: "candidate", body: "fixed candidate", paths: ["change.txt"], bundle: { bytes: bytes.length, sha256: sha256Hex(bytes), mediaType: "application/x-git-bundle" } }, (async function* () { yield bytes; })());
}
export async function contextFixture(git: GitModule) {
    const bytes = Buffer.from("# GOAL\nverify crash recovery\n");
    return git.publishContext(gitAuth, "git-crash", { expected: null, entries: [{ path: "GOAL.md", bytes: bytes.length, sha256: sha256Hex(bytes) }], content: { bytes: bytes.length, sha256: sha256Hex(bytes), mediaType: "application/vnd.oma.context-v1" } }, (async function* () { yield bytes; })());
}
