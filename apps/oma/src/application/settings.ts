import { PRINCIPAL_MODEL, WORKER_MODEL, INITIAL_WORKERS, WORKER_PROFILE, WORKER_INTEGRATE, EDITABLE_FIELDS, EXTENSIONS, followsEngine, engineName, engineModelChoiceOf, workerModelText, workerProfileOf, residentProfiles, bootstrapStateOf, fieldsOf, applyField, EDITABLE_FIELD_DESCRIPTORS, type FieldValue, type BootstrapState, type EditableField, } from "@oma/domain/settings-policy";
export { PRINCIPAL_MODEL, WORKER_MODEL, INITIAL_WORKERS, WORKER_PROFILE, WORKER_INTEGRATE, EDITABLE_FIELDS, EXTENSIONS, followsEngine, engineName, engineModelChoiceOf, workerModelText, workerProfileOf, residentProfiles, bootstrapStateOf, fieldsOf, applyField, EDITABLE_FIELD_DESCRIPTORS, type EditableField, type EngineModelChoice, type FieldValue, type BootstrapState, type EditableFieldDescriptor, } from "@oma/domain/settings-policy";
/** TUI-007/008/009: the Config screen's view of host authority.
 *
 * `config.json` stays the host-owned closed schema of CFG-001. This module
 * projects the few fields arch §23.6 exposes, transforms them purely, and
 * writes the result back atomically with a fresh policy revision (CFG-005).
 * It never invents a model, a quota or a profile that the host did not declare.
 */
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import type { EffortLevel, HostConfig, ModelProfile } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import { loadConfigurationSnapshot, loadEditableConfiguration, validateConfig, type ConfigurationSnapshot, type ValidatedConfigCandidate } from "@oma/config";
import { observeExtensionAsset, type ConfigurationLayout } from "@oma/config/operations";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { projectSettingsPathAt } from "@oma/domain/paths";
import type { DurabilityObserver } from "@oma/storage/durable-fs";
import { commitInlineConfiguration, commitManagedGeneration, createInlineConfiguration, managedRolesOf, type ManagedLimits, type ManagedCommit, type ManagedEdit, type ManagedRoleSource, type ManagedSource, } from "@oma/config/generations";
import type { ApplyScope, ConfigField } from "@oma/domain/settings";
import { CONFIG_BOUNDS } from "@oma/domain/surface-bounds";
/** The authored layout behind the composed config. A split bundle is edited
 * as a whole managed generation whose manifest is replaced last (D02/WP13),
 * never patched file by file and never flattened into its index.
 *
 * The layout itself is the loader's answer, not this screen's. This module used
 * to walk the manifest a second time with a weaker containment rule; what a
 * bundle contains has one owner, and a screen that writes must ask it.
 */
export type ConfigLayout = ConfigurationLayout;
export interface Settings {
    readonly path: string;
    /** What an edit is committed against: the snapshot it was read as, or (WP14.03)
     * the editing input of a bundle a declared extension file is missing from. */
    readonly snapshot: ManagedSource | null;
    readonly layout: ConfigLayout;
    readonly config: HostConfig;
    /** The profile a Worker edit changes, or null when there is none of its own. */
    readonly workerProfile: string | null;
    readonly fields: readonly ConfigField[];
}
export function settingsOf(path: string, config: HostConfig, layout: ConfigLayout = { kind: "inline", path }, snapshot: ManagedSource | null = null): Settings {
    const workerProfile = workerProfileOf(config);
    return Object.freeze({ path, snapshot, layout, config, workerProfile, fields: fieldsOf(config, workerProfile) });
}
/** DR24: a project's OMA settings -- its model and agent profiles, workers,
 * integration, limits -- held once, beside the societies of its sessions and
 * in none of them. Every session's society configuration is made from it, so
 * a setting saved in one session holds in the next and in the others. */
export function projectSettingsPath(dataRoot: string, project: string): string {
    return projectSettingsPathAt(dataRoot, project);
}
/** What a session's society has of its own: its name and the installation
 * it runs with, and (DR25) where the Human's installed packages
 * are. The rest is the project's. */
export interface SessionOwn {
    readonly society: string;
    readonly node: string;
    readonly libdir: string;
    readonly deploymentDigest: string;
    readonly packages?: string | undefined;
}
export function sessionConfigOf(project: HostConfig, own: SessionOwn): HostConfig {
    return { ...project, society: own.society,
        installation: { node: own.node, libdir: own.libdir, deploymentDigest: own.deploymentDigest,
            ...(own.packages === undefined ? {} : { packages: own.packages }) } };
}
/** DR25: the roles a configuration runs as, whole -- a bundle's authored
 * roles, or an inline configuration's: the core extension and no prompt,
 * which is how an engine runs a role an inline configuration names. */
