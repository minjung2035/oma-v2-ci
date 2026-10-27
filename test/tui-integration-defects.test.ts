import { dirname } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { HostConfig } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { configurationLayout as layoutOf, readConfigurationSource } from "@oma/config/operations";
import { encodeToolSurfacePlan } from "@oma/domain/tool-surface";
import { readExtensions, toggleExtension } from "#oma-test/app/application/extensions";
import { PRINCIPAL_MODEL, WORKER_MODEL, commitField, readSettings, } from "#oma-test/app/application/settings";
import { PACKAGE_STORE_ENV, principalEnvironment, projectEvent, sessionArgv, sessionEnv } from "@oma/engine/principal-session";
import { principalSessionProfile } from "#oma-test/app/engine/principal-profile";
import { PACKAGE_STORE_ENV as GUARD_PACKAGE_STORE_ENV } from "@oma/tool-runtime/workspace-guard";
import { PRINCIPAL_SYSTEM_PROMPT } from "@oma/domain/role-prompts";
import { loadConfiguration } from "@oma/config";
import { registerToolSurface } from "@oma/tool-runtime/tool-surface";
import { assertExtensionIntegrity } from "#oma-test/app/runtime/extension-integrity";
import { verifiedPaths } from "@oma/domain/extension-paths";
const CORE = DEPLOYMENT_LAYOUT.extension;
const digest = (text: string): string => createHash("sha256").update(text).digest("hex");
const scratch = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));
const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
/** A split operations bundle. D23: role files carry no toolSurface -- the
 * field is closed now, so writing one would make the fixture itself unloadable. */
function bundle(root: string): string {
    const libdir = join(root, "lib");
    mkdirSync(dirname(join(libdir, CORE)), { recursive: true });
    mkdirSync(join(libdir, "extensions"), { recursive: true });
    writeFileSync(join(libdir, CORE), "export {};\n");
    writeFileSync(join(libdir, "extensions", "review.js"), "export {};\n");
    writeFileSync(join(root, "prompt.md"), "");
    const host: Partial<HostConfig> = {
        schemaVersion: 4,
        society: "demo",
        installation: { node: process.execPath, libdir,  deploymentDigest: digest("d") },
        principalProfile: "principal",
        initialResidents: [{ name: "a", profile: "resident", brief: "seed" }],
        integration: { policyRevision: "rev-initial", protectedPaths: [], checks: [] },
        limits: { frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64, replyReferences: 64, contextFiles: 256, contextBytes: 8388608, bundleBytes: 268435456, logBytes: 1048576, batchMaxMessages: 24, idleStreamSeconds: 1, receiptWaitSeconds: 1 }
    };
    writeFileSync(join(root, "host.json"), JSON.stringify(host, null, 2));
    writeFileSync(join(root, "models.json"), JSON.stringify({
        cheap: { provider: "p", model: "cheap", inferenceTimeoutSeconds: 1 },
        strong: { provider: "p", model: "strong", inferenceTimeoutSeconds: 1 },
    }, null, 2));
    const role = (model: string, child: string | null): Record<string, unknown> => ({
        agentProfile: { modelProfile: model, capabilities: [], delegable: [], childProfile: child },
        extensions: [CORE],
        promptFile: "prompt.md",
    });
    writeFileSync(join(root, "principal.json"), JSON.stringify(role("strong", "resident"), null, 2));
    writeFileSync(join(root, "resident.json"), JSON.stringify(role("cheap", null), null, 2));
    const index = join(root, "index.json");
    writeFileSync(index, JSON.stringify({
        kind: "oma-operations-v1", host: "host.json", models: "models.json",
        roles: { principal: "principal.json", resident: "resident.json" },
    }, null, 2));
    return index;
}
/** D02/WP13: split-bundle edits publish a managed generation; observe them
 * through the loader, never by reading the authored files that are kept. */
