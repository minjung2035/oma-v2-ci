import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { FULL_OID_RE } from "../ids.js";
import { runGitText } from "../process/policies.js";
import { fail } from "./exit.js";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readBody(path: string | null): string {
  if (path === null) return "";
  if (!existsSync(path)) fail(`file not found: ${path}`, 2);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
      .decode(readFileSync(path))
      .replace(/\r\n/g, "\n");
  } catch {
    return fail(`cannot read UTF-8 text file: ${path}`, 2);
  }
}

export function resolveOid(revision: string): string {
  if (FULL_OID_RE.test(revision)) return revision;
  const result = runGitText(["rev-parse", "--verify", `${revision}^{commit}`], { cwd: process.cwd() });
  const oid = result.stdout.trim();
  if (result.status !== 0 || !FULL_OID_RE.test(oid)) fail(`cannot resolve ${revision} to a commit`, 2);
  return oid;
}
