/** DR24/DR25: the settings and extension view of one live Society session. */
import { CONFIGURATION_DOCUMENT_BYTES } from "@oma/config/operations";
import { deploymentDigest } from "../runtime/deployment-manifest.js";
import { readPackageIndex } from "../runtime/packages/index.js";
import { readUserFile } from "../runtime/user-files.js";
import { ensureProjectSettings } from "./project-settings.js";
import { readExtensions, toggleExtension } from "./extensions.js";
import {
	commitField, deriveSessionSettings, projectSettingsPath, readSettings, readSettingsForEditing,
	type FieldValue, type SessionOwn, type Settings
} from "./settings.js";
import { exceptionText } from "@oma/domain/errors";

/** A session's view of its project's settings. Commits still belong to the
 * managed bundle primitives; this owner keeps derivation, read-back and the
 * extension view together so the entry cannot update only one of them. */
interface SettingsSnapshot {
  readonly current: Settings;
  readonly projectSettings: Settings | null;
  readonly extensions: ReturnType<typeof readExtensions>;
  readonly leftOut: readonly string[];
  readonly seen: string | null;
}

export class ProjectSessionSettings {
  private snapshot: SettingsSnapshot;
  get settings(): Settings { return this.snapshot.current; }
  get projectSettings(): Settings | null { return this.snapshot.projectSettings; }
  get extensions(): ReturnType<typeof readExtensions> { return this.snapshot.extensions; }
  get leftOut(): readonly string[] { return this.snapshot.leftOut; }
  unread: string | null = null;
  private cannotFollow = "";
  private readonly projectPath: string;

  constructor(private readonly options: {
    readonly dataRoot: string; readonly project: string; readonly libdir: string;
    readonly configPath: string; readonly packageStore: string; readonly externalConfig: boolean;
    readonly own: (digest: string) => SessionOwn;
    readonly owns: () => boolean; readonly assertWritable: (what: string) => void;
    readonly notice: (text: string) => void;
  }) {
    this.projectPath = projectSettingsPath(options.dataRoot, options.project);
    if (options.owns()) this.snapshot = this.derive();
    else {
      const current = readSettings(options.configPath);
      this.snapshot = this.makeSnapshot(current, null, [], null);
    }
  }

  private version(): string | null {
    // The managed pointer is small. Compare its actual bytes through the
    // existing inode-checked reader: equal mtime/size is not equal content.
    try { return readUserFile(this.projectPath, CONFIGURATION_DOCUMENT_BYTES); } catch { return null; }
  }
  changed(): boolean { const version = this.version(); return version === null || version !== this.snapshot.seen; }

  private derive(): SettingsSnapshot {
    this.options.assertWritable("settings");
    const { dataRoot, project, libdir, configPath, externalConfig } = this.options;
    const digest = deploymentDigest(libdir);
    const projectSettings = ensureProjectSettings(dataRoot, project, libdir, configPath, digest);
    // A Human's --config parent is outside the OMA repair boundary.
    const derived = deriveSessionSettings(projectSettings, configPath, this.options.own(digest),
      externalConfig ? undefined : dataRoot);
    return this.makeSnapshot(derived.settings, projectSettings, derived.missing, this.version());
  }

  private makeSnapshot(current: Settings, projectSettings: Settings | null, leftOut: readonly string[],
      seen: string | null): SettingsSnapshot {
    const extensions = readExtensions(projectSettings?.snapshot ?? current.snapshot ?? this.options.configPath,
      current.config.principalProfile, current.workerProfile, readPackageIndex(this.options.packageStore));
    // Publish only after every dependent observation succeeded. Diagnostics
    // may change on failure, but the previously complete view remains intact.
    return Object.freeze({ current, projectSettings, extensions, leftOut: Object.freeze([...leftOut]), seen });
  }

  /** A failed read-back is unknown; it neither undoes a commit nor presents
   * the earlier snapshot as current. A changed-file refusal is read back too. */
  readBack(): boolean {
    try {
      const current = readSettings(this.options.configPath);
      const projectSettings = this.options.owns() ? readSettingsForEditing(this.projectPath) : this.snapshot.projectSettings;
      this.snapshot = this.makeSnapshot(current, projectSettings, this.snapshot.leftOut, this.snapshot.seen);
      this.unread = null;
      return true;
    } catch (error) { this.unread = exceptionText(error); return false; }
  }

  rederive(): boolean {
    try { this.snapshot = this.derive(); this.cannotFollow = ""; return true; }
    catch (error) {
      const words = `Saved for the project; this session takes it on from its next start (${exceptionText(error)}).`;
      if (words !== this.cannotFollow) this.options.notice(words);
      this.cannotFollow = words;
      return false;
    }
  }

  saveField(field: string, value: FieldValue, bootstrap: Parameters<typeof commitField>[3]):
      ReturnType<typeof commitField> | { readonly kind: "saved-unread"; readonly reason: string } {
    this.options.assertWritable("settings");
    let committed: ReturnType<typeof commitField>;
    try { committed = commitField(this.projectSettings ?? readSettings(this.projectPath), field, value, bootstrap, this.options.dataRoot); }
    catch (error) { this.rederive(); this.readBack(); throw error; }
    this.rederive();
    if (!this.readBack()) return { kind: "saved-unread", reason: this.unread! };
    return committed;
  }

  setExtension(id: string, role: Parameters<typeof toggleExtension>[2], enabled: boolean): void {
    this.options.assertWritable("extensions");
    try { toggleExtension(this.extensions, id, role, enabled, this.options.dataRoot); }
    finally { this.rederive(); this.readBack(); }
  }
}
