/** Closed, transient installation data carried from Broker to trusted Runner.
 * It grants no execution authority, scope lifetime or exact-file binding. */
import { StoreError } from "@oma/domain/errors";
import { trustedAbsolutePath } from "./run-lease.js";
export interface MacDeveloperTools {
  readonly developer: string; readonly git: string; readonly execPath: string; readonly contents: string;
}
function refuse(): never { throw new StoreError("UNSUPPORTED_PROFILE", "Mac developer tools differ from their closed installation grammar"); }
function path(value: unknown): value is string {
  return trustedAbsolutePath(value) && !/[\r\n]/.test(value as string) && !(value as string).endsWith("/") &&
    Buffer.from(value as string).toString("utf8") === value;
}
export function macGitLocation(developer: string, git: string): string {
  if (![developer, git].every(path) || !git.startsWith(`${developer}/usr/bin/`)) refuse();
  if (developer === "/Library/Developer/CommandLineTools") return developer;
  if (/^\/.+\.app\/Contents\/Developer$/.test(developer)) return developer.slice(0, -"/Developer".length);
  return refuse();
}
export function describeMacDeveloperTools(developer: string, git: string, execPath: string): MacDeveloperTools {
  const contents = macGitLocation(developer, git);
  if (!path(execPath) || !execPath.startsWith(`${developer}/`)) refuse();
  return Object.freeze({ developer, git, execPath, contents });
}
export function decodeMacDeveloperTools(value: unknown): MacDeveloperTools {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse();
  const row = Object.fromEntries(Object.entries(value));
  if (Object.keys(row).sort().join() !== "contents,developer,execPath,git") refuse();
  const tools = describeMacDeveloperTools(row.developer as string, row.git as string, row.execPath as string);
  if (tools.contents !== row.contents) refuse();
  return tools;
}
export function encodeMacDeveloperTools(tools: MacDeveloperTools): string {
  return Buffer.from(JSON.stringify(decodeMacDeveloperTools(tools))).toString("hex");
}
export function decodeMacDeveloperToolsHex(value: unknown): MacDeveloperTools {
  // Four OS path observations, not a new model/queue resource budget.
  if (typeof value !== "string" || value.length > 64 * 1024 || !/^(?:[0-9a-f]{2})+$/.test(value)) refuse();
  const text = Buffer.from(value, "hex").toString("utf8");
  if (Buffer.from(text).toString("hex") !== value) refuse();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return refuse(); }
  return decodeMacDeveloperTools(parsed);
}
