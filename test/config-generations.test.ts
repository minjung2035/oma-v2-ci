// V13A/V13B/V13C (WP13, D02): managed configuration generations.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfigurationSnapshot, validateConfig, type ConfigurationSnapshot } from "@oma/config";
import { collectManagedGenerations, generationIdOf, managedGenerationOf, MANAGED_DIRECTORY, MANAGED_LIMITS, } from "@oma/config/generations";
import { commitManagedEdit, commitField, readSettings, PRINCIPAL_MODEL } from "#oma-test/app/application/settings";
import { replaceDerivedFile, DurabilityFaultError, type DurabilityFault } from "@oma/storage/durable-fs";
import { StoreError } from "@oma/domain/errors";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
const principalModel = (snapshot: ConfigurationSnapshot): string => snapshot.config.agentProfiles[snapshot.config.principalProfile]!.modelProfile;
const withPrincipalModel = (snapshot: ConfigurationSnapshot, model: string) => validateConfig({ ...snapshot.config,
    agentProfiles: { ...snapshot.config.agentProfiles, principal: { ...snapshot.config.agentProfiles.principal!, modelProfile: model } } });
test("D02 generation identity: golden vectors pin the byte framing", () => {
    // The oracle is the system's sha256sum over the same framed bytes; the local
    // lane forbids a shell, so it is invoked with direct argv on stdin.
    const digestOf = (bytes: string): string => spawnSync("sha256sum", [], { input: bytes, encoding: "utf8" }).stdout.split(" ")[0]!;
    assert.equal(generationIdOf(new Map()), `g-${digestOf("oma-config-generation-v1\n")}`);
    const one = new Map([["host.json", Buffer.from("{}\n")]]);
    assert.equal(generationIdOf(one), `g-${digestOf("oma-config-generation-v1\nhost.json\n3\n{}\n\n")}`);
    // Order is by name bytes, not insertion; content and names both matter.
    const ab = new Map([["b", Buffer.from("2")], ["a", Buffer.from("1")]]);
    const ba = new Map([["a", Buffer.from("1")], ["b", Buffer.from("2")]]);
    assert.equal(generationIdOf(ab), generationIdOf(ba));
    assert.equal(generationIdOf(ab), `g-${digestOf("oma-config-generation-v1\na\n1\n1\nb\n1\n2\n")}`);
    assert.notEqual(generationIdOf(new Map([["a", Buffer.from("12")]])), generationIdOf(new Map([["a", Buffer.from("1")], ["2", Buffer.alloc(0)]])));
});
test("V13A: a crash at any point of a managed commit leaves the complete old or the complete new configuration", () => {
    // Enumerate every durability point one commit passes, then crash at each.
    const probe = createCompleteConfigurationFixture();
    const points: DurabilityFault[] = [];
    try {
        const snapshot = loadConfigurationSnapshot(probe.path);
        commitManagedEdit(snapshot, withPrincipalModel(snapshot, "review"), {}, fault => { points.push(fault); });
    }
    finally {
        probe.close();
    }
    assert.ok(points.length >= 10, `too few durability points observed: ${points.length}`);
    assert.ok(points.some(point => point.point === "derived-rename" && point.path.endsWith("config.json")));
    // Success is reported only after the bundle root holding the manifest is
    // flushed, and the generation directory is flushed before the manifest moves.
    const manifestAt = points.findIndex(point => point.point === "derived-rename" && point.phase === "after-visible" && point.path.endsWith("/operations/config.json"));
    assert.ok(points.slice(manifestAt).some(point => point.point === "directory-fsync" && point.phase === "after-visible" && point.path.endsWith("/operations")), "the manifest's parent is not flushed after its rename");
    const generationAt = points.findIndex(point => point.point === "derived-rename" && point.phase === "after-visible" && /\/generations\/g-[0-9a-f]{64}$/.test(point.path));
    assert.ok(generationAt > 0 && generationAt < manifestAt);
    assert.ok(points.slice(generationAt, manifestAt).some(point => point.point === "directory-fsync" && point.phase === "after-visible" && point.path.endsWith("/.oma-config/generations")), "the renamed generation is not flushed before the manifest names it");
    for (let crash = 0; crash < points.length; crash++) {
        const f = createCompleteConfigurationFixture();
        try {
            const before = loadConfigurationSnapshot(f.path);
            const oldRevision = before.config.integration.policyRevision;
            let seen = 0;
            assert.throws(() => commitManagedEdit(before, withPrincipalModel(before, "review"), {}, fault => {
                if (seen++ === crash)
                    throw new DurabilityFaultError(fault);
            }), DurabilityFaultError);
            const after = loadConfigurationSnapshot(f.path);
            const state = principalModel(after) === "standard" && after.config.integration.policyRevision === oldRevision ? "old"
                : principalModel(after) === "review" && after.config.integration.policyRevision !== oldRevision ? "new" : "mixed";
            assert.notEqual(state, "mixed", `crash at ${JSON.stringify(points[crash])} produced a mixed configuration`);
            // Visible only once the manifest was renamed.
            const published = points.findIndex(point => point.point === "derived-rename" && point.phase === "after-visible" && point.path.endsWith("/operations/config.json"));
            assert.ok(published > 0);
            assert.equal(state, crash >= published ? "new" : "old", `crash ${crash} (${points[crash]!.point}/${points[crash]!.phase})`);
            // Whatever the crash left behind, a fresh edit from the reopened snapshot commits.
            commitManagedEdit(after, withPrincipalModel(after, principalModel(after) === "review" ? "standard" : "review"));
            assert.doesNotThrow(() => loadConfigurationSnapshot(f.path));
        }
        finally {
            f.close();
        }
    }
});
test("D02/P0-8: the managed tail's repair boundary is the first name oma made -- the bundle's own parent is never repaired", () => {
    const f = createCompleteConfigurationFixture();
    try {
        // `f.root` is whichever directory the Human's `--config` happened to place
        // the bundle under -- the user's own, not oma's. A boundary of
        // `dirname(root)` claimed it as oma's: a mode-0555 parent was silently
        // given owner bits it never granted, and a stray at the bundle's own slot
        // was collectible. The boundary is `.oma-config` itself -- the first
        // component oma makes beneath the user's directory -- so the commit still
        // succeeds and the user's parent keeps exactly the mode it had.
        chmodSync(f.root, 0o555);
        const snapshot = loadConfigurationSnapshot(f.path);
        commitManagedEdit(snapshot, withPrincipalModel(snapshot, "review"));
        assert.equal(statSync(f.root).mode & 0o777, 0o555, "a directory above the managed tail is the user's -- never repaired");
    }
    finally {
        f.close();
    }
});
test("D02/P0-8: a stray at the managed tail's boundary slot is refused, never unlinked from a user's directory", () => {
    const f = createCompleteConfigurationFixture();
    try {
        // `.oma-config` names the boundary itself: its parent is the user's bundle
        // directory, so a file or link in the slot is answered with a refusal, not
        // collected the way a stray strictly below the boundary is. The owned
        // ensure's collection used to reach it when the boundary was the bundle's
        // parent -- a user's file at `.oma-config` was unlinked to make room.
        const slot = join(f.output, MANAGED_DIRECTORY);
        const snapshot = loadConfigurationSnapshot(f.path);
        writeFileSync(slot, "the user's own file\n");
        assert.throws(() => loadConfigurationSnapshot(f.path), (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
        assert.throws(() => commitManagedEdit(snapshot, withPrincipalModel(snapshot, "review")), (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
        assert.equal(readFileSync(slot, "utf8"), "the user's own file\n", "a name at the boundary stands");
    }
    finally {
        f.close();
    }
});
test("D02/P0-8: a bundle inside oma's own tree repairs the degraded owned ancestors the caller names", () => {
    const f = createCompleteConfigurationFixture();
    try {
        // `.projects/<project>` beneath the data root stands for a project's
        // settings bundle: `.projects` and `<project>` are oma-owned components
        // above `.oma-config`, and only the layer that placed the bundle inside
        // oma's tree can say so. A mode-000 `<project>` a stray left wedges every
        // read and write the commit makes; the `.oma-config` boundary a user's
        // `--config` bundle must keep refuses to repair it, so the same commit
        // that fails without an oma-owned ancestor commits once the caller names
        // the data root the bundle's tree stands under.
        const projects = join(f.root, ".projects");
        const bundle = join(projects, "demo");
        mkdirSync(projects, { recursive: true });
        renameSync(f.output, bundle);
        const snapshot = loadConfigurationSnapshot(join(bundle, "config.json"));
        chmodSync(bundle, 0o000);
        assert.throws(() => commitManagedEdit(snapshot, withPrincipalModel(snapshot, "review")), (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE", "with no oma-owned ancestor named the refusal stands, exactly as a user's --config is answered");
        const committed = commitManagedEdit(snapshot, withPrincipalModel(snapshot, "review"), {}, undefined, undefined, f.root);
        assert.equal(committed.kind, "committed");
        assert.equal(statSync(bundle).mode & 0o777, 0o700, "a degraded oma-owned ancestor is repaired, never trusted");
        assert.equal(loadConfigurationSnapshot(join(bundle, "config.json")).config.agentProfiles.principal!.modelProfile, "review", "the edit landed after the repair");
    }
    finally {
        f.close();
    }
});
test("V13A negative control: the old role-then-host in-place writer is caught by the mixed-state oracle", () => {
    const f = createCompleteConfigurationFixture();
    try {
        const before = loadConfigurationSnapshot(f.path);
        // The removed writer patched the role file, then host.json; a crash between
        // the two left the new role with the old revision, and it loaded as valid.
        f.edit("roles/principal.json", role => { role.agentProfile.modelProfile = "review"; });
        const after = loadConfigurationSnapshot(f.path);
        assert.equal(principalModel(after), "review");
        assert.equal(after.config.integration.policyRevision, before.config.integration.policyRevision, "mixed state reproduced");
    }
    finally {
        f.close();
    }
});
test("V13B: a manual bundle migrates without touching its files, and a stale or externally changed snapshot is refused", () => {
    const f = createCompleteConfigurationFixture();
    try {
        const manual = readdirSync(join(f.output, "roles")).map(name => [name, readFileSync(join(f.output, "roles", name))] as const);
        const host = readFileSync(join(f.output, "host.json"));
        const stale = readSettings(f.path);
        const first = readSettings(f.path);
        commitField(first, PRINCIPAL_MODEL, "review");
        const migrated = loadConfigurationSnapshot(f.path);
        assert.notEqual(managedGenerationOf(migrated), null, "the manifest names one managed generation");
        assert.equal(principalModel(migrated), "review");
        // Every other effective value is carried over unchanged.
        const { integration: _a, agentProfiles: agentsAfter, ...restAfter } = migrated.config;
        const { integration: _b, agentProfiles: agentsBefore, ...restBefore } = stale.snapshot!.config;
        assert.deepEqual(restAfter, restBefore);
        assert.deepEqual(agentsAfter.resident, agentsBefore.resident);
        assert.deepEqual(agentsAfter.verifier, agentsBefore.verifier);
        for (const [name, bytes] of manual)
            assert.deepEqual(readFileSync(join(f.output, "roles", name)), bytes, `manual ${name} was edited`);
        assert.deepEqual(readFileSync(join(f.output, "host.json")), host);
        // A snapshot read before that commit is refused, and changes nothing.
        const manifest = readFileSync(f.path);
        assert.throws(() => commitField(stale, "initial-workers", 5), (error: unknown) => error instanceof StoreError && error.code === "POLICY_CHANGED");
        assert.deepEqual(readFileSync(f.path), manifest);
        // An external edit of the manifest after a read is refused as well.
        const current = readSettings(f.path);
        writeFileSync(f.path, `${readFileSync(f.path, "utf8")} `);
        assert.throws(() => commitField(current, "initial-workers", 5), (error: unknown) => error instanceof StoreError && error.code === "POLICY_CHANGED");
        // An old writer that patches a generation file in place is refused by the
        // filesystem: published generations are read-only.
        const role = migrated.layout.kind === "operations" ? migrated.layout.roles.principal! : "";
        assert.throws(() => replaceDerivedFile(role, "{}\n"), { code: "EACCES" });
        assert.equal(principalModel(loadConfigurationSnapshot(f.path)), "review");
    }
    finally {
        f.close();
    }
});
test("V13B: a shared manual role expands into per-profile copies with the same effective meaning", () => {
    const f = createCompleteConfigurationFixture();
    try {
        // principal and resident hold identical profiles; point both at one file.
        const index = JSON.parse(readFileSync(f.path, "utf8"));
        index.roles.resident = index.roles.principal;
        writeFileSync(f.path, JSON.stringify(index));
        const shared = loadConfigurationSnapshot(f.path);
        commitManagedEdit(shared, validateConfig({ ...shared.config, limits: { ...shared.config.limits, logBytes: 6 } }));
        const expanded = loadConfigurationSnapshot(f.path);
        assert.equal(expanded.layout.kind, "operations");
        if (expanded.layout.kind !== "operations")
            return;
        assert.notEqual(expanded.layout.roles.principal, expanded.layout.roles.resident, "profiles still share one file");
        assert.deepEqual(expanded.config.agentProfiles, shared.config.agentProfiles);
        assert.deepEqual(expanded.roles, shared.roles);
        assert.equal(expanded.config.limits.logBytes, 6);
    }
    finally {
        f.close();
    }
});
test("V13B: a same-semantic save publishes nothing", () => {
    const f = createCompleteConfigurationFixture();
    try {
        const snapshot = loadConfigurationSnapshot(f.path);
        const manifest = readFileSync(f.path);
        assert.equal(commitManagedEdit(snapshot, snapshot.config).kind, "unchanged");
        assert.deepEqual(readFileSync(f.path), manifest);
        assert.equal(existsSync(join(f.output, MANAGED_DIRECTORY)), false);
    }
    finally {
        f.close();
    }
});
test("V13B: an explicit export writes a flat manual bundle to a new directory with the same meaning", () => {
    const f = createCompleteConfigurationFixture();
    try {
        const snapshot = loadConfigurationSnapshot(f.path);
        commitManagedEdit(snapshot, withPrincipalModel(snapshot, "review"));
        const managed = loadConfigurationSnapshot(f.path);
        const target = join(f.root, "exported");
        const exported = spawnSync(process.execPath, ["scripts/export-operations-config.mjs", f.path, target], { encoding: "utf8" });
        assert.equal(exported.status, 0, exported.stderr);
        const flat = loadConfigurationSnapshot(join(target, "config.json"));
        assert.equal(managedGenerationOf(flat), null);
        assert.deepEqual(flat.config, managed.config);
        assert.deepEqual(flat.roles, managed.roles);
        const again = spawnSync(process.execPath, ["scripts/export-operations-config.mjs", f.path, target], { encoding: "utf8" });
        assert.equal(again.status, 2, "an existing destination is never overwritten");
        assert.deepEqual(loadConfigurationSnapshot(join(target, "config.json")).config, managed.config);
    }
    finally {
        f.close();
    }
});
test("V13C: the edit budget refuses at exhaustion, and quiescent collection keeps the current and previous generations only", () => {
    const f = createCompleteConfigurationFixture();
    try {
        const limits = { generations: 4, bytes: MANAGED_LIMITS.bytes };
        const committed: string[] = [];
        for (let agents = 1; agents <= limits.generations; agents++) {
            const snapshot = loadConfigurationSnapshot(f.path);
            const result = commitManagedEdit(snapshot, validateConfig({ ...snapshot.config, limits: { ...snapshot.config.limits, logBytes: agents + 4 } }), {}, undefined, limits);
            assert.equal(result.kind, "committed");
            committed.push(result.generation!);
        }
        const full = loadConfigurationSnapshot(f.path);
        const manifest = readFileSync(f.path);
        assert.throws(() => commitManagedEdit(full, validateConfig({ ...full.config, limits: { ...full.config.limits, logBytes: 99 } }), {}, undefined, limits), (error: unknown) => error instanceof StoreError && error.code === "LIMIT_EXCEEDED");
        assert.deepEqual(readFileSync(f.path), manifest, "a refused edit changes nothing");
        // A byte budget refuses too, before anything is written.
        const tight = { generations: 100, bytes: 1 };
        assert.throws(() => commitManagedEdit(full, validateConfig({ ...full.config, limits: { ...full.config.limits, logBytes: 98 } }), {}, undefined, tight), (error: unknown) => error instanceof StoreError && error.code === "LIMIT_EXCEEDED");
        const generations = join(f.output, MANAGED_DIRECTORY, "generations");
        // Age alone never selects: make the current generation the oldest on disk.
        utimesSync(join(generations, committed.at(-1)!), new Date(0), new Date(0));
        const staging = join(generations, ".staging-leftover");
        spawnSync("mkdir", ["-p", join(staging, "roles")]);
        spawnSync("chmod", ["0500", staging]);
        const leftover = join(f.output, ".config.json.00000000-0000-4000-8000-000000000000.tmp");
        writeFileSync(leftover, "{}");
        const unrelated = join(f.output, ".config.json.backup");
        writeFileSync(unrelated, "keep");
        const removed = collectManagedGenerations(full);
        assert.equal(existsSync(leftover), false, "a crashed commit's manifest temporary is swept");
        assert.equal(readFileSync(unrelated, "utf8"), "keep", "only this writer's temporaries are swept");
        assert.deepEqual(new Set(readdirSync(generations)), new Set(committed.slice(-2)));
        assert.ok(removed.includes(".staging-leftover"));
        assert.deepEqual(loadConfigurationSnapshot(f.path).config, full.config, "collection changed what the manifest names");
        // Authored manual files and anything outside the generation store remain.
        assert.ok(existsSync(join(f.output, "host.json")) && existsSync(join(dirname(generations), "committed-v2")));
        // Room again: the next edit commits.
        const next = commitManagedEdit(full, validateConfig({ ...full.config, limits: { ...full.config.limits, logBytes: 99 } }), {}, undefined, limits);
        assert.equal(next.kind, "committed");
    }
    finally {
        f.close();
    }
});
test("V13B / CFG-005: a role-only change (extension selection) is a new policy revision", () => {
    const f = createCompleteConfigurationFixture();
    try {
        spawnSync("mkdir", ["-p", join(f.installation, "extensions")]);
        writeFileSync(join(f.installation, "extensions", "extra.js"), "export {};\n");
        const snapshot = loadConfigurationSnapshot(f.path);
        const before = snapshot.config.integration.policyRevision;
        const core = snapshot.authoredRoles.resident!.value.extensions as string[];
        assert.equal(commitManagedEdit(snapshot, snapshot.config, { resident: { extensions: [...core, "extensions/extra.js"] } }).kind, "committed");
        const after = loadConfigurationSnapshot(f.path);
        assert.notEqual(after.config.integration.policyRevision, before, "an extension selection change kept the old policy revision");
        assert.deepEqual(after.authoredRoles.resident!.value.extensions, [...core, "extensions/extra.js"]);
        // And back: another new revision, not the manual one.
        assert.equal(commitManagedEdit(after, after.config, { resident: { extensions: core } }).kind, "committed");
        assert.notEqual(loadConfigurationSnapshot(f.path).config.integration.policyRevision, after.config.integration.policyRevision);
    }
    finally {
        f.close();
    }
});
