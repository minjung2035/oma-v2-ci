/** The host's side of project sync (macos-platform §6).
 *
 * The Mac repository is the Human's. The host's git reads it to make a
 * bundle and writes only `refs/remotes/oma/*` and their objects (MAC-420).
 * It trusts nothing the repository says about running things (MAC-404): the
 * product's trusted environment, an empty hooks path, and the settings that
 * would run a program overridden on the command line; it runs only bundle,
 * fetch and inspection commands, never one that touches the working tree.
 */
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { closeSync, constants, createReadStream, fstatSync, fsyncSync, openSync, realpathSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { withProjectSnapshot } from "../../git/project-snapshot.js";
import { prepareHostProjectDirectory, removeHostStaged } from "./files.js";
import type { Socket } from "node:net";
import { StoreError } from "../../domain/errors.js";
import { encodeFrame } from "../../frame.js";
import { GIT_ENV } from "../../process/policies.js";
import { decodeProcessText, runProcess } from "../../process/run.js";
import { PlatformError, readLeadingResponse, unknownOutcome } from "../rpc.js";
import { borrowedFileRange, withStreamSource } from "../stream-source.js";
import { receiveDeclared, type Declared, type StreamSink } from "../stream-receive.js";
import type { ProjectRecord } from "./record.js";

/** Settings a repository could use to make git run a program, overridden. */
const DISTRUST = [
  "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.pager=cat", "-c", "credential.helper=",
  "-c", "core.sshCommand=false", "-c", "protocol.allow=never", "-c", "protocol.file.allow=always",
  "-c", "uploadpack.packObjectsHook=", "-c", "fetch.fsckObjects=true", "-c", "transfer.fsckObjects=true",
];
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!\/)[A-Za-z0-9._/-]{1,200}(?<!\/)(?<!\.lock)$/;

export class MacGit {
  /** `executable`: the git bundled with the app, never the Xcode shim. */
  constructor(private readonly executable: string) {}

  /** MAC-401/403: inspection uses the same distrust policy as transfers. */
  async identity(repo: string): Promise<Pick<ProjectRecord, "gitCommonDir" | "objectFormat" | "rootCommits">> {
    const format = await this.run(repo, ["rev-parse", "--show-object-format"], 30_000);
    const common = await this.run(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"], 30_000);
    const roots = await this.run(repo, ["rev-list", "--max-parents=0", "HEAD"], 30_000);
    const objectFormat = format.stdout.trim();
    const rootCommits = roots.stdout.trim().split("\n");
    if (format.status !== 0 || common.status !== 0 || roots.status !== 0 ||
        (objectFormat !== "sha1" && objectFormat !== "sha256") || !rootCommits.every(root =>
          new RegExp(`^[0-9a-f]{${objectFormat === "sha256" ? 64 : 40}}$`).test(root)))
      throw new StoreError("INVALID_REQUEST", "The project repository could not be identified");
    let gitCommonDir: string;
    try {
      gitCommonDir = realpathSync(common.stdout.trim());
      if (!statSync(gitCommonDir).isDirectory()) throw new Error("not a directory");
    } catch { throw new StoreError("INVALID_REQUEST", "The project repository could not be identified"); }
    return { objectFormat, gitCommonDir, rootCommits };
  }

  async verifyIdentity(repo: string, project: ProjectRecord): Promise<void> {
    const current = await this.identity(repo);
    if (current.objectFormat !== project.objectFormat || !current.rootCommits.some(root => project.rootCommits.includes(root)))
      throw new StoreError("INVALID_REQUEST", "The project folder belongs to a different repository");
  }

  async run(repo: string, argv: readonly string[], timeoutMs = 10 * 60_000): Promise<{ status: number; stdout: string; stderr: string }> {
    const result = await runProcess({ executable: this.executable, argv: ["-C", repo, ...DISTRUST, ...argv],
      env: { ...GIT_ENV }, timeoutMs, stdoutBytes: 4 * 1024 * 1024, stderrBytes: 1024 * 1024 });
    if (result.kind !== "exited") throw new StoreError("BROKER_UNAVAILABLE", "git did not finish");
    return { status: result.exitCode, stdout: decodeProcessText(result.stdout), stderr: decodeProcessText(result.stderr) };
  }

  /** §6.3: the branch, from the last import on, as a bundle file. */
  async bundle(repo: string, branch: string, since: string | null, out: string): Promise<{ bytes: number; sha256: string; head: string }> {
    if (!BRANCH.test(branch)) throw new StoreError("INVALID_REQUEST", "invalid branch name");
    const head = await this.run(repo, ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]);
    if (head.status !== 0) throw new StoreError("INVALID_REQUEST", "the project has no such branch");
    if (since === null) {
      const checkout = await this.run(repo, ["rev-parse", "--verify", "HEAD^{commit}"]);
      if (checkout.status !== 0 || checkout.stdout.trim() !== head.stdout.trim())
        throw new StoreError("INVALID_REQUEST", "the initial snapshot must name the checked-out project branch");
      const format = (await this.run(repo, ["rev-parse", "--show-object-format"])).stdout.trim();
      if (format !== "sha1" && format !== "sha256") throw new StoreError("UNSUPPORTED_PROFILE", "unsupported project object format");
      const snapshotHead = withProjectSnapshot({ source: repo, parent: head.stdout.trim(), sourceIsGit: true,
        format, temporaryParent: dirname(out), executable: this.executable, prepare: prepareHostProjectDirectory }, snapshot => {
        snapshot.git(["update-ref", `refs/heads/${branch}`, snapshot.head]);
        snapshot.git(["bundle", "create", "-q", out, `refs/heads/${branch}`]);
        return snapshot.head;
      });
      return { bytes: statSync(out).size, sha256: await sha256File(out), head: snapshotHead };
    }
    const base = since !== null && (await this.run(repo, ["cat-file", "-e", `${since}^{commit}`])).status === 0 ? [`^${since}`] : [];
    const made = await this.run(repo, ["bundle", "create", "-q", out, `refs/heads/${branch}`, ...base]);
    if (made.status !== 0) throw new StoreError("INTERNAL_ERROR", "the project could not be bundled");
    return { bytes: statSync(out).size, sha256: await sha256File(out), head: head.stdout.trim() };
  }

