import { decodeUtf8 } from "@oma/domain/utf8";
/** A contained search owns its snapshot and walker group. Payload bytes travel
 * on a dedicated pipe directly into the actor's runtime result file. Control
 * frames are bounded; neither process accumulates the full result or a line. */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeSync } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { delimiter, dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { WorkspaceRefusal, isDescriptorOverrun, isDirectoryWithin, withSearchSnapshot, createResult, utf8Prefix, RESULT_PREVIEW_BYTES } from "@oma/tool-files";
import type { createGrepToolDefinition, createFindToolDefinition } from "@earendil-works/pi-coding-agent";
export { WorkspaceRefusal, isDescriptorOverrun } from "@oma/tool-files";
type SearchResult<N extends "grep" | "find"> = Awaited<ReturnType<ReturnType<N extends "grep" ? typeof createGrepToolDefinition : typeof createFindToolDefinition>["execute"]>>;
const SEARCH_STALL_MS = 60_000, HEARTBEAT_ONLY_WINDOWS = 10, KILL_GRACE_MS = 2_000;
const SELF = import.meta.url;
export function resultRootFor(workspace: string): string {
  return process.env.OMA_RESULT_ROOT ?? join(dirname(workspace), ".oma-results", createHash("sha256").update(workspace).digest("hex"));
}
export interface ContainedSearchInput {
  readonly name: "grep" | "find";
  readonly root: string;
  readonly params: Record<string, unknown>;
  readonly heartbeat: number;
}

/** Run in the owned child only: copies the search root into the private
 * snapshot, emitting copy frames, then hands the frozen copy to the caller's
 * `walk` -- the child script, which owns the pinned engine's tool run over it
 * (the engine import and the tool's execute belong to the child's eval
 * boundary, exactly as before this module grew the completion pass). */
export async function searchChildBody(input: ContainedSearchInput,
    signal: AbortSignal, emit: (frame: Record<string, unknown>) => void,
    walk: (cwd: string, target: string) => Promise<string>): Promise<string> {
  let ownedSnapshot: string | null = null;
  // This owner must cover selection too: a pinned walker may ignore SIGTERM
  // before the content walk begins, including after the caller has died.
  const abortOwnedChild = (): void => {
    try { if (ownedSnapshot !== null) rmSync(ownedSnapshot, { recursive:true, force:true }); }
    finally { process.kill(-process.pid, "SIGKILL"); }
  };
  signal.addEventListener("abort",abortOwnedChild,{once:true});
  try {
    let copied = 0; let lastBeat = 0;
    const progress = (): void => {
      copied++;
      const now = Date.now();
      if (now - lastBeat >= 100) { lastBeat = now; emit({ p: "c", n: copied }); }
    };
    // The copy's name must already be in the parent's hand before the
    // directory can exist, so the {p:"d"} frame cannot ride emit's buffered
    // write -- that only reaches the pipe at a later yield, and a child
    // killed or stopped in between would leave a snapshot nobody can name.
    // writeSync puts the bytes in the pipe first: a snapshot that exists was
    // always declared, which is the ordering the parent's close sweep needs.
    // A write that cannot complete fails the snapshot before anything is
    // created, never silently undeclared.
    const named = (name: string): void => {
      ownedSnapshot = join(tmpdir(),name);
      if (signal.aborted) abortOwnedChild();
      const frame = Buffer.from(`${JSON.stringify({ p: "d", s: name })}\n`, "utf8");
      for (let at = 0; at < frame.length;) {
        const wrote = writeSync(1, frame, at, frame.length - at);
        if (wrote <= 0) throw new Error("could not declare the snapshot name");
        at += wrote;
      }
    };
    return await withSearchSnapshot(input.root,
      (input.params.path ?? ".") as string, signal,
      walk, progress, named, {
        ...(input.name === "find" ? {namesOnly:true} : {select:(snapshot:string,target:string)=>selectSearchFiles(input,snapshot,target,signal)}),
        observed: metrics=>emit({p:"metrics",...metrics}),
      });
  } catch (error) {
    // An EMFILE/ENFILE raised inside the snapshot or the pass it owns is
    // the same explicit refusal the snapshot boundary uses, never a
    // shapeless "search failed".
    return JSON.stringify({ error: error instanceof WorkspaceRefusal ? error.message
      : isDescriptorOverrun(error) ? "search snapshot ran out of file descriptors"
      : "contained search failed; no workspace result was returned" });
  } finally { signal.removeEventListener("abort",abortOwnedChild); }
}

/** Pi accepts both system names for fd. Each failed spawn is physically
 * closed before trying the next name; a running walk is never retried. */
async function startSearchWalker(name: "grep" | "find", args: readonly string[], signal?: AbortSignal) {
  const programs = name === "grep" ? ["rg"] : ["fd", "fdfind"];
  let failure: NodeJS.ErrnoException | undefined;
  for (const program of programs) {
    if (signal?.aborted) throw new WorkspaceRefusal("search aborted");
    const walker = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    const started = await new Promise<boolean>(resolve => {
      let launched = false;
      const stop = (): void => { if (!walker.killed) walker.kill(); };
      const failed = (error: Error): void => { failure = error; };
      walker.on("error", failed);
      walker.once("spawn", () => { launched = true; resolve(true); });
      walker.once("close", () => {
        signal?.removeEventListener("abort", stop); walker.off("error", failed);
        if (!launched) resolve(false);
      });
      signal?.addEventListener("abort", stop, { once: true });
      if (signal?.aborted) stop();
    });
    if (started) return walker;
    if (signal?.aborted) throw new WorkspaceRefusal("search aborted");
    if (failure?.code !== "ENOENT") throw failure ?? new Error(`${program} did not start`);
  }
  throw failure ?? new Error("search walker is unavailable");
}


/** Pinned ripgrep owns ignore precedence; names are streamed as NUL records.
 * The source payload is absent until the selected inode is revalidated. */
async function* selectSearchFiles(input: ContainedSearchInput,snapshot:string,target:string,signal:AbortSignal): AsyncIterable<string> {
  process.chdir(snapshot);
  const args=["--files","--null","--hidden"];
  if(typeof input.params.glob === "string" && input.params.glob)args.push("--glob",input.params.glob);
  args.push("--",relative(snapshot,target)||".");
  const walker=await startSearchWalker("grep",args,signal);
  let error="";walker.stderr.on("data",(b:Buffer)=>{if(error.length<4096)error+=b.toString("utf8").slice(0,4096-error.length);});
  const done=new Promise<number|null>((resolve,reject)=>{walker.once("error",reject);walker.once("close",resolve);});
  let tail=Buffer.alloc(0);
  try {
    for await(const chunk of walker.stdout) {
      const bytes=Buffer.concat([tail,Buffer.from(chunk)]);let at=0;
      for(;;){const end=bytes.indexOf(0,at);if(end<0)break;
        yield decodeUtf8(bytes.subarray(at,end));at=end+1;
      }
      tail=Buffer.from(bytes.subarray(at));
    }
    const code=await done;
    if(signal.aborted || tail.length || (code!==0 && code!==1))throw new WorkspaceRefusal(error||"search selection was incomplete");
  } finally {if(walker.exitCode===null)walker.kill();await done.catch(()=>{});}
}

/** Pinned walker output is rendered incrementally, including arbitrarily long
 * source lines. Only the header (bounded by filesystem path length) is held.
 * Caller limits bound matches; preview limits never stop the walker. */
export async function streamSearch(input: ContainedSearchInput, target: string, signal: AbortSignal,
    output: (bytes: Buffer) => void): Promise<{ complete: boolean; limitReached: boolean; reason?: string }> {
  const { name, params } = input;
  const displayedRoot = isDirectoryWithin(process.cwd(),target) ? target : dirname(target);
  const prefixToStrip = relative(process.cwd(),displayedRoot);
  const displayPath = (value:string):string => { const path=value.replace(/^\.\//, ""); return prefixToStrip && path.startsWith(`${prefixToStrip}/`) ? path.slice(prefixToStrip.length+1) : path; };
  const context = typeof params.context === "number" && params.context > 0 ? Math.floor(params.context) : 0;
  const limit = typeof params.limit === "number" && Number.isFinite(params.limit)
    ? name === "find" && params.limit === 0 ? null : Math.max(1, params.limit) : null;
  const args = name === "grep" ? ["--line-number", "--null", "--with-filename", "--no-heading", "--no-context-separator", "--color=never", "--hidden"]
    : ["--glob", "--color=never", "--hidden"];
  if (name === "grep") {
    if (params.ignoreCase === true) args.push("--ignore-case");
    if (params.literal === true) args.push("--fixed-strings");
    if (typeof params.glob === "string" && params.glob) args.push("--glob", params.glob);
    if (context) args.push("--context", String(context));
    args.push("--", String(params.pattern ?? ""), relative(process.cwd(), target) || ".");
  } else {
    if (limit !== null) args.push("--max-results", String(Math.ceil(limit)));
    let pattern = String(params.pattern ?? "");
    if (pattern.includes("/")) { args.push("--full-path"); if (!pattern.startsWith("/") && !pattern.startsWith("**/")) pattern = `**/${pattern}`; }
    args.push("--", pattern, relative(process.cwd(), target) || ".");
  }
  const walker = await startSearchWalker(name, args, signal);
  let stderr = "", count = 0, limited = false, failed: unknown, prefix = Buffer.alloc(0), header = true, any = false;
  let skip = false, tail = 0;
  const put = (bytes: Buffer): void => { if (bytes.length) { output(bytes); any = true; } };
  const emitHeader = (final: boolean): void => {
    // NUL terminates the pathname: '-' and ':' inside names or payloads are
    // never row metadata. Keep the payload as bytes, including partial UTF-8.
    const boundary = prefix.indexOf(0);
    const match = boundary < 0 ? null : /^(\d+)([:-])/.exec(prefix.subarray(boundary + 1).toString("utf8"));
    if (name === "grep" && match) {
      if (match[2] === ":") {
        if (limit !== null && count >= limit) { limited = true; skip = true; walker.kill(); }
        else { count++; tail = context; }
      } else if (limit !== null && count >= limit && tail-- <= 0) { limited = true; skip = true; walker.kill(); }
      if (!skip) {
        const path = displayPath(prefix.subarray(0, boundary).toString("utf8"));
        put(Buffer.from(`${path}${match[2]}${match[1]}${match[2]} `));
        put(prefix.subarray(boundary + 1 + match[0].length));
      }
      header = false; prefix = Buffer.alloc(0);
    } else if (name === "find" || final || prefix.length >= 16384) {
      if (!skip) put(name === "find" ? Buffer.from(displayPath(prefix.toString("utf8"))) : prefix); prefix = Buffer.alloc(0); header = false;
    }
  };
  walker.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 4096) stderr += chunk.toString("utf8").slice(0, 4096 - stderr.length); });
  const done = new Promise<number | null>((resolve, reject) => { walker.once("error", reject); walker.once("close", resolve); });
  walker.stdout.on("data", (chunk: Buffer) => {
    if (failed !== undefined || skip) return;
    try {
      for (let start = 0; start < chunk.length;) {
        // A pathname may itself contain LF. Until its NUL delimiter arrives,
        // LF is pathname data, not a match-row boundary. Context has no separate
        // unframed group marker (--no-context-separator above).
        const waitingForPath = name === "grep" && header && prefix.indexOf(0) < 0;
        const boundary = waitingForPath ? chunk.indexOf(0, start) : -1;
        const lineStart = waitingForPath ? boundary < 0 ? chunk.length : boundary + 1 : start;
        const end = chunk.indexOf(10, lineStart), next = end < 0 ? chunk.length : end;
        const part = chunk.subarray(start, next);
        if (header) { prefix = Buffer.concat([prefix, part]); emitHeader(end >= 0); }
        else put(part);
        if (end >= 0) {
          if (!skip) put(Buffer.from("\n"));
          if (name === "find") count++;
          if (limit !== null && count >= limit && context === 0) { limited = true; skip = true; walker.kill(); }
          header = true;
        }
        start = end < 0 ? chunk.length : end + 1;
        if (skip) break;
      }
    } catch (error) { failed = error; walker.kill(); }
  });
  const code = await done;
  if (header && prefix.length && failed === undefined) emitHeader(true);
  if (failed !== undefined) throw failed;
  if (signal.aborted) return { complete: false, limitReached: limited, reason: "search cancelled" };
  if (code !== 0 && code !== 1 && !limited) return { complete: false, limitReached: false, reason: stderr || `walker exited ${code}` };
  if (!any) put(Buffer.from(name === "grep" ? "No matches found" : "No files found matching pattern"));
  return { complete: true, limitReached: limited };
}
const SCRIPT = `
const controller=new AbortController();process.stdin.resume();process.stdin.once('end',()=>controller.abort());
const input=JSON.parse(process.argv[2]);
const emit=o=>{const b=Buffer.from(JSON.stringify(o)+'\\n');for(let at=0;at<b.length;)at+=fs.writeSync(1,b,at,b.length-at)};
const fs=await import('node:fs');
const beater=new (await import('node:worker_threads')).Worker(\`import{writeSync}from'node:fs';import{workerData}from'node:worker_threads';setInterval(()=>{try{writeSync(1,'{"p":"s"}'+String.fromCharCode(10))}catch{}},workerData.iv);\`,{eval:true,workerData:{iv:input.heartbeat}});beater.on('error',()=>{});
let output;
try {
 const run=await import(process.argv[1]);
 output=await run.searchChildBody(input,controller.signal,emit,async(cwd,target)=>{
  process.chdir(cwd);const home=(await import('node:path')).dirname(cwd);
  const end=()=>{try{fs.rmSync(home,{recursive:true,force:true})}finally{process.kill(-process.pid,'SIGKILL')}};
  controller.signal.addEventListener('abort',end,{once:true});if(controller.signal.aborted)end();
  process.env.HOME=home;process.env.XDG_CONFIG_HOME=home;
  const result=await run.streamSearch(input,target,controller.signal,b=>{for(let at=0;at<b.length;)at+=fs.writeSync(3,b,at,b.length-at)});
  return JSON.stringify({result});
 });
} catch(error) {output=JSON.stringify({error:String(error)});}
finally {await beater.terminate();process.stdout.end(output+'\\n',()=>process.kill(-process.pid,'SIGKILL'));}
`;
export interface ContainedSearchSpool { readonly root: string }
export function searchWorkspace<N extends "grep" | "find">(name: N, root: string, params: object,
    signal?: AbortSignal, stallMs = SEARCH_STALL_MS, spool?: ContainedSearchSpool): Promise<SearchResult<N>> {
  const resultRoot = spool?.root ?? resultRootFor(root);
  let writer: ReturnType<typeof createResult> | undefined, writeFailure: string | undefined;
  try { mkdirSync(resultRoot, { recursive: true, mode: 0o700 }); writer = createResult(resultRoot); }
  catch (error) { writeFailure = error instanceof Error ? error.message : String(error); }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", SCRIPT, SELF,
      JSON.stringify({ name, root, params, heartbeat: Math.max(50, Math.floor(stallMs / 6)) })], {
      cwd: root, detached: true, stdio: ["pipe", "pipe", "ignore", "pipe"],
      env: { PATH: `${join(getAgentDir(), "bin")}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
        HOME: "/nonexistent", XDG_CONFIG_HOME: "/nonexistent", TMPDIR: tmpdir() },
    });
    let metrics: Record<string,unknown> | undefined;
    let snapshot: string | null = null, failure: string | undefined, answer: { result?: { complete: boolean; limitReached: boolean; reason?: string }; error?: string } | undefined;
    let preview = Buffer.alloc(0), total = 0, killer: NodeJS.Timeout | undefined;
    const stop = (reason: string): void => {
      failure ??= reason; child.stdin!.end();
      killer ??= setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch {} }, KILL_GRACE_MS);
    };
    let timer = setTimeout(() => stop("search produced no output"), stallMs);
    let progress = setTimeout(() => stop("search produced only heartbeats"), stallMs * HEARTBEAT_ONLY_WINDOWS);
    const beat = (real: boolean): void => {
      clearTimeout(timer); timer = setTimeout(() => stop("search produced no output"), stallMs);
      if (real) { clearTimeout(progress); progress = setTimeout(() => stop("search produced only heartbeats"), stallMs * HEARTBEAT_ONLY_WINDOWS); }
    };
    const abort = (): void => stop("search cancelled"); signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdin!.on("error", () => {});
    const controls = createInterface({ input: child.stdout! });
    controls.on("line", line => {
      if (line.length > 16384) { stop("invalid search control frame"); return; }
      try {
        const frame = JSON.parse(line); beat(frame.p !== "s");
        if (frame.p === "d" && typeof frame.s === "string" && /^oma-search-[^/\\\0]+$/.test(frame.s)) snapshot = frame.s;
        if (frame.p === "metrics") { const {p,...rest}=frame;metrics=rest; }
        if (frame.result || frame.error) answer = frame;
      } catch { stop("invalid search control frame"); }
    });
    (child.stdio[3] as import("node:stream").Readable).on("data", (chunk: Buffer) => {
      beat(true); total += chunk.length;
      if (preview.length < RESULT_PREVIEW_BYTES + 4) preview = Buffer.concat([preview, chunk.subarray(0, RESULT_PREVIEW_BYTES + 4 - preview.length)]);
      if (writer && !writeFailure) try { writer.append(chunk); } catch (error) { writeFailure = String(error); writer.close(); stop("result storage failed"); }
    });
    child.on("error", error => { failure ??= error.message; });
    child.on("close", () => {
      clearTimeout(timer); clearTimeout(progress); clearTimeout(killer); controls.close(); signal?.removeEventListener("abort", abort);
      if (snapshot !== null) try { rmSync(join(tmpdir(), snapshot), { recursive: true, force: true }); } catch {}
      let saved: ReturnType<ReturnType<typeof createResult>["finish"]> | undefined;
      if (writer && !writeFailure) try { saved = writer.finish(); } catch (error) { writeFailure = String(error); }
      writer?.close();
      const reason = writeFailure ?? failure ?? answer?.error ?? answer?.result?.reason;
      if (answer?.error && total === 0 && !failure && !writeFailure) { reject(new WorkspaceRefusal(answer.error)); return; }
      const complete = reason === undefined && answer?.result?.complete === true && saved !== undefined;
      const shown = utf8Prefix(preview, RESULT_PREVIEW_BYTES).toString("utf8");
      const metadata = { ...saved, ...(metrics ? {selection:metrics} : {}), bytes: total, complete, limitReached: answer?.result?.limitReached ?? false,
        ...(reason === undefined ? {} : { reason }), previewBytes: Buffer.byteLength(shown),
        read: saved ? { path: saved.reference, byteOffset: 0, byteLimit: 65536 } : null };
      resolve({ content: [{ type: "text", text: `${shown}\n\n${JSON.stringify(metadata)}` }], details: { result: metadata } } as SearchResult<N>);
    });
  });
}
