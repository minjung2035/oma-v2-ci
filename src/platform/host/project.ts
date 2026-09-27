/** The host's side of project sync (macos-platform §6).
 *
 * The Mac repository is the Human's. The host's git reads it to make a
 * bundle and writes only `refs/remotes/oma/*` and their objects (MAC-420).
 * It trusts nothing the repository says about running things (MAC-404): the
 * product's trusted environment, an empty hooks path, and the settings that
 * would run a program overridden on the command line; it runs only bundle,
 * fetch and inspection commands, never one that touches the working tree.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, createReadStream, fsyncSync, openSync, statSync, writeSync } from "node:fs";
import type { Socket } from "node:net";
import { StoreError } from "../../domain/errors.js";
import { encodeFrame } from "../../frame.js";
import { GIT_ENV } from "../../process/policies.js";
import { decodeProcessText, runProcess } from "../../process/run.js";
import { PlatformError, readLeadingFrame } from "../rpc.js";
import { responseProblem, type PlatformFailure } from "../../protocol/host-guest.js";

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

function failureOf(frame: Record<string, unknown>): PlatformError {
  if (responseProblem(frame) !== null) return new PlatformError({ code: "ENGINE_UNAVAILABLE", message: "the engine's answer was malformed", retry: "same-key" });
  return new PlatformError(frame.error as PlatformFailure);
}

/** §4.8 put: declares the file, sends it, and waits for the guest to say it
 * arrived as declared. */
export async function putStream(opened: { socket: Socket; rest: Buffer }, key: string, path: string, frameBytes: number): Promise<void> {
  const { socket } = opened;
  if (opened.rest.length > 0) socket.unshift(opened.rest);
  const bytes = statSync(path).size;
  const sha256 = await sha256File(path);
  socket.write(encodeFrame({ v: 1, id: "put", method: "stream.put", params: { key, bytes, sha256 } }));
  for await (const chunk of createReadStream(path)) if (!socket.write(chunk as Buffer)) await new Promise(resolve => socket.once("drain", resolve));
  const answer = await readLeadingFrame(socket, frameBytes, 10 * 60_000);
  socket.destroy();
  if (answer.frame.ok !== true) throw failureOf(answer.frame);
}

/** §4.8 get: the declared stream into `path`, kept only if it is what the
 * guest declared. */
export async function getStream(opened: { socket: Socket; rest: Buffer }, key: string, path: string, frameBytes: number,
  kind: "export" | "archive" = "export"): Promise<{ bytes: number; sha256: string }> {
  const { socket } = opened;
  if (opened.rest.length > 0) socket.unshift(opened.rest);
  socket.write(encodeFrame({ v: 1, id: "get", method: "stream.get", params: { key, kind } }));
  const answer = await readLeadingFrame(socket, frameBytes, 60_000);
  if (answer.frame.ok !== true) { socket.destroy(); throw failureOf(answer.frame); }
  const declared = answer.frame.result as { bytes: number; sha256: string };
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
  const hash = createHash("sha256");
  let received = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const take = (chunk: Buffer): void => {
        if (received + chunk.length > declared.bytes) { reject(new StoreError("STREAM_INVALID", "the engine sent more than it declared")); return; }
        hash.update(chunk);
        for (let at = 0; at < chunk.length; ) at += writeSync(fd, chunk, at, chunk.length - at);
        received += chunk.length;
      };
      if (answer.rest.length > 0) take(answer.rest);
      socket.on("data", take);
      socket.once("close", () => { received === declared.bytes ? resolve() : reject(new StoreError("STREAM_INVALID", "the engine's stream ended short")); });
      socket.resume();
    });
    fsyncSync(fd);
  } finally { closeSync(fd); socket.destroy(); }
  if (hash.digest("hex") !== declared.sha256) throw new StoreError("STREAM_INVALID", "the engine's stream is not what it declared");
  return declared;
}
