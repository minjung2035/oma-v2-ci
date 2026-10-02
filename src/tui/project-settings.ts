/** DR24/DR25: a project's OMA settings, and bringing them to the installed
 * packages. One owner for both the Human's `oma pi` and the macOS engine's
 * application of the packages the Mac installed, so the two cannot differ. */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { StoreError } from "../domain/errors.js";
import { defaultHostConfig } from "../config/defaults.js";
import { isValidSocietyName } from "../domain/identifiers.js";
import { deploymentDigest } from "../runtime/deployment-manifest.js";
import { packageStoreDir, reconciledEntries, type InstalledPackage } from "../runtime/pi-packages.js";
import { residentRootfsPath } from "../runtime/provision.js";
import { ensureDirectory } from "../storage/directory.js";
import { errorWords } from "./words.js";
import { commitManagedEdit, commitRoleSet, projectBundle, projectSettingsPath, readSettingsForEditing, roleSetOf, writeSettings,
  type Settings } from "./sources/settings.js";

/** The project's settings, made once -- from its first society's
 * configuration, roles and all, or the product's defaults -- and kept a
 * managed bundle that names where the installed packages are, so each role's
 * extensions can be chosen and every session is made from it. */
export function ensureProjectSettings(dataRoot: string, project: string, libdir: string, session?: string): Settings {
  const path = projectSettingsPath(dataRoot, project);
  const packages = packageStoreDir(join(dataRoot, project));
  if (!existsSync(path)) {
    ensureDirectory(dirname(path), 0o700);
    const earlier = [join(dataRoot, project, "config.json"), session].find(file => file !== undefined && existsSync(file));
    const seed = earlier === undefined ? null : readSettingsForEditing(earlier);
    const config = seed?.config ?? defaultHostConfig({ society: project, node: process.execPath, libdir: `${libdir}/`,
      rootfs: residentRootfsPath(join(dataRoot, project)), deploymentDigest: deploymentDigest(libdir) });
    writeSettings(path, { ...config, society: project, installation: { ...config.installation, packages } });
    // A first society that chose its roles' extensions and prompts keeps them.
    if (seed?.snapshot && seed.layout.kind === "operations") {
      const created = readSettingsForEditing(path);
      commitRoleSet(created.snapshot!, created.config, roleSetOf(seed.snapshot));
    }
  }
  const settings = projectBundle(path);
  if (settings.config.installation.packages === packages) return settings;
  writeSettings(path, { ...settings.config, installation: { ...settings.config.installation, packages } });
  return readSettingsForEditing(path);
}

/** DR25: every project's roles, brought to the store after it changed from
 * `before` to `after`: a package a role used keeps being used, by the files
 * it has now, and one removed is dropped. What was added is turned on for
 * the Principal and the Workers of `project`, when one is named; other
 * projects list it, off. Returns what the Human is told. */
export function applyPackageChange(options: { readonly dataRoot: string; readonly project: string | null; readonly libdir: string;
  readonly before: readonly InstalledPackage[]; readonly after: readonly InstalledPackage[]; readonly activate?: string | undefined }): { readonly ok: boolean; readonly said: string[] } {
  const { dataRoot, project, libdir, before, after } = options;
  const said: string[] = [];
  let ok = true;
  let applied = false;
  let activatedRoles = "Principal and Workers";
  const added = after.filter(item => item.source === options.activate || !before.some(earlier => earlier.source === item.source));
  for (const item of added) if (item.entries.length === 0) said.push(`${item.source} has no extension oma can load (only extensions are loaded).`);
  let names: string[] = [];
  try { names = readdirSync(join(dataRoot, ".projects")).filter(name => isValidSocietyName(name)).sort(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { ok: false, said: [`Could not list project settings: ${errorWords(error)}`] };
    }
  }
  if (project !== null && added.some(item => item.entries.length > 0) && !names.includes(project)) {
    try { ensureProjectSettings(dataRoot, project, libdir); names = [...names, project].sort(); }
    catch (error) { ok = false; said.push(`Could not prepare this project's settings: ${errorWords(error)}`); }
  }
  for (const name of names) {
    const path = projectSettingsPath(dataRoot, name);
    if (!existsSync(path) && name !== project) continue;
    try {
      const settings = name === project ? ensureProjectSettings(dataRoot, name, libdir) : projectBundle(path);
      const principal = settings.config.principalProfile;
      const edits: Record<string, { extensions: readonly string[] }> = {};
      for (const [role, authored] of Object.entries(settings.snapshot!.authoredRoles)) {
        let entries = reconciledEntries(authored.value.extensions as string[], before, after);
        if (name === project && (role === principal || role === settings.workerProfile))
          for (const item of added) for (const entry of item.entries) if (!entries.includes(entry)) entries = [...entries, entry];
        if (JSON.stringify(entries) !== JSON.stringify(authored.value.extensions)) edits[role] = { extensions: entries };
      }
      if (name === project && added.some(item => item.entries.length > 0) &&
          (!settings.snapshot!.authoredRoles[principal] || (settings.workerProfile !== null && !settings.snapshot!.authoredRoles[settings.workerProfile])))
        throw new StoreError("UNSUPPORTED_PROFILE", "the project must declare its Principal and Worker roles");
      if (Object.keys(edits).length > 0) commitManagedEdit(settings.snapshot!, settings.config, edits);
      if (name === project) {
        applied = true;
        activatedRoles = settings.workerProfile === null ? "Principal" : "Principal and Workers";
      }
    } catch (error) { ok = false; said.push(`Could not update the extensions of project ${name}: ${errorWords(error)}`); }
  }
  for (const item of added) if (item.entries.length > 0)
    said.push(project === null
      ? `${item.source}: installed; turn it on for a project's Principal and Workers in Ctrl+X > Config > Extensions.`
      : !applied ? `${item.source}: installed, but not activated in this project; retry oma pi install after fixing the reported settings error.`
      : `${item.source}: on for this project's ${activatedRoles} from their next start (Ctrl+X > Config > Extensions).`);
  return { ok, said };
}
