/** `host-record.json` (macos-platform §2.3): the host's own facts about this
 * Mac's engine -- which installation and VM instance it is, whether the disk
 * was ever provisioned (MAC-303), the images it runs, the newest state schema
 * ever written (MAC-611), and how the last stop ended (MAC-320). It is written
 * whole and published by rename, so a reader sees one version or the next. */
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { StoreError } from "@oma/domain/errors";
import { isUuid } from "@oma/protocol/host-guest";
import { replaceFile } from "./files.js";
import { isValidSocietyName } from "@oma/domain/identifiers";

export const HOST_RECORD_KIND = "oma-host-record-v1";

export interface ProjectRecord {
  readonly projectId: string;
  readonly displayName: string;
  readonly bookmark: string;
  readonly gitCommonDir: string;
  readonly objectFormat: "sha1" | "sha256";
  readonly rootCommits: readonly string[];
  readonly society: string;
  readonly lastImport?: { readonly head: string; readonly at: number };
  readonly lastExport?: { readonly head: string; readonly at: number };
}

function projectRecord(value: unknown): value is ProjectRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as ProjectRecord;
  const oid = new RegExp(`^[0-9a-f]{${p.objectFormat === "sha256" ? 64 : 40}}$`);
  const transfer = (t: ProjectRecord["lastImport"]): boolean => t === undefined ||
    (!!t && oid.test(t.head) && Number.isSafeInteger(t.at) && t.at >= 0);
  return isUuid(p.projectId) && typeof p.displayName === "string" && p.displayName.length > 0 && p.displayName.length <= 200 &&
    typeof p.bookmark === "string" && p.bookmark.length > 0 && p.bookmark.length <= 1024 * 1024 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p.bookmark) &&
    typeof p.gitCommonDir === "string" && p.gitCommonDir.startsWith("/") && !p.gitCommonDir.includes("\0") &&
    (p.objectFormat === "sha1" || p.objectFormat === "sha256") && Array.isArray(p.rootCommits) &&
    p.rootCommits.length > 0 && p.rootCommits.every(root => typeof root === "string" && oid.test(root)) &&
    new Set(p.rootCommits).size === p.rootCommits.length && isValidSocietyName(p.society) && transfer(p.lastImport) && transfer(p.lastExport);
}

export interface HostRecord {
  readonly kind: typeof HOST_RECORD_KIND;
  readonly installationId: string;
  readonly instanceId: string;
  /** MAC-303: "pending" until the first boot finished making the disk. */
  readonly provisioning: "pending" | "done";
  readonly image: { readonly current: string | null; readonly previous: string | null };
  /** MAC-611: the newest state schema any image wrote to this disk. */
  readonly highestSchemaWritten: number | null;
  /** MAC-320: how the last stop ended, for the one line the next start shows. */
  readonly lastStop: "clean" | "forced" | "crashed" | "failed" | null;
  readonly projects: readonly ProjectRecord[];
}

export function newHostRecord(): HostRecord {
  return { kind: HOST_RECORD_KIND, installationId: randomUUID(), instanceId: randomUUID(), provisioning: "pending",
    image: { current: null, previous: null }, highestSchemaWritten: null, lastStop: null, projects: [] };
}

const nullableVersion = (value: unknown): value is string | null => value === null || (typeof value === "string" && value.length > 0 && value.length <= 64);

/** The record, or null when there is none yet. A record that exists and does
 * not parse is not replaced by a new one: the instance it names is the disk's. */
export function readHostRecord(path: string): HostRecord | null {
  let text: string;
  try { text = readFileSync(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new StoreError("BROKER_UNAVAILABLE", "the app's record cannot be read");
  }
  let value: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a record");
    value = parsed as Record<string, unknown>;
  } catch { throw new StoreError("STORE_CORRUPT", "the app's record is damaged"); }
  const image = value.image as Record<string, unknown> | undefined;
  if (value.kind !== HOST_RECORD_KIND || !isUuid(value.installationId) || !isUuid(value.instanceId) ||
      (value.provisioning !== "pending" && value.provisioning !== "done") ||
      typeof image !== "object" || image === null || !nullableVersion(image.current) || !nullableVersion(image.previous) ||
      !(value.highestSchemaWritten === null || (Number.isSafeInteger(value.highestSchemaWritten) && (value.highestSchemaWritten as number) >= 0)) ||
      ![null, "clean", "forced", "crashed", "failed"].includes(value.lastStop as string | null))
    throw new StoreError("STORE_CORRUPT", "the app's record is damaged");
  // Older records contain no bindings. Never infer a binding from a guest path.
  const projects = value.projects === undefined ? [] : value.projects;
  if (!Array.isArray(projects) || !projects.every(projectRecord) ||
      new Set(projects.map(p => p.projectId)).size !== projects.length || new Set(projects.map(p => p.society)).size !== projects.length)
    throw new StoreError("STORE_CORRUPT", "the app's project records are damaged");
  return { ...value, projects } as unknown as HostRecord;
}

/** Rewritten whole through the host's one publication owner (files.ts). */
export function writeHostRecord(path: string, record: HostRecord): void {
  replaceFile(dirname(path), basename(path), `${JSON.stringify(record, null, 2)}\n`);
}
