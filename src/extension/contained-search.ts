/** PR-004/P0-4: one child owns the private copy and every walker it starts.
 * EOF on its parent pipe aborts the work and removes the copy before exit.
 *
 * P0: a search is never refused for size or elapsed time. The child emits one
 * JSON frame per line -- `{p:"d",s}` naming the private copy the moment it
 * exists, `{p:"c"}` pings while it copies, `{p:"s"}` heartbeats while the
 * engine's walker runs -- and one final `{result}`/`{error}` line. Every byte
 * the child emits resets the parent's stall window, so a slow-but-progressing
 * search finishes; only a child that can no longer produce output is put
 * down (by group kill after a grace), and the copy it announced is swept
 * here too.
 *
 * The upstream tools' own rendering is still truncated at 50 KiB and 500-char
 * lines, and at 100/1000 results when the caller did not ask for a bound --
 * those are renderer caps, not a refusal, so they are converted: when the
 * tool reports a bound the caller did not choose, the same pinned walker
 * runs again over the same frozen snapshot for the complete rendering. A
 * complete answer that fits is returned inline; a larger one is written to a
 * named file and the result names the path -- a preview, never a truncation. */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { basename, delimiter, isAbsolute, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { WorkspaceRefusal, withSearchSnapshot } from "./contained-files.js";
import type { createGrepToolDefinition, createFindToolDefinition } from "@earendil-works/pi-coding-agent";
export { WorkspaceRefusal } from "./contained-files.js";
type SearchResult<N extends "grep" | "find"> = Awaited<ReturnType<ReturnType<N extends "grep" ? typeof createGrepToolDefinition : typeof createFindToolDefinition>["execute"]>>;

/** The observation window one chunk of child output buys. A child that is
 * alive and working emits progress or heartbeats well inside it; a child that
 * is dead, stopped or wedged in an uninterruptible call emits nothing and is
 * reclaimed. This is a stall detector, not a deadline. */
const SEARCH_STALL_MS = 60_000;
/** Grace between the parent's pipe close (which lets a live child clean up
 * after itself) and the group kill that a dead child cannot run. */
const KILL_GRACE_MS = 2_000;
/** The most answer text one tool result carries inline. A longer answer is
 * written whole to a named file and the result names it -- the same complete
 * data, one `cat` away instead of an error away. The value matches the former
 * inline boundary so what fit before still fits. */
const SEARCH_PREVIEW_BYTES = 1024 * 1024;
const SELF = import.meta.url;

export interface ContainedSearchInput {
  readonly name: "grep" | "find";
  readonly root: string;
  readonly params: Record<string, unknown>;
  readonly maximum: number | null;
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
    const named = (name: string): void => emit({ p: "d", s: name });
    return await withSearchSnapshot(input.root,
      (input.params.path ?? ".") as string, input.maximum, signal,
      walk, progress, named);
  } catch (error) {
    return JSON.stringify({ error: error instanceof WorkspaceRefusal ? error.message
      : "contained search failed; no workspace result was returned" });
  }
}

/** The post-walk half of the child's body: the upstream tool's result is in
 * hand, rendered under its own fixed caps. A bound the caller did not choose
 * -- the 50 KiB render cap, the 500-character line cap, or the default
 * match/result count -- is converted, not reported: the same pinned walker
 * runs again over the same frozen snapshot for the complete rendering, and
 * only the caller's own `limit` may bound it. A complete answer that fits
 * returns inline; a larger one is written whole to a named file and the
 * result names it -- a preview, never a truncation. */
