/** PR-004/P0-4: one child owns the private copy and every walker it starts.
 * EOF on its parent pipe aborts the work and removes the copy before exit. */
import { spawn } from "node:child_process";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { WorkspaceRefusal } from "./contained-files.js";
import type { createGrepToolDefinition, createFindToolDefinition } from "@earendil-works/pi-coding-agent";
type SearchResult<N extends "grep" | "find"> = Awaited<ReturnType<ReturnType<N extends "grep" ? typeof createGrepToolDefinition : typeof createFindToolDefinition>["execute"]>>;

const SEARCH_RESULT_BYTES = 1024 * 1024;
const SEARCH_DEADLINE_MS = 60_000;
const SCRIPT = `
const controller=new AbortController();
process.stdin.resume();
process.stdin.once('end',()=>controller.abort());
const input=JSON.parse(process.argv[3]);
const timer=setTimeout(()=>controller.abort(),input.deadline);
let output=''; let Refusal;
try {
  const module=await import(process.argv[1]);
  const {withSearchSnapshot}=module; Refusal=module.WorkspaceRefusal;
  output=await withSearchSnapshot(input.root,input.params.path??'.',input.maximum,controller.signal,async(cwd,target)=>{
    process.chdir(cwd);
    const home=(await import('node:path')).dirname(cwd);
    const {rmSync}=await import('node:fs');
    const end=()=>{try{rmSync(home,{recursive:true,force:true});}finally{process.kill(-process.pid,'SIGKILL');}};
    controller.signal.addEventListener('abort',end,{once:true});
    if(controller.signal.aborted) end();
    process.env.HOME=home; process.env.XDG_CONFIG_HOME=home; process.env.PI_CODING_AGENT_DIR=home;
    const {createGrepToolDefinition,createFindToolDefinition}=await import(process.argv[2]);
    if(controller.signal.aborted) throw new Error('aborted');
    const tool=input.name==='grep'?createGrepToolDefinition(cwd):createFindToolDefinition(cwd);
    const result=await tool.execute('search',{...input.params,path:target},controller.signal,undefined,{cwd});
    return JSON.stringify({result});
  });
} catch(error) {
  output=JSON.stringify({error:Refusal&&error instanceof Refusal?error.message:'contained search failed; no workspace result was returned'});
}
finally {
  clearTimeout(timer);
  // The copy is already removed. Kill the whole owned group, including any
  // walker left behind by an engine error; no reused child PID is targeted.
  process.stdout.end(output,()=>process.kill(-process.pid,'SIGKILL'));
}
`;
export function searchWorkspace<N extends "grep" | "find">(name: N, root: string, params: object,
  maximum: number | null, signal?: AbortSignal): Promise<SearchResult<N>> {
  if (signal?.aborted) return Promise.reject(new WorkspaceRefusal("search aborted"));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", SCRIPT,
      new URL("./contained-files.js", import.meta.url).href, import.meta.resolve("@earendil-works/pi-coding-agent"),
      JSON.stringify({ name, root, params, maximum, deadline: SEARCH_DEADLINE_MS })], {
      cwd: root, detached: true, stdio: ["pipe", "pipe", "ignore"],
      env: { PATH: `${join(getAgentDir(), "bin")}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
        HOME: "/nonexistent", XDG_CONFIG_HOME: "/nonexistent", PI_CODING_AGENT_DIR: "/nonexistent", PI_OFFLINE: "1", TMPDIR: tmpdir() },
    });
    const chunks: Buffer[] = []; let bytes = 0; let failure: Error | null = null;
    const stop = (message: string): void => {
      failure ??= new WorkspaceRefusal(message);
      // Closing the pipe also happens when this process is SIGKILLed. The
      // child, not a parent finally block, owns snapshot and group cleanup.
      child.stdin.end();
    };
    child.stdin.on("error", () => { /* exit can close the lifetime pipe first */ });
    const abort = (): void => stop("search aborted");
    const timer = setTimeout(() => stop("search deadline exceeded"), SEARCH_DEADLINE_MS);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > SEARCH_RESULT_BYTES) stop("search result exceeds output budget");
      else chunks.push(chunk);
    });
    child.on("error", () => { failure ??= new WorkspaceRefusal("search process could not start"); });
    child.on("close", () => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (failure) { reject(failure); return; }
      try {
        const answer = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { result?: SearchResult<N>; error?: string };
        if (typeof answer.error === "string") { reject(new WorkspaceRefusal(answer.error)); return; }
        if (!answer.result) throw new Error("missing search result");
        resolve(answer.result);
      } catch { reject(new WorkspaceRefusal("contained search failed; no workspace result was returned")); }
    });
  });
}
