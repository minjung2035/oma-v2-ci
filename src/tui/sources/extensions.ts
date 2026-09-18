/** TUI-010: role-by-role extension selection over host-placed files only.
 *
 * This is not an installer. The list is what the host already put under
 * installation.libdir; there is no arbitrary path entry, no network fetch and
 * no Pi auto-discovery. The core OMA extension is always first and cannot be
 * cleared. Selected files carry the SHA-256 that the runner re-checks before
 * start, so a file swapped after selection fails closed rather than loading.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { StoreError } from "../../domain/errors.js";
import { DEPLOYMENT_LAYOUT } from "../../domain/deployment.js";
import { replaceDerivedFile } from "../../storage/durable-fs.js";
import type { ExtensionRow } from "../model.js";

export const CORE_EXTENSION = DEPLOYMENT_LAYOUT.extension;

export interface RoleFile {
  readonly name: string;
  readonly path: string;
  readonly extensions: readonly string[];
  /** Every other field of the authored role file, preserved verbatim. Toggling
   * an extension must not silently drop an optional block such as toolSurface.
   */
  readonly rest: Readonly<Record<string, unknown>>;
}

export interface ExtensionContext {
  readonly editable: boolean;
  readonly libdir: string;
  readonly principalRole: string | null;
  readonly workerRole: string | null;
  readonly roles: readonly RoleFile[];
  readonly rows: readonly ExtensionRow[];
  readonly reason: string | null;
}

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new StoreError("INVALID_REQUEST", `${path} must contain a JSON object`);
  return parsed as Record<string, unknown>;
}

/** Only files the host placed under libdir are candidates. A path that escapes
 * libdir, or is not a regular JS/TS file, is not offered at all.
 */
function scanLibdir(libdir: string): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string, depth: number): void => {
    if (depth > 3) return;
    let entries: readonly string[];
    try { entries = readdirSync(directory); } catch { return; }
    for (const entry of entries) {
      const full = join(directory, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) { walk(full, depth + 1); continue; }
      if (!stat.isFile() || !/\.(?:js|mjs|ts)$/.test(entry)) continue;
      const rel = relative(libdir, full);
      if (rel.startsWith("..") || isAbsolute(rel)) continue;
      found.push(rel);
    }
  };
  walk(join(libdir, "extensions"), 0);
  return found.sort();
}

export function digestOf(libdir: string, entry: string): string | null {
  try { return createHash("sha256").update(readFileSync(join(libdir, entry))).digest("hex"); } catch { return null; }
}

function rowsOf(available: readonly string[], principal: RoleFile | null, worker: RoleFile | null): readonly ExtensionRow[] {
  return Object.freeze(available.map(id => Object.freeze({
    id,
    principal: principal ? principal.extensions.includes(id) : id === CORE_EXTENSION,
    workers: worker ? worker.extensions.includes(id) : id === CORE_EXTENSION,
    locked: id === CORE_EXTENSION,
  })));
}

const unmanaged = (reason: string): ExtensionContext => Object.freeze({
  editable: false, libdir: "", principalRole: null, workerRole: null, roles: Object.freeze([]),
  rows: Object.freeze([Object.freeze({ id: CORE_EXTENSION, principal: true, workers: true, locked: true })]),
  reason,
});