export async function finishSearchResult(input: ContainedSearchInput,
    result: SearchResult<"grep" | "find">, target: string, signal?: AbortSignal): Promise<string> {
  const resultRecord = result as { content?: { type: string; text?: string }[]; details?: Record<string, unknown> };
  const details = (resultRecord.details ?? {}) as Record<string, unknown>;
  const callerLimit = typeof input.params.limit === "number" && Number.isFinite(input.params.limit);
  const truncation = details.truncation as { truncated?: boolean } | undefined;
  const hidden = truncation?.truncated === true || details.linesTruncated === true ||
    (!callerLimit && (details.matchLimitReached !== undefined || details.resultLimitReached !== undefined));
  if (hidden) {
    let complete: string;
    try {
      complete = await completeSearchText(input.name, input.params, target, signal);
    } catch (error) {
      // The tool's own answer stays, its truncation notices included,
      // and the marker says the completion pass failed -- never a
      // silently cut answer.
      complete = `${resultRecord.content?.[0]?.text ?? ""}\n\noma: the complete result could not be produced (${error instanceof Error ? error.message : String(error)})`;
    }
    const bytes = Buffer.byteLength(complete, "utf8");
    if (bytes <= SEARCH_PREVIEW_BYTES) {
      resultRecord.content = [{ type: "text", text: complete }];
    } else {
      const file = join(tmpdir(), `oma-search-result-${randomUUID()}.txt`);
      writeFileSync(file, complete, { mode: 0o600 });
      const whole = Buffer.from(complete, "utf8");
      let cut = Math.min(whole.length, SEARCH_PREVIEW_BYTES);
      while (cut > 0 && (whole[cut]! & 0xc0) === 0x80) cut--;
      resultRecord.content = [{ type: "text",
        text: `${whole.subarray(0, cut).toString("utf8")}\n\noma: [preview] the complete ${bytes}-byte result is at ${file}` }];
      details.complete = { path: file, bytes };
    }
    resultRecord.details = details;
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

/** The complete rendering the pinned walker produces over the frozen
 * snapshot: same arguments and same line format the engine's tool uses, with
 * the renderer's fixed 50 KiB / 500-character caps and (unless the caller
 * asked) its result-count caps removed. The caller's own `limit` still
 * applies -- it is part of the request, not a hidden bound. */
export async function completeSearchText(name: "grep" | "find", params: Record<string, unknown>,
    target: string, signal?: AbortSignal): Promise<string> {
  // The same `Math.max(1, limit)` reading the upstream tool gives it; absent
  // means none, and only absent lets the hidden default be lifted.
  const limit = typeof params.limit === "number" && Number.isFinite(params.limit)
    ? Math.max(1, Math.floor(params.limit)) : null;
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
  const walker = spawn(name === "grep" ? "rg" : "fd", args, { stdio: ["ignore", "pipe", "pipe"] });
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
    const stop = (): void => { if (!walker.killed) walker.kill(); };
    signal?.addEventListener("abort", stop, { once: true });
    walker.on("error", reject);
    walker.on("close", code => {
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) { reject(new WorkspaceRefusal("search aborted")); return; }
      if (!killedForLimit && code !== 0 && code !== 1 && lines.length === 0 && matches.length === 0)
        { reject(new Error(stderr.trim() || `${name === "grep" ? "ripgrep" : "fd"} exited with code ${code}`)); return; }
      resolve();
    });
  });
  reader.on("line", line => {
    if (!line) return;
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
let output='';
try {
  const run=await import(process.argv[1]);
  // The engine import and the tool execute live at this eval boundary: the
  // child chdirs into the private copy, reparents the scratch HOME there,
  // arms the abort path that removes the copy and puts the group down, and
  // only then runs the pinned engine's walker over the frozen snapshot.
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
      const result=await tool.execute('search',{...input.params,path:target},controller.signal,undefined,{cwd});
      return await run.finishSearchResult(input,result,target,controller.signal);
    } catch(error) {
      return JSON.stringify({error:error instanceof run.WorkspaceRefusal?error.message:'contained search failed; no workspace result was returned'});
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
export function searchWorkspace<N extends "grep" | "find">(name: N, root: string, params: object,
  maximum: number | null, signal?: AbortSignal, stallMs: number = SEARCH_STALL_MS): Promise<SearchResult<N>> {
  if (signal?.aborted) return Promise.reject(new WorkspaceRefusal("search aborted"));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", SCRIPT,
      SELF, import.meta.resolve("@earendil-works/pi-coding-agent"),
      JSON.stringify({ name, root, params: params as Record<string, unknown>, maximum,
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
    const stop = (message: string): void => {
      failure ??= new WorkspaceRefusal(message);
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
    let timer = setTimeout(quiet, stallMs);
    child.stdin.on("error", () => { /* exit can close the lifetime pipe first */ });
    const abort = (): void => stop("search aborted");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      // Every emitted byte is progress: the window starts over, and a
      // multi-second answer writing itself out is never mistaken for a stall.
      clearTimeout(timer); timer = setTimeout(quiet, stallMs);
      rest = Buffer.concat([rest, chunk]);
      for (let at = rest.indexOf(0x0a); at >= 0; at = rest.indexOf(0x0a)) {
        const line = rest.subarray(0, at); rest = rest.subarray(at + 1);
        if (line.length > 1024) continue;
        try {
          const frame = JSON.parse(line.toString("utf8")) as { p?: unknown; s?: unknown };
          if (frame?.p === "d" && typeof frame.s === "string" && /^oma-search-[^/\\\0]+$/.test(frame.s)) snapshot = frame.s;
        } catch { /* the last line is the answer, not a control frame */ }
      }
    });
    child.on("error", () => { failure ??= new WorkspaceRefusal("search process could not start"); });
    child.on("close", () => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (killer !== undefined) clearTimeout(killer);
      if (failure) { reject(failure); return; }
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        const answer = JSON.parse(text.trimEnd().split("\n").at(-1) ?? "") as { result?: SearchResult<N>; error?: string };
        if (typeof answer.error === "string") { reject(new WorkspaceRefusal(answer.error)); return; }
        if (!answer.result) throw new Error("missing search result");
        resolve(answer.result);
      } catch { reject(new WorkspaceRefusal("contained search failed; no workspace result was returned")); }
    });
  });
}