export function roleSetOf(source: ManagedSource): Record<string, ManagedRoleSource> {
    const set: Record<string, ManagedRoleSource> = Object.create(null);
    for (const name of Object.keys(source.config.agentProfiles)) {
        const role = source.authoredRoles[name]?.value;
        set[name] = role === undefined
            ? Object.freeze({ extensions: Object.freeze([DEPLOYMENT_LAYOUT.extension]), prompt: Buffer.alloc(0) })
            : Object.freeze({ extensions: Object.freeze([...role.extensions as string[]]),
                prompt: Buffer.from(source.roles[name]?.prompt ?? "", "utf8") });
    }
    return set;
}
/** DR25: commits a whole role set with the candidate -- how an inline
 * configuration becomes a managed bundle, and how a session's configuration
 * takes on its project's roles. The same writer, the same proof by the
 * loader, the same refusal of a source changed since it was read.
 * `ownedFrom` is the commit's repair boundary, named by the layer that
 * knows where the bundle lives (P0-8); a caller that cannot vouch for an
 * oma-owned ancestor leaves it out and only the managed tail is repaired. */
export function commitRoleSet(snapshot: ManagedSource, config: HostConfig, roleSet: Readonly<Record<string, ManagedRoleSource>>, faults?: DurabilityObserver, ownedFrom?: string): ManagedCommit {
    const after = roleRevisionInput(managedRolesOf(snapshot, {}, config, roleSet));
    if (snapshot.layout.kind === "operations" &&
        sameMeaning(config, after, snapshot.config, roleRevisionInput(managedRolesOf(snapshot, {}, snapshot.config))))
        return Object.freeze({ kind: "unchanged", generation: null });
    return commitManagedGeneration(snapshot, { config: revised(config, after), roleSet }, faults, undefined, ownedFrom);
}
/** A configuration as last committed: runnable, or -- when only a declared
 * extension file is gone -- the editing input its repair is made from. */
export function readSettingsForEditing(path: string): Settings {
    try {
        return readSettings(path);
    }
    catch (error) {
        let editable: ReturnType<typeof loadEditableConfiguration>;
        try {
            editable = loadEditableConfiguration(path);
        }
        catch {
            throw error;
        }
        return settingsOf(path, editable.config, editable.layout, editable);
    }
}
/** DR25: a project's settings are a managed bundle, so each role's
 * extensions can be chosen; an inline one becomes one, running as it did. */
export function projectBundle(path: string, ownedFrom?: string): Settings {
    const settings = readSettingsForEditing(path);
    if (settings.layout.kind === "operations")
        return settings;
    commitRoleSet(settings.snapshot!, settings.config, roleSetOf(settings.snapshot!), undefined, ownedFrom);
    return readSettingsForEditing(path);
}
/** DR24/DR25: a session's configuration is its project's -- host settings,
 * models and roles, their extensions, prompts and tool surfaces -- with the
 * session's own name and installation. An extension the project
 * names whose file is gone is left out of the session, never loaded in its
 * place, and reported; the project keeps it until the Human turns it off. */
export function deriveSessionSettings(project: Settings, path: string, own: SessionOwn, ownedFrom?: string): {
    readonly settings: Settings;
    readonly missing: readonly string[];
} {
    if (project.snapshot === null)
        throw new StoreError("UNSUPPORTED_PROFILE", "a session is made only from the project's committed settings");
    const config = sessionConfigOf(project.config, own);
    const roots = { libdir: config.installation.libdir, packages: config.installation.packages };
    const missing = new Set<string>();
    const roleSet: Record<string, ManagedRoleSource> = Object.create(null);
    for (const [name, role] of Object.entries(roleSetOf(project.snapshot))) {
        const present = role.extensions.filter(entry => {
            if (observeExtensionAsset(roots, entry).kind !== "missing")
                return true;
            missing.add(entry);
            return false;
        });
        roleSet[name] = Object.freeze({ ...role, extensions: Object.freeze(present) });
    }
    if (lstatSync(path, { throwIfNoEntry: false }) === undefined)
        writeSettings(path, config, ownedFrom);
    const session = readSettingsForEditing(path);
    commitRoleSet(session.snapshot!, config, roleSet, undefined, ownedFrom);
    return Object.freeze({ settings: readSettings(path), missing: Object.freeze([...missing].sort()) });
}
export function readSettings(path: string): Settings {
    const snapshot = loadConfigurationSnapshot(path);
    return settingsOf(path, snapshot.config, snapshot.layout, snapshot);
}
/** CFG-005: a config replacement must carry a new policy revision. Deriving it
 * from the content hash makes the value deterministic and guarantees it only
 * changes when the policy content actually changed.
 */
export function revisionFor(config: HostConfig, roles?: Readonly<Record<string, unknown>>): string {
    const withoutRevision = { ...config, integration: { ...config.integration, policyRevision: "" } };
    const hash = createHash("sha256").update(JSON.stringify(withoutRevision));
    // D02/CFG-005: in a bundle the roles' prompts, extension selection and tool
    // surfaces are policy too; an inline config has none, so its value is unchanged.
    if (roles !== undefined)
        hash.update("\n").update(JSON.stringify(roles));
    return `rev-${hash.digest("hex").slice(0, CONFIG_BOUNDS.revisionDigestHex.value)}`;
}
/** DR12, P0-2: whether two configurations mean the same -- the one answer for
 * both layouts. The policy revision is derived from the meaning, so it is left
 * out; in a bundle the roles' prompts, extensions and tool surfaces are part of
 * the meaning (an inline config has none). */
