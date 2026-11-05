/** Physical check/quarantine recipes only. Shared Git entries own exact
 * checkout, verification and phase order. These descriptions prove neither
 * kernel scope death nor the stability of subsequent pathname execution. */
import { dirname, join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { isValidFullOid } from "@oma/domain/identifiers";
import { integrationCheckEnvironment, type FrozenCheck } from "@oma/domain/integration-policy";
import { nodeToolchainMounts } from "@oma/domain/resident-paths";
import { GIT_ENV } from "@oma/process/policies";
import { decodeCandidateExecutionView, decodePipelineExecutionView, decodeQuarantineExecutionView, type CandidateExecutionView, type QuarantineExecutionView } from "@oma/protocol/git-execution-view";
import { trustedAbsolutePath } from "@oma/protocol/run-lease";
import { decodeMacDeveloperTools, type MacDeveloperTools } from "@oma/protocol/mac-developer-tools";
import { developerToolDirectories, developerToolSystemFrameworks, DEVELOPER_TOOL_SUPPORT_FILES } from "./developer-tools.js";
import { prepareSeatbelt, type SeatbeltPath, type SeatbeltPolicy } from "./seatbelt.js";
import type { CommandSpec } from "@oma/process/command";

export interface MacGitSandboxHost { readonly node: string; readonly libdir: string; readonly tools: MacDeveloperTools;
  readonly downloadCache?: { readonly root: string; readonly key: string; readonly files: readonly string[] } }
const dir = (path: string): SeatbeltPath => ({ path, kind: "directory" });
const file = (path: string): SeatbeltPath => ({ path, kind: "file" });
const under = (value: string, root: string): boolean => value === root || value.startsWith(`${root}/`);
function refuse(): never { throw new StoreError("UNSUPPORTED_PROFILE", "Mac setup requires disjoint physical staging and trusted toolchain paths"); }
function installation(host: MacGitSandboxHost, project: string, writable: readonly string[]) {
  if (![host.node, host.libdir, project, ...writable].every(value => trustedAbsolutePath(value) && !value.endsWith("/")) || host.libdir.includes("\\")) refuse();
  const tools = decodeMacDeveloperTools(host.tools);
  const modules = nodeToolchainMounts(host.node).map(([source]) => dir(source));
  const frameworks = developerToolSystemFrameworks(tools).map(dir);
  const trusted = [host.libdir, tools.contents, ...modules.map(entry => entry.path), ...frameworks.map(entry => entry.path)];
  for (const root of [...trusted, host.node]) {
    if (under(project, root) || under(root, project) || writable.some(value => under(value, root) || under(root, value))) refuse();
  }
  return { tools, readable: [dir(host.libdir), dir(tools.contents), ...modules, ...frameworks],
    executable: [file(host.node), file(tools.git), dir(tools.execPath), ...modules], mapped: [dir(host.libdir), dir(tools.contents), ...frameworks] };
}
type LaunchPlan = { readonly command: CommandSpec; readonly policy: SeatbeltPolicy };
export function candidateSeatbelt(host: MacGitSandboxHost, view: CandidateExecutionView, temporary: string, candidate: string, check: FrozenCheck) {
  const plan = candidateSeatbeltPlan(host, view, temporary, candidate, check);
  return prepareSeatbelt(plan.command, plan.policy);
}
/** The application supplies these bytes to its immutable generation capture.
 * The direct recipe above remains a physical observation primitive. */
export function candidateSeatbeltPlan(host: MacGitSandboxHost, viewInput: CandidateExecutionView, temporary: string, candidate: string, check: FrozenCheck): LaunchPlan {
  const view = decodeCandidateExecutionView(viewInput);
  if (!isValidFullOid(candidate) || view.git !== host.tools.git || !trustedAbsolutePath(temporary) ||
      under(temporary, view.workspace) || under(view.workspace, temporary) || under(temporary, view.project) || under(view.project, temporary)) refuse();
  const roots = installation(host, view.project, [view.workspace, temporary]);
  const downloads = host.downloadCache;
  if (downloads !== undefined && (check.pipeline === undefined || !trustedAbsolutePath(downloads.root) ||
      [view.project, view.workspace, temporary, ...roots.readable.map(entry => entry.path)].some(path => under(path, downloads.root) || under(downloads.root, path)))) refuse();
  const npm = nodeToolchainMounts(host.node).find(([, target]) => target.endsWith("/npm"));
  if (check.pipeline !== undefined && npm === undefined) refuse();
  const pipelineView = check.pipeline === undefined ? undefined : decodePipelineExecutionView({ temporary,
    npm: join(npm![0], "package.json"),
    ...(downloads === undefined ? {} : { downloads: downloads.root }) });
  const env = { ...integrationCheckEnvironment(check, temporary, `${dirname(host.node)}:${dirname(view.git)}:/usr/bin:/bin`),
    // Apple development shims use this observed installation instead of
    // reopening the mutable global xcode-select link outside the policy.
    TMPDIR: temporary, GIT_EXEC_PATH: roots.tools.execPath, DEVELOPER_DIR: roots.tools.developer };
  return { command: { executable: host.node, argv: [join(host.libdir, "apps/oma/dist/entry/candidate-check.js"),
    JSON.stringify({ candidate, argv: check.argv, ...(check.pipeline === undefined ? {} : { pipeline: check.pipeline, pipelineView }),
      ...(downloads === undefined ? {} : { downloadCache: { key: downloads.key, files: downloads.files } }), view })], cwd: view.workspace, env, timeoutMs: null,
    stdoutBytes: 1024 * 1024, stdoutOverflow: "discard", stderrBytes: 1024 * 1024, stderrOverflow: "discard" }, policy: {
    readable: [...roots.readable, ...DEVELOPER_TOOL_SUPPORT_FILES.map(file), dir(view.project), ...(downloads === undefined ? [] : [dir(downloads.root)])],
    writable: [dir(view.workspace), dir(temporary)], denied: [],
    // Checks may execute their own scripts, native addons and build outputs,
    // just as the writable tmpfs view permits on Linux. Developer binaries
    // stay beneath the exact selected installation; frameworks remain map-only.
    executable: [...roots.executable, dir(view.workspace), dir(temporary),
      ...developerToolDirectories(roots.tools).map(dir)],
    mapped: roots.mapped, unixSockets: [], machServices: [], environmentKeys: Object.keys(env),
    profileInput: "stdin", preserveFds: [6, 7, 8, 9, ...(downloads === undefined ? [] : [10])],
  } };
}
export function quarantineSeatbelt(host: MacGitSandboxHost, input: { readonly phase: "verify" | "import"; readonly candidate: string;
  readonly exportRef: string; readonly prerequisites: readonly string[] }, viewInput: QuarantineExecutionView) {
  const plan = quarantineSeatbeltPlan(host, input, viewInput);
  return prepareSeatbelt(plan.command, plan.policy);
}
export function quarantineSeatbeltPlan(host: MacGitSandboxHost, input: { readonly phase: "verify" | "import"; readonly candidate: string;
  readonly exportRef: string; readonly prerequisites: readonly string[] }, viewInput: QuarantineExecutionView): LaunchPlan {
  const view = decodeQuarantineExecutionView(viewInput), repo = join(view.root, "repo");
  if ((input.phase !== "verify" && input.phase !== "import") || !isValidFullOid(input.candidate) || view.git !== host.tools.git ||
      !under(view.temporary, view.root) || under(view.bundle, repo) || under(view.temporary, repo) || under(repo, view.temporary) ||
      under(view.bundle, view.temporary) || !under(view.bundle, view.root)) refuse();
  const writable = input.phase === "verify" ? [repo, view.temporary] : [view.project, view.temporary];
  const roots = installation(host, input.phase === "verify" ? view.project : view.root, writable);
  const env = { ...GIT_ENV, HOME: view.temporary, TMPDIR: view.temporary, GIT_EXEC_PATH: roots.tools.execPath };
  return { command: { executable: host.node, argv: [join(host.libdir, "apps/oma/dist/entry/quarantine.js"), JSON.stringify({ ...input, view })],
    cwd: view.temporary, env, timeoutMs: null, stdoutBytes: 256, stderrBytes: 64 * 1024, stderrOverflow: "discard" }, policy: {
    readable: [...roots.readable, dir(view.root), ...(input.phase === "verify" ? [dir(view.project)] : [])],
    writable: writable.map(dir), denied: [], executable: roots.executable, mapped: roots.mapped,
    unixSockets: [], machServices: [], environmentKeys: Object.keys(env), profileInput: "stdin", preserveFds: [7],
  } };
}
