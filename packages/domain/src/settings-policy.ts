/** Settings meaning, field projection and edits. Callers validate and commit the whole candidate. */
import type { EffortLevel, HostConfig, ModelProfile } from "@oma/contracts";
import type { ApplyScope, ConfigField } from "./settings.js";
import { EFFORT_LEVELS } from "./settings.js";
import { StoreError } from "./errors.js";
import { CONFIG_BOUNDS } from "./surface-bounds.js";
export interface FieldSettings {
    readonly config: HostConfig;
    readonly workerProfile: string | null;
}
export const PRINCIPAL_MODEL = "principal-model";
export const WORKER_MODEL = "worker-model";
export const INITIAL_WORKERS = "initial-workers";
export const WORKER_PROFILE = "worker-profile";
export const WORKER_INTEGRATE = "worker-integrate";
export const EDITABLE_FIELDS = Object.freeze([
    PRINCIPAL_MODEL,
    WORKER_MODEL,
    INITIAL_WORKERS,
    WORKER_PROFILE,
    WORKER_INTEGRATE,
] as const);
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export const EXTENSIONS = "extensions";
/** DR24: a model and its effort, chosen from the engine's own lists. */
export interface EngineModelChoice {
    readonly provider: string;
    readonly model: string;
    readonly thinking?: EffortLevel;
}
/** What a Config field is set to: an option, a number, or a model from the engine's list. */
export type FieldValue = string | number | EngineModelChoice;
/** A model profile that leaves the model to the engine: its default, as its own settings name it. */
export function followsEngine(profile: ModelProfile | undefined): boolean {
    return profile?.provider === "pi" && profile.model === "current";
}
/** A name the engine's screen reported, or null when it is not one. */
export function engineName(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 && value.length <= CONFIG_BOUNDS.engineNameChars.value ? value : null;
}
/** An engine choice as the engine's screen reported it, or null when it is not one. */
export function engineModelChoiceOf(value: Readonly<Record<string, unknown>>): EngineModelChoice | null {
    const provider = engineName(value.provider), model = engineName(value.model);
    if (provider === null || model === null)
        return null;
    if (value.thinking !== undefined && !(EFFORT_LEVELS as readonly unknown[]).includes(value.thinking))
        return null;
    return Object.freeze({ provider, model, ...(value.thinking === undefined ? {} : { thinking: value.thinking as EffortLevel }) });
}
/** DR24: what a Worker runs, as the Worker model row says it. */
export function workerModelText(config: HostConfig, workerProfile: string | null): string {
    const name = workerProfile === null ? undefined : config.agentProfiles[workerProfile]?.modelProfile;
    const profile = name === undefined ? undefined : config.modelProfiles[name];
    if (profile === undefined)
        return "unknown";
    if (name === config.agentProfiles[config.principalProfile]?.modelProfile)
        return "Same as the Principal";
    if (followsEngine(profile))
        return "The engine's default";
    return `${profile.provider}/${profile.model}${profile.thinking === undefined ? "" : ` · ${profile.thinking}`}`;
}
/** P0V-51, P0-1: the profile a "Worker" field shows and changes, or null. The
 * Principal's own profile is never it: a configuration with a Principal only
 * is valid, and in it a Worker edit has no target -- it is refused, not
 * applied to the Principal the screen does not say it is changing. */
export function workerProfileOf(config: HostConfig): string | null {
    const own = (name: string | null | undefined): name is string => typeof name === "string" && name !== config.principalProfile && Object.hasOwn(config.agentProfiles, name);
    const seeded = config.initialResidents[0]?.profile;
    if (own(seeded))
        return seeded;
    const child = config.agentProfiles[config.principalProfile]?.childProfile;
    if (own(child))
        return child;
    return Object.keys(config.agentProfiles).find(name => own(name)) ?? null;
}
/** Resident profiles exclude the Principal's own profile: the Config screen
 * never offers to run Residents under Principal authority, and with none there
 * is nothing to offer.
 */
export function residentProfiles(config: HostConfig): readonly string[] {
    return Object.keys(config.agentProfiles).filter(name => name !== config.principalProfile).sort();
}
/** WP15: a Worker field with no Worker profile to change. */
const noWorkerProfile = (config: HostConfig): string | null => workerProfileOf(config) === null ? "No worker profile: configure a non-Principal agent profile first" : null;
/** The Worker profile a transform changes; its absence is refused, never a fallback. */
function workerTarget(settings: FieldSettings): string {
    const name = settings.workerProfile;
    assertKnown(name !== null, "there is no worker profile to change");
    return name!;
}
/** WP15/D05: whether this society's one bootstrap has happened, as observed.
 * The broker bootstraps only an empty registry, so the Principal row in an
 * observed status means seeds are no longer read; without an observation it
 * is unknown, never assumed. */
