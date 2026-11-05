/** Closed private setup views. Paths are supplied by trusted OS composition;
 * validating their spelling grants no authority, pin or scope lifetime. */
import { StoreError } from "@oma/domain/errors";
import { trustedAbsolutePath } from "./run-lease.js";

export interface CandidateExecutionView {
  readonly git: string; readonly project: string; readonly workspace: string;
}
export interface PipelineExecutionView {
  readonly temporary: string; readonly npm: string; readonly downloads?: string;
}
export interface QuarantineExecutionView {
  readonly git: string; readonly project: string; readonly root: string; readonly bundle: string; readonly temporary: string;
}
function fields(value: unknown, keys: readonly string[]): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse();
  const row = Object.fromEntries(Object.entries(value));
  if (Object.keys(row).sort().join() !== [...keys].sort().join() || keys.some(key =>
    !trustedAbsolutePath(row[key]) || Buffer.from(row[key] as string).toString("utf8") !== row[key])) refuse();
  return row as Readonly<Record<string, string>>;
}
const under = (value: string, root: string): boolean => {
  const name = value.replace(/\/$/, ""), parent = root.replace(/\/$/, "");
  return name === parent || name.startsWith(`${parent}/`);
};
function separate(left: string, right: string): void { if (under(left, right) || under(right, left)) refuse(); }
function refuse(): never { throw new StoreError("INVALID_REQUEST", "Git execution view differs from its closed path grammar"); }
export function decodePipelineExecutionView(value: unknown): PipelineExecutionView {
  const downloads = !!value && typeof value === "object" && Object.hasOwn(value, "downloads");
  const row = fields(value, downloads ? ["temporary", "npm", "downloads"] : ["temporary", "npm"]);
  if (!row.npm!.endsWith("/package.json")) refuse();
  separate(row.temporary!, row.npm!);
  // Linux places a read-only download mount inside its private tmpfs. The
  // mutable npm cache still has to be separate from those verified inputs.
  if (downloads) { separate(row.temporary!.replace(/\/$/, "") + "/oma-npm-cache", row.downloads!); separate(row.npm!, row.downloads!); }
  return Object.freeze({ temporary: row.temporary!, npm: row.npm!, ...(downloads ? { downloads: row.downloads! } : {}) });
}
export function decodeCandidateExecutionView(value: unknown): CandidateExecutionView {
  const row = fields(value, ["git", "project", "workspace"]);
  separate(row.project!, row.workspace!);
  return Object.freeze({ git: row.git!, project: row.project!, workspace: row.workspace! });
}
export function decodeQuarantineExecutionView(value: unknown): QuarantineExecutionView {
  const row = fields(value, ["git", "project", "root", "bundle", "temporary"]);
  separate(row.project!, row.root!); separate(row.project!, row.temporary!);
  if (under(row.bundle!, row.project!) || under(row.bundle!, row.temporary!)) refuse();
  return Object.freeze({ git: row.git!, project: row.project!, root: row.root!, bundle: row.bundle!, temporary: row.temporary! });
}
