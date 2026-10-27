/** PR-004/P0-4: one child owns the private copy and every walker it starts.
 * EOF on its parent pipe aborts the work and removes the copy before exit.
 *
 * P0: a search is never refused for size or elapsed time. The child emits one
 * JSON frame per line -- `{p:"d",s}` declaring the private copy's name before
 * it exists, `{p:"c",n}` progress while it copies, `{p:"r",n}` progress while a
 * completion pass reads its walker, `{p:"s"}` heartbeats from a second thread
 * while the engine's own pass runs -- and one final `{result}`/`{error}`
 * line. The parent watches two windows, not one deadline:
 *
 * - Silence: any byte at all restarts the stall window. A child that is dead,
 *   stopped or output-blocked emits nothing -- the heartbeat thread stops
 *   with it -- and is reclaimed inside one window.
 * - Progress: only main-thread output restarts the progress window -- every
 *   frame but `{p:"s"}` (the worker cannot write those) and every non-frame
 *   byte (the answer writing itself out). Heartbeats prove the process lives,
 *   not that it advances: a child whose only output for HEARTBEAT_ONLY_
 *   WINDOWS stall windows is `{p:"s"}` has a wedged or unobservable main
 *   thread and is reclaimed too, so a hung `tool.execute` still ends in
 *   bounded time. The honest cost: the engine's own first-pass walk forwards
 *   nothing the child can report, so it is observed by liveness and bounded
 *   by the progress window; the unbounded phases the child owns -- the copy
 *   and the complete rendering -- report real progress and are never cut.
 *
 * The upstream tools' own rendering is still truncated at 50 KiB and 500-char
 * lines, and at 100/1000 results when the caller did not ask for a bound --
 * those are renderer caps, not a refusal, so they are converted: when the
 * tool reports a bound the caller did not choose, the same pinned walker
 * runs again over the same frozen snapshot for the complete rendering. A
 * complete answer that fits is returned inline; a larger one crosses the
 * pipe in the result envelope and the parent writes it whole into the
 * caller's workspace under `.oma/search-results/` through the same
 * serialized contained writer every workspace write takes --
 * so the path the result names is one the model's own read/grep/find/ls can
 * open. A spool file is ordinary workspace content (P0-4): guard-admitted,
 * owned by the workspace owner like any authored file, and
 * never swept by OMA -- the result names it and it can be deleted like any
 * file. When no spool can take it the answer is still not truncated: it
 * rides inline with the notice that says why it is not at a path.
 *
 * One naming edge is documented rather than closed: the parent's close
 * sweep removes the LAST declared `oma-search-*` name under tmpdir. A
 * declaration followed by an EEXIST retry and then a child death could
 * point that sweep at a directory the child never owned -- a name stolen
 * between declaration and creation, if the retry's declared name is the
 * one that got preempted. Reaching it needs a fresh-UUID name stolen
 * before the child's mkdir, and the name rides only the pipe until that
 * mkdir, so a thief cannot learn it in time -- the gap is recorded here
 * instead of coded around. */