  /** §6.4: the engine's main into `refs/remotes/oma/main` and nothing else. */
  async fetchExport(repo: string, bundle: string): Promise<{ head: string }> {
    const verified = await this.run(repo, ["bundle", "verify", "-q", bundle]);
    if (verified.status !== 0) throw new StoreError(/lacks these|prerequisite/i.test(verified.stderr) ? "PREREQUISITE_MISSING" : "BUNDLE_INVALID",
      "the engine's result does not verify against this project");
    const fetched = await this.run(repo, ["fetch", "--no-tags", "--no-write-fetch-head", bundle, "+refs/heads/main:refs/remotes/oma/main"]);
    if (fetched.status !== 0) throw new StoreError("BUNDLE_INVALID", "the engine's result could not be brought in");
    return { head: (await this.run(repo, ["rev-parse", "--verify", "refs/remotes/oma/main^{commit}"])).stdout.trim() };
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** §4.8 put: declares the file, sends it, and waits for the guest to say it
 * arrived as declared. */
export async function putStream(opened: { socket: Socket; rest: Buffer }, key: string, path: string, frameBytes: number): Promise<void> {
  const { socket } = opened;
  // Keep the socket owned even while hashing or reading the file. Pipeline
  // observes error/close as well as backpressure; a lost drain cannot hang it.
  const failed = (): void => { socket.destroy(); };
  socket.on("error", failed);
  try {
    if (opened.rest.length > 0) socket.unshift(opened.rest);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    await withStreamSource(fd, async fd => {
      const source = fstatSync(fd);
      if (!source.isFile()) throw new StoreError("INVALID_REQUEST", "a stream source must be a regular file");
      const bytes = source.size;
      const hash = createHash("sha256");
      if (bytes > 0) for await (const chunk of borrowedFileRange(fd, bytes)) hash.update(chunk as Buffer);
      const sha256 = hash.digest("hex");
      socket.write(encodeFrame({ v: 1, id: "put", method: "stream.put", params: { key, bytes, sha256 } }));
      try {
        if (bytes > 0) await pipeline(borrowedFileRange(fd, bytes), socket, { end: false });
      } catch { throw unknownOutcome("the stream transfer could not be observed"); }
      const answer = await readLeadingResponse(socket, "put", frameBytes, 10 * 60_000);
      if (answer.result.bytes !== bytes || answer.result.sha256 !== sha256)
        throw unknownOutcome("the engine's stream receipt was malformed");
    });
  } finally { socket.destroy(); socket.off("error", failed); }
}

/** §4.8 get: the declared stream into the sink `sinkFor` makes once the
 * guest has declared it (P0V-104: the one receiver, `receiveDeclared`). */
export async function getStream(opened: { socket: Socket; rest: Buffer }, key: string, sinkFor: (declared: Declared) => StreamSink,
  frameBytes: number, kind: "export" | "archive" = "export"): Promise<Declared> {
  const { socket } = opened;
  if (opened.rest.length > 0) socket.unshift(opened.rest);
  try {
    socket.write(encodeFrame({ v: 1, id: "get", method: "stream.get", params: { key, kind } }));
    const answer = await readLeadingResponse(socket, "get", frameBytes, 60_000);
    const declared = answer.result;
    if (!Number.isSafeInteger(declared.bytes) || (declared.bytes as number) < 0 || typeof declared.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(declared.sha256))
      throw new PlatformError({ code: "ENGINE_UNAVAILABLE", message: "the engine's stream declaration was malformed", retry: "same-key" });
    const stream = { bytes: declared.bytes as number, sha256: declared.sha256 };
    await receiveDeclared(socket, answer.rest, stream, sinkFor(stream));
    return stream;
  } finally { socket.destroy(); }
}

/** A plain file the host keeps only while it uses it (an export bundle in
 * its transfer directory): written, flushed at the end, removed on failure. */
export function fileSink(path: string): StreamSink {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  let open = true;
  const close = (): void => { if (open) { open = false; closeSync(fd); } };
  return {
    write: chunk => { for (let at = 0; at < chunk.length;) at += writeSync(fd, chunk, at, chunk.length - at); },
    complete: () => { try { fsyncSync(fd); } finally { close(); } },
    abandon: () => { try { close(); } catch { /* already closed */ } removeHostStaged(path); },
  };
}