export function readExtensions(configPath: string, principalProfile: string, workerProfile: string): ExtensionContext {
  let location: string;
  let source: Record<string, unknown>;
  try { location = realpathSync(configPath); source = readJson(location); }
  catch { return unmanaged("설정을 읽을 수 없습니다"); }
  if (source.kind !== "oma-operations-v1")
    return unmanaged("인라인 config.json은 role별 extension을 갖지 않습니다");
  const root = dirname(location);
  const files = source.roles;
  if (files === null || typeof files !== "object" || Array.isArray(files))
    return unmanaged("roles 목록이 없습니다");
  let libdir: string;
  try {
    const host = readJson(join(root, String(source.host)));
    const installation = host.installation as Record<string, unknown> | undefined;
    const declared = installation?.libdir;
    if (typeof declared !== "string" || !isAbsolute(declared)) return unmanaged("installation.libdir이 절대 경로가 아닙니다");
    libdir = declared;
  } catch { return unmanaged("host 파일을 읽을 수 없습니다"); }
  const roles: RoleFile[] = [];
  for (const [name, file] of Object.entries(files as Record<string, unknown>)) {
    const path = join(root, String(file));
    let role: Record<string, unknown>;
    try { role = readJson(path); } catch { return unmanaged(`role 파일을 읽을 수 없습니다: ${name}`); }
    const entries = role.extensions;
    if (!Array.isArray(entries) || entries.some(entry => typeof entry !== "string"))
      return unmanaged(`role ${name}의 extensions 형식이 올바르지 않습니다`);
    const { extensions: _authored, ...rest } = role;
    roles.push(Object.freeze({ name, path,
      extensions: Object.freeze(entries as string[]), rest: Object.freeze(rest) }));
  }
  const principal = roles.find(role => role.name === principalProfile) ?? null;
  const worker = roles.find(role => role.name === workerProfile) ?? null;
  const referenced = new Set<string>([CORE_EXTENSION]);
  for (const role of roles) for (const entry of role.extensions) referenced.add(entry);
  for (const entry of scanLibdir(libdir)) referenced.add(entry);
  const available = [CORE_EXTENSION, ...[...referenced].filter(id => id !== CORE_EXTENSION).sort()];
  return Object.freeze({
    editable: principal !== null || worker !== null,
    libdir, principalRole: principal?.name ?? null, workerRole: worker?.name ?? null,
    roles: Object.freeze(roles), rows: rowsOf(available, principal, worker),
    reason: principal === null && worker === null ? "해당 role 파일이 없습니다" : null,
  });
}

/** The core extension stays index 0 and is never removed. Order is otherwise
 * the stable available order so the written list does not churn.
 */
export function nextEntries(current: readonly string[], available: readonly string[], id: string, enabled: boolean): readonly string[] {
  if (id === CORE_EXTENSION) return current;
  const wanted = new Set(current.filter(entry => entry !== CORE_EXTENSION));
  if (enabled) wanted.add(id); else wanted.delete(id);
  const ordered = available.filter(entry => entry !== CORE_EXTENSION && wanted.has(entry));
  return Object.freeze([CORE_EXTENSION, ...ordered]);
}

export function toggleExtension(context: ExtensionContext, id: string, role: "principal" | "workers", enabled: boolean): void {
  if (!context.editable) throw new StoreError("UNSUPPORTED_PROFILE", "이 설정 형식에서는 extension을 바꿀 수 없습니다");
  if (id === CORE_EXTENSION) return;
  const name = role === "principal" ? context.principalRole : context.workerRole;
  if (name === null) throw new StoreError("UNSUPPORTED_PROFILE", `대상 role 파일이 없습니다: ${role}`);
  const target = context.roles.find(entry => entry.name === name);
  if (!target) throw new StoreError("STORE_CORRUPT", "role file disappeared between read and write");
  if (enabled && digestOf(context.libdir, id) === null)
    throw new StoreError("INVALID_REQUEST", `extension 파일을 읽을 수 없습니다: ${id}`);
  const available = context.rows.map(row => row.id);
  const entries = nextEntries(target.extensions, available, id, enabled);
  if (entries.length > 16) throw new StoreError("LIMIT_EXCEEDED", "role당 extension은 최대 16개입니다");
  // Re-read immediately before writing so a field this screen does not model
  // cannot be lost to a stale in-memory copy.
  let current: Record<string, unknown>;
  try { current = readJson(target.path); }
  catch { throw new StoreError("STORE_CORRUPT", "role file became unreadable between read and write"); }
  const body = { ...current, extensions: entries };
  replaceDerivedFile(target.path, `${JSON.stringify(body, null, 2)}\n`, 0o600);
}