import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeSync } from "node:fs";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { basename, delimiter, isAbsolute, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { WorkspaceRefusal, isDescriptorOverrun, withSearchSnapshot } from "@oma/tool-files";
import type { createGrepToolDefinition, createFindToolDefinition } from "@earendil-works/pi-coding-agent";
export { WorkspaceRefusal, isDescriptorOverrun } from "@oma/tool-files";
type SearchResult<N extends "grep" | "find"> = Awaited<ReturnType<ReturnType<N extends "grep" ? typeof createGrepToolDefinition : typeof createFindToolDefinition>["execute"]>>;

/** The observation window one chunk of child output buys. A child that can
 * still produce output emits well inside it; a child that is dead, stopped
 * or output-blocked emits nothing and is reclaimed. This is a silence
 * detector: heartbeat bytes buy it just as answer bytes do. */
const SEARCH_STALL_MS = 60_000;
/** How many silence windows a child may report heartbeats and nothing else.
 * Heartbeats are liveness, not progress -- a main thread wedged in a call it
 * cannot leave keeps beating from the worker thread forever. The window is
 * generous on purpose: inside it sits the engine's own first-pass walk,
 * which forwards nothing to report, plus the synchronous bundle load. The
 * phases that can produce unbounded work report real progress ({p:"c"},
 * {p:"r"}, answer bytes) and outlive any number of windows. */
const HEARTBEAT_ONLY_WINDOWS = 10;
/** Grace between the parent's pipe close (which lets a live child clean up
 * after itself) and the group kill that a dead child cannot run. */
const KILL_GRACE_MS = 2_000;
/** The most answer text one tool result carries inline. A longer answer is
 * written whole into the workspace spool and the result names the admitted
 * path -- the same complete data, one `read` away instead of an error away.
 * The value matches the former inline boundary so what fit before still
 * fits. */
const SEARCH_PREVIEW_BYTES = 1024 * 1024;
/** Where inside the workspace a spilled answer lands: an ordinary workspace
 * path, so the guard's admission and the model's own tools all
 * reach it unchanged. */
const SEARCH_SPOOL_DIR = join(".oma", "search-results");
const SELF = import.meta.url;

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
      const frame = Buffer.from(`${JSON.stringify({ p: "d", s: name })}\n`, "utf8");
      for (let at = 0; at < frame.length;) {
        const wrote = writeSync(1, frame, at, frame.length - at);
        if (wrote <= 0) throw new Error("could not declare the snapshot name");
        at += wrote;
      }
    };
    return await withSearchSnapshot(input.root,
      (input.params.path ?? ".") as string, signal,
      walk, progress, named);
  } catch (error) {
    // An EMFILE/ENFILE raised inside the snapshot or the pass it owns is
    // the same explicit refusal the snapshot boundary uses, never a
    // shapeless "search failed".
    return JSON.stringify({ error: error instanceof WorkspaceRefusal ? error.message
      : isDescriptorOverrun(error) ? "search snapshot ran out of file descriptors"
      : "contained search failed; no workspace result was returned" });
  }
}

/** The post-walk half of the child's body: the upstream tool's result is in
 * hand, rendered under its own fixed caps. A bound the caller did not choose
 * -- the 50 KiB render cap, the 500-character line cap, or the default
 * match/result count -- is converted, not reported: the same pinned walker
 * runs again over the same frozen snapshot for the complete rendering, and
 * only the caller's own `limit` may bound it. A complete answer that fits
 * returns inline; a larger one crosses the pipe in the result envelope as
 * `complete` -- the parent owns the preview cut and the workspace spool the
 * result will name, because the workspace is its side of the pipe, not the
 * child's. */
export async function finishSearchResult(input: ContainedSearchInput,
    result: SearchResult<"grep" | "find">, target: string, signal?: AbortSignal,
    progress?: () => void): Promise<string> {
  const resultRecord = result as { content?: { type: string; text?: string }[]; details?: Record<string, unknown> };
  const details = { ...(resultRecord.details ?? {}) } as Record<string, unknown>;
  const callerLimit = typeof input.params.limit === "number" && Number.isFinite(input.params.limit) &&
    !(input.name === "find" && input.params.limit === 0);
  const truncation = details.truncation as { truncated?: boolean } | undefined;
  const hidden = truncation?.truncated === true || details.linesTruncated === true ||
    (!callerLimit && (details.matchLimitReached !== undefined || details.resultLimitReached !== undefined));
  if (hidden) {
    let complete: string;
    let completed = false;
    try {
      complete = await completeSearchText(input.name, input.params, target, signal, progress);
      completed = true;
    } catch (error) {
      // The tool's own answer stays, its truncation notices included,
      // and the marker says the completion pass failed -- never a
      // silently cut answer.
      complete = `${resultRecord.content?.[0]?.text ?? ""}\n\noma: the complete result could not be produced (${error instanceof Error ? error.message : String(error)})`;
    }
    if (completed) {
      // The complete rendering replaces the upstream renderer's fixed caps.
      // Keep only a result limit the caller actually requested.
      delete details.truncation; delete details.linesTruncated;
      if (!callerLimit) { delete details.matchLimitReached; delete details.resultLimitReached; }
      resultRecord.details = details;
    }
    if (Buffer.byteLength(complete, "utf8") <= SEARCH_PREVIEW_BYTES) {
      resultRecord.content = [{ type: "text", text: complete }];
      resultRecord.details = details;
    } else {
      return JSON.stringify({ result, complete });
    }
  }
  return JSON.stringify({ result });
}

