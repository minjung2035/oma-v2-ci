/** DR24/DR25: the settings and extension view of one live Society session. */
import { deploymentDigest } from "../runtime/deployment-manifest.js";
import { readPackageIndex } from "../runtime/pi-packages.js";
import { readUserFile } from "../runtime/user-files.js";
import { CONFIGURATION_DOCUMENT_BYTES } from "../config/operations.js";
import { errorWords } from "./words.js";
import { readExtensions, toggleExtension } from "./sources/extensions.js";
import { commitField, deriveSessionSettings, projectSettingsPath, readSettings, readSettingsForEditing,
  type FieldValue, type SessionOwn, type Settings } from "./sources/settings.js";
import { ensureProjectSettings } from "./project-settings.js";

/** A session's view of its project's settings. Commits still belong to the
 * managed bundle primitives; this owner keeps derivation, read-back and the
 * extension view together so the entry cannot update only one of them. */
export class ProjectSessionSettings {
  private current: Settings;
  get settings(): Settings { return this.current; }
  projectSettings: Settings | null = null;
  extensions: ReturnType<typeof readExtensions>;
  unread: string | null = null;
  leftOut: readonly string[] = [];
  private seen: string | null = null;
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
    this.current = options.owns() ? this.derive() : readSettings(options.configPath);
    this.extensions = this.readExtensions();
  }

  private version(): string | null {
    // The managed pointer is small. Compare its actual bytes through the
    // existing inode-checked reader: equal mtime/size is not equal content.
    try { return readUserFile(this.projectPath, CONFIGURATION_DOCUMENT_BYTES); } catch { return null; }
  }
  changed(): boolean { const version = this.version(); return version === null || version !== this.seen; }

  private derive(): Settings {
    this.options.assertWritable("settings");
    const { dataRoot, project, libdir, configPath, externalConfig } = this.options;
    const digest = deploymentDigest(libdir);
    this.projectSettings = ensureProjectSettings(dataRoot, project, libdir, configPath, digest);
    // A Human's --config parent is outside the OMA repair boundary.
    const derived = deriveSessionSettings(this.projectSettings, configPath, this.options.own(digest),
      externalConfig ? undefined : dataRoot);
    this.leftOut = derived.missing;
    this.seen = this.version();
    return derived.settings;
  }

  private readExtensions(): ReturnType<typeof readExtensions> {
    return readExtensions(this.projectSettings?.snapshot ?? this.settings.snapshot ?? this.options.configPath,
      this.settings.config.principalProfile, this.settings.workerProfile, readPackageIndex(this.options.packageStore));
  }

  /** A failed read-back is unknown; it neither undoes a commit nor presents
   * the earlier snapshot as current. A changed-file refusal is read back too. */
  readBack(): boolean {
    try {
      this.current = readSettings(this.options.configPath);
      if (this.options.owns()) this.projectSettings = readSettingsForEditing(this.projectPath);
      this.extensions = this.readExtensions();
      this.unread = null;
      return true;
    } catch (error) { this.unread = errorWords(error); return false; }
  }

  rederive(): boolean {
    try { this.current = this.derive(); this.cannotFollow = ""; return true; }
    catch (error) {
      const words = `Saved for the project; this session takes it on from its next start (${errorWords(error)}).`;
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
