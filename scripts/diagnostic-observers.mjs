/** Administrator-only read adapters. Fixed commands, no repair or provider calls. */
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { sha256Hex } from "@oma/domain/canonical-json";
import { contextEntriesCheck } from "@oma/domain/context-policy";
import { GitObserver } from "@oma/git/observe";
import { runProcessSync, decodeProcessText } from "@oma/process/run";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { observeNamespaceProcess } from "@oma/native/pid-namespace";
import { assertDirectory } from "@oma/storage/directory";
import { isPublishedRef } from "@oma/domain/derived";
import { isValidFullOid, isValidSocietyName } from "@oma/domain/identifiers";

export const DIAGNOSTIC_PROCESS_LIMITS = Object.freeze({ timeoutMs: 30000, maxCommands: 256, commandMs: 10000 });
export function createDiagnosticObservers(context, options = {}) {
  if (!isValidSocietyName(context.society)) throw new TypeError("invalid diagnostic society");
  const limits = { ...DIAGNOSTIC_PROCESS_LIMITS, ...options.limits };
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("invalid diagnostic process budget");
  if (limits.commandMs > 0x7fffffff || limits.timeoutMs > 0x7fffffff) throw new RangeError("unsupported diagnostic timeout");
  const invoke = options.invoke ?? runProcessSync;
  const now = options.now ?? (() => performance.now());
  const deadline = now() + limits.timeoutMs;
  let commands = 0, outputTotal = 0;
  const environment = Object.freeze({ PATH: "/usr/bin:/bin", HOME: "/nonexistent", LANG: "C", LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "" });
  const run = (executable, argv, env, input, outputBytes) => {
    const remaining = Math.floor(deadline - now());
    if (remaining < 1 || commands >= limits.maxCommands) throw new Error("diagnostic command budget exhausted");
    commands++;
    if (outputTotal + outputBytes + 65536 > 64 * 1024 * 1024) throw new Error("diagnostic aggregate output budget exhausted");
    const result = invoke({ executable, argv, env, timeoutMs: Math.min(limits.commandMs, remaining),
      stdoutBytes: outputBytes, stderrBytes: 65536, ...(input === undefined ? {} : { input }) });
    outputTotal += result.stdout.byteLength + result.stderr.byteLength;
    return result;
  };
  const unavailable = () => ({ status: null, signal: null, stdout: null, stderr: null });
  const repositories = new Set([join(context.stateRoot, "repos/project.git"), join(context.stateRoot, "repos/context.git")]);
  const git = new GitObserver((argv, input) => {
    try {
      if (argv[0] !== "--git-dir" || !repositories.has(argv[1])) return unavailable();
      const command = argv.slice(2);
      const ref = command.length === 4 && command[0] === "rev-parse" && command[1] === "--verify" && command[2] === "--quiet" &&
        (command[3] === "refs/heads/main" || isPublishedRef(command[3])) && input === undefined;
      const commit = command.length === 2 && command[0] === "cat-file" && command[1] === "--batch-check=%(objecttype)" &&
        typeof input === "string" && input.endsWith("^{commit}\n") && isValidFullOid(input.slice(0, -10));
      const ancestry = command.length === 4 && command[0] === "merge-base" && command[1] === "--is-ancestor" &&
        isValidFullOid(command[2]) && isValidFullOid(command[3]) && input === undefined;
      if (!ref && !commit && !ancestry) return unavailable();
      assertDirectory(argv[1]);
      const result = run("/usr/bin/git", ["--no-pager", ...argv], environment, input, 65536);
      return result.kind === "exited" ? { status: result.exitCode, signal: result.signal, stdout: result.stdout, stderr: result.stderr } : unavailable();
    } catch { return unavailable(); }
  });
  // Canonical candidate bytes must agree with the accepted context manifest,
  // not just with a revision directory whose name happens to contain that OID.
  const contextTree = (repository, candidate, entries) => {
    try {
      if (!repositories.has(repository) || !isValidFullOid(candidate) || contextEntriesCheck(entries, { requireSorted: true }))
        return { kind: "corrupt", reason: "INVALID_CONTEXT_IDENTITY" };
      assertDirectory(repository);
      const listing = run("/usr/bin/git", ["--no-pager", "--git-dir", repository, "ls-tree", "-r", "-z", "--full-tree", candidate], environment, undefined, 256 * 1024);
      if (listing.kind !== "exited" || listing.exitCode !== 0 || listing.stderr.length)
        return { kind: "unknown", reason: "CONTEXT_TREE_UNAVAILABLE" };
      const text = decodeProcessText(listing.stdout);
      if (!text.endsWith("\0")) return { kind: "corrupt", reason: "INVALID_CONTEXT_TREE" };
      const records = text.slice(0, -1).split("\0"), blobs = new Map();
      for (const row of records) {
        const match = /^(100644) blob ([0-9a-f]+)\t([^\0]+)$/.exec(row);
        if (!match || !isValidFullOid(match[2]) || blobs.has(match[3])) return { kind: "corrupt", reason: "INVALID_CONTEXT_TREE" };
        blobs.set(match[3], match[2]);
      }
      if (blobs.size !== entries.length || entries.some(entry => !blobs.has(entry.path)))
        return { kind: "corrupt", reason: "CONTEXT_TREE_PATHS" };
      for (const entry of entries) {
        if (entry.bytes > 16 * 1024 * 1024) return { kind: "unknown", reason: "CONTEXT_BLOB_BUDGET" };
        const content = run("/usr/bin/git", ["--no-pager", "--git-dir", repository, "cat-file", "blob", blobs.get(entry.path)], environment, undefined, entry.bytes + 1);
        if (content.kind !== "exited" || content.exitCode !== 0 || content.stderr.length)
          return { kind: "unknown", reason: "CONTEXT_BLOB_UNAVAILABLE" };
        if (content.stdout.length !== entry.bytes || sha256Hex(content.stdout) !== entry.sha256)
          return { kind: "corrupt", reason: "CONTEXT_TREE_BYTES" };
      }
      return { kind: "present", value: true };
    } catch { return { kind: "unknown", reason: "CONTEXT_TREE_UNAVAILABLE" }; }
  };
  const units = agent => {
    try {
      const entry = ExecutionJournal.inspect(context.stateRoot).find(value => value.slot === `resident:${agent.name}`);
      if (!entry?.witness) return { kind: "unknown", reason: "EXECUTION_WITNESS_NOT_OBSERVED" };
      const observation = observeNamespaceProcess(entry.witness.pid);
      if (observation.kind === "unavailable") return { kind: "unknown", reason: "EXECUTION_PROCESS_UNAVAILABLE" };
      const live = observation.kind === "running" && Object.keys(entry.witness).every(key => observation.identity[key] === entry.witness[key]);
      return { kind: "present", value: { activeState: live ? "active" : "inactive", subState: live ? "scope-populated" : "scope-empty",
        result: "unknown", execMainStatus: -1, invocationId: entry.execution.replaceAll("-", ""), scope: entry.execution } };
    } catch { return { kind: "unknown", reason: "EXECUTION_OBSERVATION_UNAVAILABLE" }; }
  };
  // Diagnostics report an unavailable observation, not a failed repair. The
  // observer can refuse malformed arguments before its process runner is called.
  const observe = method => (...args) => {
    try { return method.apply(git, args); }
    catch { return { kind: "unknown", reason: "GIT_OBSERVATION_UNAVAILABLE", evidence: unavailable() }; }
  };
  return Object.freeze({ git: Object.freeze({ ref: observe(git.ref), commit: observe(git.commit), ancestry: observe(git.ancestry), contextTree }), units, get commands() { return commands; } });
}