export type BootstrapState = "pending" | "done" | "unknown";
export function bootstrapStateOf(observation: {
    readonly kind: string;
    readonly statuses?: readonly {
        readonly agent: string;
    }[];
}): BootstrapState {
    if (observation.kind !== "observed" || observation.statuses === undefined)
        return "unknown";
    return observation.statuses.some(status => status.agent === "principal") ? "done" : "pending";
}
export function fieldsOf(config: HostConfig, workerProfile: string | null, bootstrap: BootstrapState = "unknown"): readonly ConfigField[] {
    const editable = EDITABLE_FIELDS
        .map(field => {
        const descriptor = EDITABLE_FIELD_DESCRIPTORS[field];
        return Object.freeze({
            id: field,
            label: descriptor.label,
            apply: descriptor.apply,
            blocked: descriptor.blocked?.(config, bootstrap) ?? null,
            ...descriptor.view(config, workerProfile),
        }) as ConfigField;
    });
    return Object.freeze([
        ...editable,
        Object.freeze({ kind: "link" as const, id: EXTENSIONS, label: "Extensions" }),
    ]);
}
function assertKnown(present: boolean, message: string): void {
    if (!present)
        throw new StoreError("UNSUPPORTED_PROFILE", message);
}
function withSeedCount(config: HostConfig, count: number, profile: string): HostConfig {
    const current = config.initialResidents;
    if (count <= current.length)
        return { ...config, initialResidents: current.slice(0, count) };
    const used = new Set(current.map(resident => resident.name));
    // CFG-002 keeps every seed field required, so a grown seed reuses the brief
    // the host already wrote rather than inventing an empty one the loader would
    // reject on the next start.
    const brief = current[current.length - 1]?.brief ?? "OMA resident.";
    const grown = [...current];
    let ordinal = 1;
    while (grown.length < count) {
        if (ordinal > CONFIG_BOUNDS.seedNameAttempts.value)
            throw new StoreError("INVALID_REQUEST", "no free bootstrap seed name");
        const name = `worker-${ordinal}`;
        ordinal += 1;
        if (used.has(name))
            continue;
        used.add(name);
        grown.push({ name, profile, brief });
    }
    return { ...config, initialResidents: grown };
}
/** Pure. Returns the config that the caller then writes; it does not touch disk
 * so that the transform can be tested against the closed schema directly.
 */