function sameMeaning(left: HostConfig, leftRoles: Record<string, unknown>, right: HostConfig, rightRoles: Record<string, unknown>): boolean {
    const meaning = (value: HostConfig, roles: Record<string, unknown>) => JSON.stringify([{ ...value, integration: { ...value.integration, policyRevision: "" } }, roles]);
    return meaning(left, leftRoles) === meaning(right, rightRoles);
}
function revised(config: HostConfig, roles?: Readonly<Record<string, unknown>>): ValidatedConfigCandidate {
    return validateConfig({ ...config, integration: { ...config.integration, policyRevision: revisionFor(config, roles) } });
}
/** DR12, P0-3: an inline `config.json` is committed by the generation owner
 * (config/generations.ts): the expected version is the snapshot the edit was
 * read as, and the loader reproduces the candidate before the commit point. */
function commitInlineEdit(snapshot: Pick<ConfigurationSnapshot, "config" | "layout" | "sourceFiles">, config: HostConfig, faults?: DurabilityObserver): ManagedCommit {
    if (sameMeaning(config, {}, snapshot.config, {}))
        return Object.freeze({ kind: "unchanged", generation: null });
    return commitInlineConfiguration(snapshot, revised(config), faults);
}
/** Compatibility facade: arbitrary HostConfig is never handed to the writer.
 * A missing file is created, never overwritten if another start made it first;
 * an existing one is committed against the version read just now. */
export function writeSettings(path: string, config: HostConfig, ownedFrom?: string): HostConfig {
    const candidate = revised(validateConfig(config));
    if (lstatSync(path, { throwIfNoEntry: false }) === undefined) {
        if (createInlineConfiguration(path, candidate) === "existing")
            return loadConfigurationSnapshot(path).config;
        return candidate;
    }
    const snapshot = loadConfigurationSnapshot(path);
    if (snapshot.layout.kind === "inline") {
        commitInlineEdit(snapshot, candidate);
        return loadConfigurationSnapshot(path).config;
    }
    commitManagedEdit(snapshot, candidate, {}, undefined, undefined, ownedFrom);
    return loadConfigurationSnapshot(path).config;
}
/** D02/WP13: the one writer of a split bundle. The candidate is revised over
 * its effective config and roles, compared with the snapshot it was derived
 * from (a same-semantic save publishes nothing), validated whole, and handed
 * to the generation writer, which refuses a snapshot that is no longer current.
 */
export function commitManagedEdit(snapshot: ManagedSource, config: HostConfig, roles: ManagedEdit["roles"] = {}, faults?: DurabilityObserver, limits?: ManagedLimits, ownedFrom?: string): ManagedCommit {
    const before = managedRolesOf(snapshot, {}, snapshot.config);
    const after = managedRolesOf(snapshot, roles, config);
    if (sameMeaning(config, roleRevisionInput(after), snapshot.config, roleRevisionInput(before)))
        return Object.freeze({ kind: "unchanged", generation: null });
    return commitManagedGeneration(snapshot, { config: revised(config, roleRevisionInput(after)), roles }, faults, limits, ownedFrom);
}
function roleRevisionInput(roles: ReturnType<typeof managedRolesOf>): Record<string, unknown> {
    return Object.fromEntries(Object.keys(roles).sort().map(name => {
        const role = roles[name]!;
        return [name, { extensions: role.extensions,
                prompt: createHash("sha256").update(role.prompt).digest("hex") }];
    }));
}
/** Writes one confirmed Config value (CFG-005). The composed config is
 * validated first, so an unknown model or profile is refused before anything is
 * written; an inline config is replaced as one file, a split bundle is
 * published as one managed generation.
 */
export type FieldCommit = {
    readonly kind: "saved";
} | {
    readonly kind: "unchanged";
};
export function commitField(settings: Settings, field: string, value: FieldValue, bootstrap: BootstrapState = "unknown", ownedFrom?: string): FieldCommit {
    if (!Object.hasOwn(EDITABLE_FIELD_DESCRIPTORS, field))
        throw new StoreError("INVALID_REQUEST", `unknown settings field ${field}`);
    const descriptor = EDITABLE_FIELD_DESCRIPTORS[field as EditableField];
    // WP15: the screen does not offer a blocked field; the writer refuses it too.
    const blocked = descriptor.blocked?.(settings.config, bootstrap) ?? null;
    if (blocked !== null)
        throw new StoreError("INVALID_REQUEST", blocked);
    const applied = validateConfig(descriptor.transform(settings, value));
    // P0-3: every edit is transform -> whole validation -> one commit, against
    // the snapshot it was read as.
    if (settings.snapshot === null)
        throw new StoreError("UNSUPPORTED_PROFILE", "a configuration is edited only from the snapshot it was read as");
    const committed = settings.layout.kind === "inline"
        ? commitInlineEdit(settings.snapshot, applied) : commitManagedEdit(settings.snapshot, applied, {}, undefined, undefined, ownedFrom);
    return Object.freeze({ kind: committed.kind === "unchanged" ? "unchanged" : "saved" });
}