/** One path line the way the engine's own find renders it: relative to the
 * searched root, forward slashes, a trailing slash kept for directories. */
function shownPath(path: string, target: string): string {
  const trailing = path.endsWith(sep);
  const rel = isAbsolute(path) ? relative(target, path) : path;
  const posix = rel.split(sep).join("/");
  return trailing && !posix.endsWith("/") ? `${posix}/` : posix;
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

/** The complete rendering the pinned walker produces over the frozen
 * snapshot: same arguments and same line format the engine's tool uses, with
 * the renderer's fixed 50 KiB / 500-character caps and (unless the caller
 * asked) its result-count caps removed. The caller's own `limit` still
 * applies -- it is part of the request, not a hidden bound. */
export async function completeSearchText(name: "grep" | "find", params: Record<string, unknown>,
    target: string, signal?: AbortSignal, progress?: () => void): Promise<string> {
  // Pi clamps grep to at least one but keeps the supplied numeric threshold;
  // fd accepts zero as unlimited. An absent limit lifts the hidden default.
  const limit = typeof params.limit === "number" && Number.isFinite(params.limit)
    ? name === "find" ? params.limit === 0 ? null : params.limit : Math.max(1, params.limit) : null;
  const args: string[] = name === "grep"
    ? ["--json", "--line-number", "--color=never", "--hidden"]
    : ["--glob", "--color=never", "--hidden"];
  const context = typeof params.context === "number" && params.context > 0 ? Math.floor(params.context) : 0;
  if (name === "grep") {
    if (params.ignoreCase === true) args.push("--ignore-case");
    if (params.literal === true) args.push("--fixed-strings");
    if (typeof params.glob === "string" && params.glob !== "") args.push("--glob", params.glob);
    args.push("--", String(params.pattern ?? ""), target);
  } else {
    // The snapshot root always carries the empty .git marker withSearchSnapshot
    // creates, so the walker is in its git-aware mode here -- the same mode
    // the upstream tool's ancestor check picks for it; --no-require-git would
    // say the opposite.
    if (limit !== null) args.push("--max-results", String(limit));
    let pattern = String(params.pattern ?? "");
    if (pattern.includes("/")) {
      args.push("--full-path");
      if (!pattern.startsWith("/") && !pattern.startsWith("**/") && pattern !== "**") pattern = `**/${pattern}`;
      if (process.platform === "win32") pattern = pattern.replaceAll("/", String.raw`[/\\]`);
    }
    args.push("--", pattern, target);
  }
  const walker = await startSearchWalker(name, args, signal);
  const lines: string[] = [];
  let seen = 0;
  let killedForLimit = false;
  let stderr = "";
  walker.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  // Match events only, the way the upstream tool collects them; context lines
  // are rendered below from the frozen files themselves, in the same block
  // format -- `path:N:` for the hit, `path-n-` around it.
  const matches: { filePath: string; lineNumber: number; text: string }[] = [];
  const reader = createInterface({ input: walker.stdout });
  const done = new Promise<void>((resolve, reject) => {
    walker.on("error", reject);
    walker.on("close", code => {
      if (signal?.aborted) { reject(new WorkspaceRefusal("search aborted")); return; }
      if (!killedForLimit && code !== 0 && code !== 1 && lines.length === 0 && matches.length === 0)
        { reject(new Error(stderr.trim() || `${name === "grep" ? "ripgrep" : "fd"} exited with code ${code}`)); return; }
      resolve();
    });
  });
  reader.on("line", line => {
    progress?.();
    if (!line || name === "grep" && limit !== null && seen >= limit) return;
    if (name === "find") {
      const text = line.replace(/\r$/, "").trim();
      if (text) lines.push(shownPath(text, target));
      return;
    }
    let event: { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
    try { event = JSON.parse(line); } catch { return; }
    if (event.type !== "match") return;
    const data = event.data;
    if (typeof data?.path?.text !== "string" || typeof data.line_number !== "number") return;
    if (typeof data.lines?.text !== "string") return;   // binary hit: no text line to show
    matches.push({ filePath: data.path.text, lineNumber: data.line_number,
      text: data.lines.text.replace(/\r\n/g, "\n").replace(/\r/g, "").replace(/\n$/, "") });
    seen++;
    if (limit !== null && seen >= limit) { killedForLimit = true; if (!walker.killed) walker.kill(); }
  });
  try { await done; } finally { reader.close(); }
  if (name === "find") {
    if (lines.length === 0) return "No files found matching pattern";
    return lines.join("\n") + (killedForLimit && limit !== null ? `\n\n[${limit} results limit reached]` : "");
  }
  if (matches.length === 0) return "No matches found";
  const shown = (filePath: string): string => {
    const rel = relative(target, filePath);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : basename(filePath);
  };
  const fileCache = new Map<string, string[]>();
  const fileLines = (filePath: string): string[] => {
    let cached = fileCache.get(filePath);
    if (cached === undefined) {
      try { cached = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n"); }
      catch { cached = []; }
      fileCache.set(filePath, cached);
    }
    return cached;
  };
  for (const match of matches) {
    progress?.();
    const name = shown(match.filePath);
    if (context === 0) { lines.push(`${name}:${match.lineNumber}: ${match.text}`); continue; }
    const around = fileLines(match.filePath);
    if (around.length === 0) { lines.push(`${name}:${match.lineNumber}: (unable to read file)`); continue; }
    const start = Math.max(1, match.lineNumber - context);
    const end = Math.min(around.length, match.lineNumber + context);
    for (let current = start; current <= end; current++)
      lines.push(`${name}${current === match.lineNumber ? ":" : "-"}${current}${current === match.lineNumber ? ":" : "-"} ${(around[current - 1] ?? "").replace(/\r/g, "")}`);
  }
  return lines.join("\n") + (killedForLimit && limit !== null ? `\n\n[${limit} matches limit reached]` : "");
}

const SCRIPT = `
const controller=new AbortController();
process.stdin.resume();
process.stdin.once('end',()=>controller.abort());
const input=JSON.parse(process.argv[3]);
const emit=o=>{try{process.stdout.write(JSON.stringify(o)+'\\n');}catch{}};
// Liveness is a thread of its own: loading the engine bundle is one
// synchronous require on this thread and a long copy read can also hold it;
// neither must silence the proof that the process is alive. A process that
// is stopped or dead stops the thread too -- silence still means stall.
const beater=new (await import('node:worker_threads')).Worker(\`import{writeSync}from'node:fs';import{workerData}from'node:worker_threads';setInterval(()=>{try{writeSync(1,'{"p":"s"}'+String.fromCharCode(10))}catch{}},workerData.iv);\`,{eval:true,workerData:{iv:Math.max(50,Number(input.heartbeat)||50)}});
// A dead beater means heartbeats stop -- the parent's silence and progress
// windows still own the verdict. An unhandled 'error' event would instead
// make one worker failure the child's own.
beater.on('error',()=>{});
let output='';
try {
  const run=await import(process.argv[1]);
  // The engine import and the tool execute live at this eval boundary: the
  // child chdirs into the private copy, reparents the scratch HOME there,
  // arms the abort path that removes the copy and puts the group down, and
  // only then runs the pinned engine's walker over the frozen snapshot.
  let lastR=0;
  const rprogress=()=>{const now=Date.now();if(now-lastR>=100){lastR=now;emit({p:'r'});}};
  output=await run.searchChildBody(input,controller.signal,emit,async(cwd,target)=>{
    process.chdir(cwd);
    const fs=await import('node:fs');
    const pathmod=await import('node:path');
    const home=pathmod.dirname(cwd);
    const end=()=>{try{fs.rmSync(home,{recursive:true,force:true})}finally{process.kill(-process.pid,'SIGKILL')}};
    controller.signal.addEventListener('abort',end,{once:true});
    if(controller.signal.aborted)end();
    process.env.HOME=home;process.env.XDG_CONFIG_HOME=home;process.env.PI_CODING_AGENT_DIR=home;
    const engine=await import(process.argv[2]);
    if(controller.signal.aborted)return JSON.stringify({error:'search aborted'});
    const tool=input.name==='grep'?engine.createGrepToolDefinition(cwd):engine.createFindToolDefinition(cwd);
    try {
      // The engine's own pass reports nothing yet; the onUpdate channel is
      // passed so a tool that gains one reports real progress ({p:"w"}).
      const result=await tool.execute('search',{...input.params,path:target},controller.signal,()=>emit({p:'w'}),{cwd});
      return await run.finishSearchResult(input,result,target,controller.signal,rprogress);
    } catch(error) {
      // A descriptor overrun inside the engine's own walk reports the same
      // explicit refusal the snapshot boundary uses -- the walk runs inside
      // the snapshot's lifetime, so the same wording classifies it.
      return JSON.stringify({error:error instanceof run.WorkspaceRefusal?error.message:run.isDescriptorOverrun(error)?'search snapshot ran out of file descriptors':'contained search failed; no workspace result was returned'});
    }
  });
} catch(error) {
  output=JSON.stringify({error:'contained search failed; no workspace result was returned'});
}
finally {
  // The beater is silenced before the result line so a heartbeat can never
  // interleave inside a multi-chunk result write. Then the whole owned group
  // is killed -- the copy is already removed; no reused child PID is aimed at.
  try{await beater.terminate();}catch{}
  process.stdout.end(output,()=>process.kill(-process.pid,'SIGKILL'));
}
`;
/** Where a spilled answer is written, when the caller's surface may write:
 * the workspace root plus the same serialized contained
 * writer every workspace write takes -- so a spilled result is
 * admitted and owned exactly like a file the model wrote itself. */
export interface ContainedSearchSpool {
  readonly workspace: string;
  readonly write: (path: string, content: string) => Promise<void>;
}

export function searchWorkspace<N extends "grep" | "find">(name: N, root: string, params: object,
  signal?: AbortSignal, stallMs: number = SEARCH_STALL_MS,
  spool?: ContainedSearchSpool): Promise<SearchResult<N>> {
  if (signal?.aborted) return Promise.reject(new WorkspaceRefusal("search aborted"));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", SCRIPT,
      SELF, import.meta.resolve("@earendil-works/pi-coding-agent"),
      JSON.stringify({ name, root, params: params as Record<string, unknown>,
        heartbeat: Math.max(50, Math.floor(stallMs / 6)) } satisfies ContainedSearchInput)], {
      cwd: root, detached: true, stdio: ["pipe", "pipe", "ignore"],
      env: { PATH: `${join(getAgentDir(), "bin")}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
        HOME: "/nonexistent", XDG_CONFIG_HOME: "/nonexistent", PI_CODING_AGENT_DIR: "/nonexistent", PI_OFFLINE: "1", TMPDIR: tmpdir() },
    });
    const chunks: Buffer[] = [];
    let rest = Buffer.alloc(0);
    let failure: Error | null = null;
    let snapshot: string | null = null;
    let killer: NodeJS.Timeout | undefined;
    const heartbeatOnly = stallMs * HEARTBEAT_ONLY_WINDOWS;
    const stop = (message: string): void => {
      failure ??= new WorkspaceRefusal(message);
      clearTimeout(timer); clearTimeout(progressTimer);
      // Closing the pipe also happens when this process is SIGKILLed. The
      // child, not a parent finally block, owns snapshot and group cleanup --
      // except a child that cannot run its own cleanup: after a grace window
      // the whole group is killed and the copy it announced is swept here,
      // so a wedged search still leaves nothing of the workspace behind.
      try { child.stdin.end(); } catch { /* the lifetime pipe is already gone */ }
      if (killer === undefined) killer = setTimeout(() => {
        killer = undefined;
        try { process.kill(-child.pid!, "SIGKILL"); } catch { /* the group is already gone */ }
        if (snapshot !== null)
          try { rmSync(join(tmpdir(), snapshot), { recursive: true, force: true }); } catch { /* best effort */ }
      }, KILL_GRACE_MS);
    };
    const quiet = (): void => stop(`contained search produced no output for ${stallMs} ms`);
    const still = (): void => stop(`contained search produced only heartbeats for ${heartbeatOnly} ms`);
    let timer = setTimeout(quiet, stallMs);
    let progressTimer = setTimeout(still, heartbeatOnly);
    child.stdin.on("error", () => { /* exit can close the lifetime pipe first */ });
    const abort = (): void => stop("search aborted");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      // Any byte is life: the silence window starts over, and a dead or
      // stopped child is always reclaimed inside it.
      clearTimeout(timer); timer = setTimeout(quiet, stallMs);
      rest = Buffer.concat([rest, chunk]);
      // Progress is what the worker heartbeat cannot write: a frame other
      // than {p:"s"}, a line past the frame bound or one that fails frame
      // parsing (the answer writing itself out), and a tail already past
      // that bound still accumulating.
      let real = rest.length > 1024;
      for (let at = rest.indexOf(0x0a); at >= 0; at = rest.indexOf(0x0a)) {
        const line = rest.subarray(0, at); rest = rest.subarray(at + 1);
        if (line.length > 1024) { real = true; continue; }
        let frame: { p?: unknown; s?: unknown };
        try { frame = JSON.parse(line.toString("utf8")) as { p?: unknown; s?: unknown }; }
        catch { real = true; continue; /* the last line is the answer, not a control frame */ }
        if (frame?.p === "s") continue;
        real = true;
        if (frame?.p === "d" && typeof frame.s === "string" && /^oma-search-[^/\\\0]+$/.test(frame.s)) snapshot = frame.s;
      }
      if (real) { clearTimeout(progressTimer); progressTimer = setTimeout(still, heartbeatOnly); }
    });
    child.on("error", () => { failure ??= new WorkspaceRefusal("search process could not start"); });
    child.on("close", () => {
      clearTimeout(timer); clearTimeout(progressTimer);
      signal?.removeEventListener("abort", abort);
      if (killer !== undefined) clearTimeout(killer);
      // A child that could not run its own cleanup (SIGKILL, OOM) left the
      // copy it announced; the name was declared up front so this sweep is
      // idempotent on every close -- a normal exit already removed it, and
      // a stop() that armed the killer is covered here too if it lands
      // first.
      if (snapshot !== null)
        try { rmSync(join(tmpdir(), snapshot), { recursive: true, force: true }); } catch { /* best effort */ }
      if (failure) { reject(failure); return; }
      (async () => {
        try {
          const text = Buffer.concat(chunks).toString("utf8");
          const answer = JSON.parse(text.trimEnd().split("\n").at(-1) ?? "") as
            { result?: SearchResult<N>; complete?: unknown; error?: string };
          if (typeof answer.error === "string") { reject(new WorkspaceRefusal(answer.error)); return; }
          if (!answer.result) throw new Error("missing search result");
          if (typeof answer.complete === "string") await spillComplete(answer.result, answer.complete);
          resolve(answer.result);
        } catch { reject(new WorkspaceRefusal("contained search failed; no workspace result was returned")); }
      })();
    });
    /** A complete answer too large for one result is written whole into the
     * workspace spool through the contained writer -- the same containment
     * and serialization as any authored write -- and the result
     * names the admitted path (`details.complete`). When the spool cannot
     * take it -- a read-only surface wires none, or the filesystem cannot hold
     * it -- the answer is not truncated instead: it rides inline in full
     * with the notice that says why it is not at a path. */
    const spillComplete = async (result: SearchResult<N>, complete: string): Promise<void> => {
      const resultRecord = result as { content?: { type: string; text?: string }[]; details?: Record<string, unknown> };
      const details = (resultRecord.details ?? {}) as Record<string, unknown>;
      const bytes = Buffer.byteLength(complete, "utf8");
      if (spool !== undefined) {
        const file = join(spool.workspace, SEARCH_SPOOL_DIR, `oma-search-result-${randomUUID()}.txt`);
        try {
          await spool.write(file, complete);
          const whole = Buffer.from(complete, "utf8");
          let cut = Math.min(whole.length, SEARCH_PREVIEW_BYTES);
          while (cut > 0 && (whole[cut]! & 0xc0) === 0x80) cut--;
          resultRecord.content = [{ type: "text",
            text: `${whole.subarray(0, cut).toString("utf8")}\n\noma: [preview] the complete ${bytes}-byte result is at ${file}` }];
          details.complete = { path: file, bytes };
          resultRecord.details = details;
          return;
        } catch (error) {
          resultRecord.content = [{ type: "text",
            text: `${complete}\n\noma: the complete ${bytes}-byte result could not be written to the workspace spool (${error instanceof Error ? error.message : String(error)}); it is returned above in full` }];
          resultRecord.details = details;
          return;
        }
      }
      resultRecord.content = [{ type: "text",
        text: `${complete}\n\noma: the complete ${bytes}-byte result has no workspace spool on this surface; it is returned above in full` }];
      resultRecord.details = details;
    };
  });
}