export function applyField(settings: FieldSettings, field: string, value: FieldValue): HostConfig {
    if (!Object.hasOwn(EDITABLE_FIELD_DESCRIPTORS, field))
        throw new StoreError("INVALID_REQUEST", `unknown settings field ${field}`);
    return EDITABLE_FIELD_DESCRIPTORS[field as EditableField].transform(settings, value);
}
type EditableFieldView = {
    readonly kind: "choice";
    readonly value: string;
    readonly options: readonly string[];
} | {
    readonly kind: "number";
    readonly value: number;
    readonly min: number;
    readonly max: number;
};
export interface EditableFieldDescriptor {
    readonly label: string;
    readonly apply: ApplyScope;
    /** WP15: why an edit would have no target or no effect now, or null. The
     * same descriptor owns label, value, apply time and this refusal. */
    readonly blocked?: (config: HostConfig, bootstrap: BootstrapState) => string | null;
    readonly view: (config: HostConfig, workerProfile: string | null) => EditableFieldView;
    readonly transform: (settings: FieldSettings, value: FieldValue) => HostConfig;
}
/** D05: seeds are read by the first bootstrap only. */
const seedsBlocked = (_config: HostConfig, bootstrap: BootstrapState): string | null => bootstrap === "done" ? "Society already bootstrapped: does not apply to existing workers" : null;
const DESCRIPTOR_SOURCE = {
    [PRINCIPAL_MODEL]: Object.freeze({
        label: "Principal model",
        apply: "next-session",
        view: (config: HostConfig) => ({
            kind: "choice" as const,
            value: config.agentProfiles[config.principalProfile]?.modelProfile ?? "",
            options: Object.keys(config.modelProfiles).sort(),
        }),
        transform: (settings: FieldSettings, value: FieldValue) => {
            const config = settings.config;
            assertKnown(typeof value === "string" && Object.hasOwn(config.modelProfiles, value), "unknown model profile");
            const profile = config.agentProfiles[config.principalProfile];
            assertKnown(profile !== undefined, "principal profile is missing from host config");
            return { ...config, agentProfiles: { ...config.agentProfiles,
                    [config.principalProfile]: { ...profile!, modelProfile: value as string } } };
        },
    }),
    [WORKER_MODEL]: Object.freeze({
        label: "Worker model",
        apply: "next-activation",
        blocked: noWorkerProfile,
        view: (config: HostConfig, workerProfile: string | null) => ({
            kind: "choice" as const,
            value: workerProfile === null ? "" : config.agentProfiles[workerProfile]?.modelProfile ?? "",
            options: Object.keys(config.modelProfiles).sort(),
        }),
        transform: (settings: FieldSettings, value: FieldValue) => {
            const config = settings.config;
            const name = workerTarget(settings);
            const profile = config.agentProfiles[name];
            assertKnown(profile !== undefined, "worker profile is missing from host config");
            const reference = profile!.modelProfile;
            const principalReference = config.agentProfiles[config.principalProfile]?.modelProfile;
            assertKnown(reference !== principalReference, "Worker and Principal share this model profile; edit the shared model configuration explicitly");
            const base = config.modelProfiles[reference];
            assertKnown(base !== undefined, "worker model profile is missing from host config");
            let next: ModelProfile;
            if (typeof value === "object") {
                const { thinking: _previous, ...previous } = base!;
                next = { ...previous, provider: value.provider, model: value.model,
                    ...(value.thinking === undefined ? {} : { thinking: value.thinking }) };
            } else {
                assertKnown(typeof value === "string" && Object.hasOwn(config.modelProfiles, value), "unknown model profile");
                next = { ...config.modelProfiles[value as string]! };
            }
            return { ...config, modelProfiles: { ...config.modelProfiles, [reference]: next } };
        },
    }),
    [INITIAL_WORKERS]: Object.freeze({
        label: "Initial workers",
        apply: "bootstrap-only",
        blocked: seedsBlocked,
        view: (config: HostConfig) => ({
            kind: "number" as const, value: config.initialResidents.length, min: 0, max: CONFIG_BOUNDS.maxInitialWorkers.value,
        }),
        transform: (settings: FieldSettings, value: FieldValue) => {
            assertKnown(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, "initial workers must be a non-negative integer");
            // A seed needs a Worker profile only when one is added.
            const count = value as number;
            return withSeedCount(settings.config, count, count > settings.config.initialResidents.length ? workerTarget(settings) : "");
        },
    }),
    [WORKER_PROFILE]: Object.freeze({
        label: "Bootstrap worker profile",
        apply: "bootstrap-only",
        // D05: with no seeds there is no target; the selection is not kept anywhere.
        blocked: (config: HostConfig, bootstrap: BootstrapState) => config.initialResidents.length === 0
            ? "No bootstrap workers: increase Initial workers first" : seedsBlocked(config, bootstrap),
        view: (config: HostConfig, workerProfile: string | null) => ({
            kind: "choice" as const, value: workerProfile ?? "", options: residentProfiles(config),
        }),
        transform: (settings: FieldSettings, value: FieldValue) => {
            const config = settings.config;
            assertKnown(config.initialResidents.length > 0, "there are no bootstrap workers to change");
            // The profiles the screen offers are the ones a Resident may run under.
            assertKnown(typeof value === "string" && residentProfiles(config).includes(value), "unknown agent profile");
            // Existing Resident specs are immutable; only not-yet-created bootstrap seeds change.
            return { ...config, initialResidents: config.initialResidents.map(resident => ({ ...resident, profile: value as string })) };
        },
    }),
    // DR4, TUI-019: the role capability the Human decides. `code.integrate` is
    // the host's to give (A-002); an agent created afterwards has it, one that
    // exists keeps its frozen spec (LIFE-008).
    [WORKER_INTEGRATE]: Object.freeze({
        label: "Worker integrate",
        apply: "new-agents",
        blocked: noWorkerProfile,
        view: (config: HostConfig, workerProfile: string | null) => ({
            kind: "choice" as const,
            value: workerProfile !== null && config.agentProfiles[workerProfile]?.capabilities.includes("code.integrate") ? "on" : "off",
            options: ["off", "on"],
        }),
        transform: (settings: FieldSettings, value: FieldValue) => {
            assertKnown(value === "on" || value === "off", "worker integrate is on or off");
            const config = settings.config;
            const name = workerTarget(settings);
            const profile = config.agentProfiles[name];
            assertKnown(profile !== undefined, "worker profile is missing from host config");
            const others = profile!.capabilities.filter(capability => capability !== "code.integrate");
            const capabilities = value === "on" ? [...others, "code.integrate" as const] : others;
            return { ...config, agentProfiles: { ...config.agentProfiles, [name]: { ...profile!, capabilities } } };
        },
    }),
} satisfies Readonly<Record<EditableField, EditableFieldDescriptor>>;
const PLACEMENT: Readonly<Record<EditableField, EditableFieldDescriptor>> = Object.freeze(Object.assign(Object.create(null), DESCRIPTOR_SOURCE));
export const EDITABLE_FIELD_DESCRIPTORS = PLACEMENT;