const authored = (index: string, role: string): Record<string, unknown> => readConfigurationSource(index).authoredRoles[role]!.value as Record<string, unknown>;
const hostOf = (index: string): Record<string, unknown> => {
    const layout = layoutOf(index);
    assert.equal(layout.kind, "operations");
    return readJson(layout.kind === "operations" ? layout.host : "");
};
const removeTree = (root: string): void => {
    // Published generations are read-only; the test owns them.
    const walk = (path: string): void => {
        try {
            chmodSync(path, 0o700);
        }
        catch {
            return;
        }
        for (const entry of readdirSync(path, { withFileTypes: true }))
            if (entry.isDirectory())
                walk(join(path, entry.name));
    };
    walk(root);
    rmSync(root, { recursive: true, force: true });
};
test("toggling an extension preserves every other field of the role file", () => {
    const root = scratch("oma-defect-ext-");
    try {
        const index = bundle(root);
        const context = readExtensions(index, "principal", "resident");
        assert.equal(context.editable, true);
        toggleExtension(context, "extensions/review.js", "principal", true);
        const written = authored(index, "principal");
        assert.deepEqual(written.extensions, [CORE, "extensions/review.js"]);
        // The prompt reference must survive the toggle.
        assert.match(String(written.promptFile), /^\.oma-config\/generations\/g-[0-9a-f]{64}\/prompts\/principal\.md$/);
        assert.ok(written.agentProfile, "agentProfile must remain");
        // The loader still accepts the bundle.
        const roles = readConfigurationSource(index).roles;
        assert.ok(roles["principal"] !== undefined && !Object.hasOwn(roles["principal"], "toolSurface"));
    }
    finally {
        removeTree(root);
    }
});
test("a Config edit publishes the split bundle as a generation instead of flattening it", () => {
    const root = scratch("oma-defect-cfg-");
    try {
        const index = bundle(root);
        assert.equal(layoutOf(index).kind, "operations");
        const settings = readSettings(index);
        commitField(settings, PRINCIPAL_MODEL, "cheap");
        // The index stays an operations manifest; it is not overwritten with a
        // flattened HostConfig.
        const manifest = readJson(index);
        assert.equal(manifest.kind, "oma-operations-v1");
        assert.ok(manifest.roles, "roles map survives");
        assert.equal(manifest.quota, undefined, "the index must not gain flattened host fields");
        // The change is the principal role's, and its prompt reference is untouched.
        const principal = authored(index, "principal");
        assert.equal((principal.agentProfile as Record<string, unknown>).modelProfile, "cheap");
        assert.ok(principal.promptFile, "the prompt reference survives");
        // CFG-005: the policy revision moved with the edit.
        assert.notEqual((hostOf(index).integration as Record<string, unknown>).policyRevision, "rev-initial");
        // The authored files the bundle was migrated from are kept as they were.
        assert.equal((readJson(join(root, "principal.json")).agentProfile as Record<string, unknown>).modelProfile, "strong");
        // The bundle still loads, so nothing structural was destroyed.
        const reloaded = readSettings(index);
        assert.equal(reloaded.config.agentProfiles["principal"]!.modelProfile, "cheap");
        assert.ok(readConfigurationSource(index).roles["resident"] !== undefined);
    }
    finally {
        removeTree(root);
    }
});
test("a removed quota edit is refused without modifying the split bundle", () => {
    const root = scratch("oma-defect-quota-");
    try {
        const index = bundle(root);
        const before = hostOf(index);
        assert.throws(() => commitField(readSettings(index), "worker-limit", 12), { code: "INVALID_REQUEST" });
        assert.deepEqual(hostOf(index), before);
        assert.equal(readJson(index).kind, "oma-operations-v1");
        assert.ok(authored(index, "resident").promptFile, "the role file is intact");
        assert.equal((authored(index, "resident").agentProfile as Record<string, unknown>).modelProfile, "cheap");
    }
    finally {
        removeTree(root);
    }
});
test("DR46: a Worker model edit changes its existing reference contents without changing Principal", () => {
    const root = scratch("oma-defect-worker-");
    try {
        const index = bundle(root);
        const before = readSettings(index).config;
        const workerReference = before.agentProfiles.resident!.modelProfile;
        const principalBefore = structuredClone(before.modelProfiles[before.agentProfiles.principal!.modelProfile]);
        const workerBefore = structuredClone(before.modelProfiles[workerReference]!);
        commitField(readSettings(index), WORKER_MODEL, "strong");
        const changed = readSettings(index).config;
        assert.equal(changed.agentProfiles.resident!.modelProfile, workerReference);
        assert.deepEqual(changed.modelProfiles[workerReference], before.modelProfiles.strong);
        assert.deepEqual(changed.modelProfiles[changed.agentProfiles.principal!.modelProfile], principalBefore);
        commitField(readSettings(index), WORKER_MODEL, workerBefore);
        const restored = readSettings(index).config;
        assert.equal(restored.agentProfiles.resident!.modelProfile, workerReference);
        assert.deepEqual(restored.modelProfiles[workerReference], workerBefore);
        assert.deepEqual(restored.modelProfiles[restored.agentProfiles.principal!.modelProfile], principalBefore);
    }
    finally {
        removeTree(root);
    }
});
test("D23: the Principal session carries no authored projection -- the surface is OMA's own", () => {
    // A role file's fields are closed, and a session profile has no field for a
    // plan: there is no authored way for OMA_TOOL_SURFACE to reach the engine.
    const root = scratch("oma-defect-env-");
    try {
        bundle(root);
        const role = readConfigurationSource(join(root, "index.json")).roles["principal"];
        assert.ok(role !== undefined && !Object.hasOwn(role, "toolSurface"));
    }
    finally {
        removeTree(root);
    }
    const env = sessionEnv({ HOME: "/h", PATH: "/usr/bin" }, {
        society: "demo", provider: "pi", model: "current", extensions: [],
    });
    assert.ok(!("OMA_TOOL_SURFACE" in env), "no profile field carries a projection");
    assert.equal(env.HOME, "/h");
});
test("D23/TSP-005: a stray ambient OMA_TOOL_SURFACE never reaches the Principal's engine", () => {
    // The plan channel is runner→Resident plumbing only. A malformed plan would
    // exit(1) the host engine at session_start; a crafted-valid one would narrow
    // its tools -- the inherited environment must carry neither.
    const crafted = encodeToolSurfacePlan({
        version: 1, defaultMode: "DISABLED", direct: ["read"], disabled: ["danger"],
        grouped: ["fetch"], groups: [{ name: "web", description: "web", children: ["fetch"] }], roots: ["web"],
    });
    for (const ambient of ["{not json", crafted]) {
        const env = sessionEnv({ HOME: "/h", PATH: "/usr/bin", OMA_TOOL_SURFACE: ambient }, {
            society: "demo", provider: "pi", model: "current", extensions: [],
        });
        assert.ok(!("OMA_TOOL_SURFACE" in env), "the runner's own plumbing channel leaked into the host engine");
        assert.equal(env.HOME, "/h");
    }
});
test("C18: the Principal's environment names the package store root its guard may read, and the mirror spellings agree", () => {
    const env = principalEnvironment({ stateRoot: "/state", runRoot: "/run", libdir: "/lib" }, { society: "demo", provider: "p", model: "m", extensions: [], packageStore: "/data/.packages" }, { frameBytes: 1024, mailBodyBytes: 1024, batchMaxMessages: 4, addresses: 64, contextBytes: 4096, bundleBytes: 8192 });
    assert.equal(env[PACKAGE_STORE_ENV], "/data/.packages", "the store root the guard permits reads under");
    assert.equal(GUARD_PACKAGE_STORE_ENV, PACKAGE_STORE_ENV, "the extension's mirror is not the writer's spelling");
    const without = principalEnvironment({ stateRoot: "/state", runRoot: "/run", libdir: "/lib" }, { society: "demo", provider: "p", model: "m", extensions: [] }, { frameBytes: 1024, mailBodyBytes: 1024, batchMaxMessages: 4, addresses: 64, contextBytes: 4096, bundleBytes: 8192 });
    assert.ok(!(PACKAGE_STORE_ENV in without), "no store means no read permission");
});
test("an engine extension_error projects as an OMA notice; extension-provided text is stripped of what a screen cannot show", () => {
    assert.equal(projectEvent({ type: "extension_error", extensionPath: "/x/role-ext.ts", event: "tool_call", error: "boom" } as never).line, "⚠ Extension role-ext.ts failed on tool_call: boom.");
    // The event's text is the extension's: terminal control and format
    // characters are removed before it reaches the transcript.
    assert.equal(projectEvent({ type: "extension_error", extensionPath: "/x/e.ts", event: "s", error: "a\x1b[2Jb\u200e" } as never).line, "⚠ Extension e.ts failed on s: a[2Jb.");
    assert.equal(projectEvent({ type: "extension_error" } as never).line, "⚠ Extension extension failed.");
});
test("the Principal session is built from its role, not from defaults", () => {
    // Behaviour, not text: a regex over the entrypoint used to stand in for this.
    const root = scratch("oma-principal-profile-");
    try {
        const configPath = bundle(root);
        const configuration = loadConfiguration(configPath);
        const role = configuration.roles[configuration.config.principalProfile]!;
        const profile = principalSessionProfile(configPath, "demo");
        assert.equal(`${profile.provider}/${profile.model}`, "p/strong", "the Principal runs its own role's model");
        assert.deepEqual(profile.extensions, role.extensions.map(extension => ({ path: extension.path, sha256: extension.sha256 })), "the Principal runs its role's extensions, digests included");
        assert.ok(profile.extensions.length > 0, "a role with extensions must not start with an empty list");
        assert.ok(!("toolSurface" in profile), "D23: no authored projection field travels to the engine");
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
interface FakeHost {
    setActiveTools(names: string[]): void;
    getActiveTools(): string[];
    getAllTools(): {
        name: string;
    }[];
    registerTool(tool: unknown): void;
    on(event: string, handler: () => void): void;
}
function fakeHost(overrides: Partial<FakeHost> = {}): FakeHost & {
    active: string[];
    registered: string[];
    start(): void;
} {
    const state = { active: ["read", "fetch", "danger"], registered: [] as string[] };
    const handlers: Array<() => void> = [];
    const host = {
        ...state,
        setActiveTools(names: string[]) { state.active = [...names]; },
        getActiveTools() { return [...state.active]; },
        getAllTools() { return ["read", "fetch", "danger", "oma_mail_read"].map(name => ({ name })); },
        registerTool(tool: unknown) { state.registered.push((tool as {
            name: string;
        }).name); },
        // The engine rejects action methods during extension loading, so the
        // projection runs from this handler, not from registration.
        on(event: string, handler: () => void) { if (event === "session_start")
            handlers.push(handler); },
        start() { for (const handler of handlers)
            handler(); },
        ...overrides,
    };
    Object.defineProperty(host, "active", { get: () => state.active });
    Object.defineProperty(host, "registered", { get: () => state.registered });
    return host as FakeHost & {
        active: string[];
        registered: string[];
        start(): void;
    };
}
test("the tool surface fails closed when the host refuses to apply it", () => {
    const plan = encodeToolSurfacePlan({
        version: 1, defaultMode: "DISABLED", direct: ["read"], disabled: ["danger"],
        grouped: ["fetch"], groups: [{ name: "web", description: "web", children: ["fetch"] }], roots: ["web"],
    });
    // The real `fatal` ends the engine process; here it throws so the test host survives.
    const fatal = (message: string): never => { throw new Error(message); };
    const previous = process.env.OMA_TOOL_SURFACE;
    try {
        process.env.OMA_TOOL_SURFACE = plan;
        const refusing = fakeHost({ setActiveTools() { throw new Error("host refused"); } });
        // Loading must succeed: an extension that throws while loading never loads.
        assert.doesNotThrow(() => registerToolSurface(refusing as never, ["oma_mail_read"], { fatal }));
        assert.throws(() => refusing.start(), /could not be applied/, "a refused projection must not be swallowed");
        // A malformed plan must also fail loudly rather than leaving the surface as is.
        process.env.OMA_TOOL_SURFACE = "{not json";
        const malformed = fakeHost({ setActiveTools() { throw new Error("host refused"); } });
        registerToolSurface(malformed as never, ["oma_mail_read"], { fatal });
        assert.throws(() => malformed.start(), /malformed/);
        // An unreadable active set must never be treated as empty.
        process.env.OMA_TOOL_SURFACE = plan;
        const blind = fakeHost({ getAllTools() { throw new Error("no registry"); } });
        registerToolSurface(blind as never, ["oma_mail_read"], { fatal });
        assert.throws(() => blind.start(), /could not read the registered tools/);
    }
    finally {
        if (previous === undefined)
            delete process.env.OMA_TOOL_SURFACE;
        else
            process.env.OMA_TOOL_SURFACE = previous;
    }
});
test("the tool surface applies the projection when the host accepts it", () => {
    const previous = process.env.OMA_TOOL_SURFACE;
    try {
        process.env.OMA_TOOL_SURFACE = encodeToolSurfacePlan({
            version: 1, defaultMode: "DISABLED", direct: ["read"], disabled: ["danger"],
            grouped: ["fetch"], groups: [{ name: "web", description: "web", children: ["fetch"] }], roots: ["web"],
        });
        const host = fakeHost();
        registerToolSurface(host as never, ["oma_mail_read"], { fatal: message => { throw new Error(message); } });
        assert.deepEqual(host.registered, [], "groups cannot overwrite tools before the complete registry is known");
        assert.deepEqual(host.active, ["read", "fetch", "danger"], "loading must not touch the active set");
        host.start();
        assert.deepEqual(host.registered, ["web"]);
        assert.deepEqual(host.active, ["oma_mail_read", "read", "web"]);
        assert.ok(!host.active.includes("danger"));
        assert.ok(!host.active.includes("fetch"));
    }
    finally {
        if (previous === undefined)
            delete process.env.OMA_TOOL_SURFACE;
        else
            process.env.OMA_TOOL_SURFACE = previous;
    }
});
test("an unknown settings field is refused before anything is written", () => {
    const root = scratch("oma-defect-unknown-");
    try {
        const index = bundle(root);
        const before = readFileSync(join(root, "host.json"), "utf8");
        assert.throws(() => commitField(readSettings(index), "not-a-field", 1), (error: unknown) => error instanceof StoreError && error.code === "INVALID_REQUEST");
        assert.equal(readFileSync(join(root, "host.json"), "utf8"), before);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("a recorded extension digest is re-checked and a changed file refuses the start", () => {
    const root = scratch("oma-integrity-");
    try {
        const file = join(root, "review.js");
        writeFileSync(file, "export {};\n");
        const recorded = digest(readFileSync(file, "utf8"));
        assertExtensionIntegrity([{ path: file, sha256: recorded }]);
        // Same path, different bytes after the digest was recorded.
        writeFileSync(file, "export const evil = 1;\n");
        assert.throws(() => assertExtensionIntegrity([{ path: file, sha256: recorded }]), (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" && /changed after it was recorded/.test(error.message));
        // A file that disappeared is refused, not skipped.
        rmSync(file);
        assert.throws(() => assertExtensionIntegrity([{ path: file, sha256: recorded }]), (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" && /unreadable now/.test(error.message));
        // A directory at the recorded path is not a regular file.
        mkdirSync(file);
        assert.throws(() => assertExtensionIntegrity([{ path: file, sha256: recorded }]), (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE");
        // A malformed recorded digest is refused before anything is hashed.
        assert.throws(() => assertExtensionIntegrity([{ path: file, sha256: "nope" }]), (error: unknown) => error instanceof StoreError && /not a SHA-256/.test(error.message));
        assert.deepEqual(verifiedPaths([{ path: "/a.js", sha256: recorded }, { path: "/b.js", sha256: recorded }]), ["/a.js", "/b.js"]);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("the digest recorded at configuration load survives to the spawn boundary", () => {
    const root = scratch("oma-integrity-flow-");
    try {
        const index = bundle(root);
        const recorded = readConfigurationSource(index).roles["principal"]!.extensions;
        assert.ok(recorded.length > 0, "the loader records at least the core extension");
        for (const extension of recorded)
            assert.match(extension.sha256, /^[0-9a-f]{64}$/);
        // The pairs the entrypoint forwards must keep both fields, not just the path.
        const forwarded = recorded.map(extension => ({ path: extension.path, sha256: extension.sha256 }));
        assertExtensionIntegrity(forwarded);
        // The spawn paths are exactly the recorded ones, in the recorded order.
        assert.deepEqual(verifiedPaths(forwarded), recorded.map(extension => extension.path));
        // Tampering with the installed file after load refuses the start.
        writeFileSync(forwarded[0]!.path, "export const tampered = 1;\n");
        assert.throws(() => assertExtensionIntegrity(forwarded), (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE");
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("the spawn paths never pass the core extension twice", () => {
    const paths = { piCommand: "/usr/bin/pi", coreExtension: "/lib/core.js", sessionDir: "/s", workspace: "/w", home: "/h" };
    const argv = sessionArgv(paths, {
        society: "demo", provider: "pi", model: "current", extensions: [{ path: "/lib/core.js", sha256: "0".repeat(64) }, { path: "/lib/review.js", sha256: "1".repeat(64) }],
    });
    assert.equal(argv.filter(entry => entry === "/lib/core.js").length, 1);
    assert.ok(argv.includes("/lib/review.js"));
});
test("the Principal and Resident spawn seams carry the same role contract", () => {
    const root = scratch("oma-seam-");
    try {
        const index = bundle(root);
        const role = readConfigurationSource(index).roles["principal"]!;
        // Whatever the Resident path forwards, the Principal path must forward too:
        // extensions with digests and the role prompt.
        const argv = sessionArgv({ piCommand: "/usr/bin/node", piArgs: ["/lib/cli.js"], coreExtension: "/lib/core.js",
            sessionDir: "/s", workspace: "/w", home: "/h", piAgentDir: "/state/pi" }, {
            society: "demo", provider: "pi", model: "current", extensions: role.extensions.map(e => ({ path: e.path, sha256: e.sha256 })),
            prompt: "role prompt",
        });
        assert.equal(argv[argv.indexOf("--system-prompt") + 1], "role prompt", "the Principal's role prompt replaces Pi's generated system prompt");
        const env = sessionEnv({ HOME: "/h" }, {
            society: "demo", provider: "pi", model: "current", extensions: [],
        }, { piAgentDir: "/state/pi" });
        assert.ok(!("OMA_TOOL_SURFACE" in env), "D23: no authored projection reaches the engine");
        assert.equal(env.PI_CODING_AGENT_DIR, "/state/pi", "the engine stays in OMA's directory");
        // A role without an authored prompt runs on the built-in Principal prompt,
        // not on Pi's generic coding-agent default.
        const bare = sessionArgv({ piCommand: "/usr/bin/node", piArgs: [], coreExtension: "/lib/core.js", sessionDir: "/s", workspace: "/w", home: "/h" }, { society: "demo", provider: "pi", model: "current", extensions: [] });
        assert.equal(bare[bare.indexOf("--system-prompt") + 1], PRINCIPAL_SYSTEM_PROMPT);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
