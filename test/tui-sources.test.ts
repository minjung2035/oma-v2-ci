import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { AgentStatus, HostConfig } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import { INITIAL_WORKERS, PRINCIPAL_MODEL, WORKER_MODEL, WORKER_PROFILE, applyField, fieldsOf, readSettings, revisionFor, settingsOf, writeSettings, } from "#oma-test/app/application/settings";
import { CORE_EXTENSION, nextEntries, readExtensions, toggleExtension } from "#oma-test/app/application/extensions";
import { parseMessage, principalMailbox, readBody, readMailbox, unreadCount } from "#oma-test/app/application/mail";
import { dashboardData, type DashboardInput } from "@oma/tui/dashboard";
import { dashboardRows } from "@oma/tui/view/dashboard";
/** Observation to words: the data layer interprets, the view words it. These
 * tests hold the whole chain, so a regression in either layer shows here. */
const dashboardLines = (input: DashboardInput) => dashboardRows(dashboardData(input));
import { TuiTransport } from "#oma-test/app/application/status-observation";
import { STATUS_STALE_MS, encodeStatusView, statusViewPath } from "@oma/protocol/status-view";
import { sessionArgv } from "@oma/engine/principal-session";
function digest(text: string): string { return createHash("sha256").update(text).digest("hex"); }
function config(root: string): HostConfig {
    return {
        schemaVersion: 4,
        society: "demo",
        installation: { node: process.execPath, libdir: root,  deploymentDigest: digest("d") },
        modelProfiles: {
            cheap: { provider: "p", model: "cheap", inferenceTimeoutSeconds: 1 },
            strong: { provider: "p", model: "strong", inferenceTimeoutSeconds: 1 },
        },
        agentProfiles: {
            principal: { modelProfile: "strong", capabilities: [], delegable: [], childProfile: "resident" },
            resident: { modelProfile: "cheap", capabilities: [], delegable: [], childProfile: null },
        },
        principalProfile: "principal",
        initialResidents: [{ name: "a", profile: "resident", brief: "seed a" }, { name: "b", profile: "resident", brief: "seed b" }],
        integration: { policyRevision: "rev-initial", protectedPaths: [], checks: [] },
        limits: {
            frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64, replyReferences: 64,
            contextFiles: 256, contextBytes: 8388608, bundleBytes: 268435456, logBytes: 1048576,
            batchMaxMessages: 24, idleStreamSeconds: 1, receiptWaitSeconds: 1,
        }
    };
}
function scratch(prefix: string): string { return mkdtempSync(join(tmpdir(), prefix)); }
test("T93/TUI-005,009: a Principal model change rewrites only its profile reference", () => {
    const root = scratch("oma-tui-settings-");
    try {
        const settings = settingsOf(join(root, "config.json"), config(root));
        assert.equal(settings.workerProfile, "resident");
        const principalChanged = applyField(settings, PRINCIPAL_MODEL, "cheap");
        assert.equal(principalChanged.agentProfiles["principal"]!.modelProfile, "cheap");
        // TUI-009: an existing Resident keeps its own frozen reference.
        assert.equal(principalChanged.agentProfiles["resident"]!.modelProfile, "cheap");
        assert.deepEqual(principalChanged.limits, settings.config.limits);
        assert.deepEqual(principalChanged.initialResidents, settings.config.initialResidents);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("T93/TUI-005: an undeclared model or profile name is refused, not coerced", () => {
    const root = scratch("oma-tui-settings-");
    try {
        const settings = settingsOf(join(root, "config.json"), config(root));
        for (const [field, value] of [[PRINCIPAL_MODEL, "invented"], [WORKER_MODEL, "invented"], [WORKER_PROFILE, "nope"]] as const)
            assert.throws(() => applyField(settings, field, value), (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE");
        assert.throws(() => applyField(settings, "not-a-field", 1), (error: unknown) => error instanceof StoreError && error.code === "INVALID_REQUEST");
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("T94/TUI-007: writing settings replaces config.json atomically with a fresh policy revision", () => {
    const root = scratch("oma-tui-write-");
    try {
        const path = join(root, "config.json");
        const original = config(root);
        writeFileSync(path, JSON.stringify(original, null, 2));
        const before = readSettings(path);
        assert.equal(before.config.integration.policyRevision, "rev-initial");
        const written = writeSettings(path, applyField(before, INITIAL_WORKERS, 12));
        const reloaded = readSettings(path);
        assert.equal(reloaded.config.initialResidents.length, 12);
        assert.notEqual(reloaded.config.integration.policyRevision, "rev-initial");
        assert.equal(reloaded.config.integration.policyRevision, written.integration.policyRevision);
        // Deterministic: the same content yields the same revision, so a no-op
        // rewrite does not churn the policy identity.
        assert.equal(revisionFor(applyField(before, INITIAL_WORKERS, 12)), revisionFor(applyField(before, INITIAL_WORKERS, 12)));
        assert.notEqual(revisionFor(applyField(before, INITIAL_WORKERS, 12)), revisionFor(applyField(before, INITIAL_WORKERS, 13)));
        assert.equal(JSON.parse(readFileSync(path, "utf8")).initialResidents.length, 12);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("T96/TUI-008: Initial workers is bootstrap seed only and never touches the running quota", () => {
    const root = scratch("oma-tui-seed-");
    try {
        const settings = settingsOf(join(root, "config.json"), config(root));
        const seedField = settings.fields.find(field => field.id === INITIAL_WORKERS)!;
        assert.equal(seedField.kind === "number" && seedField.apply, "bootstrap-only");
        const grown = applyField(settings, INITIAL_WORKERS, 4);
        assert.equal(grown.initialResidents.length, 4);
        assert.deepEqual(grown.limits, settings.config.limits);
        assert.deepEqual(grown.initialResidents.slice(0, 2), settings.config.initialResidents);
        assert.equal(new Set(grown.initialResidents.map(resident => resident.name)).size, 4);
        const shrunk = applyField(settings, INITIAL_WORKERS, 1);
        assert.deepEqual(shrunk.initialResidents, settings.config.initialResidents.slice(0, 1));
        assert.deepEqual(shrunk.limits, settings.config.limits);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("T96/TUI-007: every exposed field declares an apply scope that matches its real effect", () => {
    const root = scratch("oma-tui-scope-");
    try {
        const fields = fieldsOf(config(root), "resident");
        const scopes = new Map(fields.flatMap(field => (field.kind === "link" ? [] : [[field.id, field.apply] as const])));
        assert.equal(scopes.get(PRINCIPAL_MODEL), "next-session");
        assert.equal(scopes.get(WORKER_MODEL), "next-activation");
        assert.equal(scopes.get("worker-limit"), undefined);
        assert.equal(scopes.get(INITIAL_WORKERS), "bootstrap-only");
        // The Config screen never offers to run Residents as the Principal.
        const profileField = fields.find(field => field.id === WORKER_PROFILE)!;
        assert.ok(profileField.kind === "choice" && !profileField.options.includes("principal"));
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("T97/TUI-010: the core extension stays first and selection is confined to libdir", () => {
    const fixture = createCompleteConfigurationFixture();
    try {
        const extensionDir = join(fixture.installation, "extensions");
        mkdirSync(extensionDir, { recursive: true });
        writeFileSync(join(extensionDir, "review.js"), "export {};\n");
        writeFileSync(join(extensionDir, "browser.js"), "export {};\n");
        fixture.edit("roles/resident.json", role => {
            role.extensions = [CORE_EXTENSION, "extensions/review.js"];
        });
        const settings = readSettings(fixture.path);
        const context = readExtensions(settings.snapshot!, "principal", "resident");
        assert.equal(context.editable, true);
        assert.equal(context.rows[0]!.id, CORE_EXTENSION);
        assert.equal(context.rows[0]!.locked, true);
        const review = context.rows.find(row => row.id === "extensions/review.js")!;
        assert.equal(review.principal, false);
        assert.equal(review.workers, true);
        assert.ok(context.rows.some(row => row.id === "extensions/browser.js"), "host-placed file is offered");
        const principalPath = context.roles.find(role => role.name === "principal")!.path;
        const authored = readFileSync(principalPath, "utf8");
        toggleExtension(context, "extensions/review.js", "principal", true);
        // D02/WP13: the change is a new managed generation the loader reads; the
        // manual role file the bundle was migrated from is kept as it was.
        const extensionsOf = () => readSettings(fixture.path).snapshot!.authoredRoles.principal!.value.extensions as string[];
        assert.deepEqual(extensionsOf(), [CORE_EXTENSION, "extensions/review.js"]);
        assert.equal(readFileSync(principalPath, "utf8"), authored);
        const current = readExtensions(readSettings(fixture.path).snapshot!, "principal", "resident");
        toggleExtension(current, CORE_EXTENSION, "principal", false);
        assert.equal(extensionsOf()[0], CORE_EXTENSION);
        assert.throws(() => toggleExtension(current, "extensions/missing.js", "workers", true), (error: unknown) => error instanceof StoreError && error.code === "INVALID_REQUEST");
        // The context read before the first toggle is stale now: it is refused.
        assert.throws(() => toggleExtension(context, "extensions/browser.js", "workers", true), (error: unknown) => error instanceof StoreError && error.code === "POLICY_CHANGED");
    }
    finally {
        fixture.close();
    }
});
test("T97/TUI-010: an inline config exposes only the locked core and refuses edits", () => {
    const root = scratch("oma-tui-inline-");
    try {
        const path = join(root, "config.json");
        writeFileSync(path, JSON.stringify(config(root), null, 2));
        const context = readExtensions(path, "principal", "resident");
        assert.equal(context.editable, false);
        assert.deepEqual(context.rows.map(row => row.id), [CORE_EXTENSION]);
        assert.equal(context.rows[0]!.locked, true);
        assert.throws(() => toggleExtension(context, "extensions/x.js", "principal", true), (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE");
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("TUI-010/WP14.04: the written entry list keeps the core first, stays deduplicated and keeps the authored order", () => {
    assert.deepEqual(nextEntries([CORE_EXTENSION], "extensions/b.js", true), [CORE_EXTENSION, "extensions/b.js"]);
    // Enabling appends; it does not re-sort what the host authored.
    assert.deepEqual(nextEntries([CORE_EXTENSION, "extensions/b.js"], "extensions/a.js", true), [CORE_EXTENSION, "extensions/b.js", "extensions/a.js"]);
    assert.deepEqual(nextEntries([CORE_EXTENSION, "extensions/z.js", "extensions/a.js", "extensions/m.js"], "extensions/a.js", false), [CORE_EXTENSION, "extensions/z.js", "extensions/m.js"]);
    assert.deepEqual(nextEntries([CORE_EXTENSION, "extensions/a.js"], "extensions/a.js", true), [CORE_EXTENSION, "extensions/a.js"]);
    assert.deepEqual(nextEntries([CORE_EXTENSION], CORE_EXTENSION, false), [CORE_EXTENSION]);
});
test("T98/TUI-011: unread comes from the mailbox position, and no read state is written", () => {
    const root = scratch("oma-tui-mail-");
    try {
        const box = principalMailbox(root);
        mkdirSync(box.newDir, { recursive: true });
        mkdirSync(box.curDir, { recursive: true });
        const eml = (subject: string, kind: string): string => ["From: worker-a@demo.oma.invalid", `Subject: ${subject}`, `X-OMA-Kind: ${kind}`, "", "본문입니다.", ""].join("\n");
        writeFileSync(join(box.newDir, "m-1"), eml("API 선택 필요", "question"));
        writeFileSync(join(box.curDir, "m-2:2,"), eml("구현 완료", "result"));
        const rows = readMailbox(box).rows;
        assert.equal(rows.length, 2);
        const unread = rows.filter(row => row.unread);
        assert.deepEqual(unread.map(row => row.id), ["m-1"]);
        assert.equal(unreadCount(box), 1);
        assert.equal(rows.find(row => row.id === "m-1")!.kind, "question");
        assert.equal(rows.find(row => row.id === "m-1")!.from, "worker-a");
        assert.deepEqual(readBody(join(box.newDir, "m-1"), 4096), { text: "본문입니다.\n", truncated: false });
        // Reading must not move, rename or create anything.
        const before = [...readMailbox(box).rows];
        readMailbox(box);
        readBody(join(box.newDir, "m-1"), 4096);
        assert.deepEqual(readMailbox(box).rows, before);
        assert.equal(unreadCount(box), 1);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("B4: mail rows name parties by the roster, and keep the header's names without one", () => {
    const root = scratch("oma-tui-names-");
    try {
        const box = principalMailbox(root);
        mkdirSync(box.newDir, { recursive: true });
        mkdirSync(box.curDir, { recursive: true });
        const eml = (from: string, to: string | null): string => [`From: ${from}`, ...(to === null ? [] : [`To: ${to}`]), "Subject: 제목", "X-OMA-Kind: message", "", "body", ""].join("\n");
        writeFileSync(join(box.newDir, "m-1"), eml("worker-a@demo.oma.invalid", "residents@demo.oma.invalid"));
        writeFileSync(join(box.newDir, "m-2"), eml("worker-b@demo.oma.invalid", "worker-b@demo.oma.invalid, worker-a@demo.oma.invalid"));
        writeFileSync(join(box.newDir, "m-3"), eml("worker-c@demo.oma.invalid", "topic-plan@demo.oma.invalid, principal@demo.oma.invalid"));
        writeFileSync(join(box.newDir, "m-4"), eml("principal@demo.oma.invalid", null));
        const rows = readMailbox(box, ["principal", "worker-a", "worker-b"]).rows;
        const byId = new Map(rows.map(row => [row.id, row]));
        assert.equal(byId.get("m-1")!.from, "worker-a");
        assert.equal(byId.get("m-1")!.to, "residents");
        assert.equal(byId.get("m-2")!.from, "worker-b");
        assert.equal(byId.get("m-2")!.to, "worker-b, worker-a");
        // An actor the roster does not know keeps its name; a topic keeps its label.
        assert.equal(byId.get("m-3")!.from, "worker-c");
        assert.equal(byId.get("m-3")!.to, "topic/plan, principal");
        assert.equal(byId.get("m-4")!.from, "principal");
        assert.equal(byId.get("m-4")!.to, undefined, "no To header: no recipients line");
        // Without an observed roster the fixed names still map -- a broadcast is
        // `worker` by the mail protocol, not by the roster -- but no worker is
        // numbered: actors keep the names the header wrote.
        const raw = readMailbox(box).rows;
        const rawById = new Map(raw.map(row => [row.id, row]));
        assert.equal(rawById.get("m-1")!.from, "worker-a");
        assert.equal(rawById.get("m-1")!.to, "residents");
        assert.equal(rawById.get("m-2")!.to, "worker-b, worker-a");
        assert.equal(rawById.get("m-3")!.to, "topic/plan, principal");
        assert.equal(rawById.get("m-4")!.to, undefined);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("AV-11: arrival order comes from the journal; inode times are only its fallback", () => {
    const root = scratch("oma-tui-arrival-");
    try {
        const box = principalMailbox(root);
        mkdirSync(box.newDir, { recursive: true });
        const eml = (id: string, subject: string): string => ["From: worker-a@demo.oma.invalid", `Subject: ${subject}`, "X-OMA-Kind: message",
            `Message-ID: <${id}@demo.oma.invalid>`, "", "body", ""].join("\n");
        const a = "m-aaaaaaaa-0000-4000-8000-0000000000aa-0";
        const b = "m-bbbbbbbb-0000-4000-8000-0000000000bb-0";
        const at = (name: string, seconds: number): void => {
            const path = join(box.newDir, name);
            writeFileSync(path, eml(name, name));
            const when = new Date(2026, 0, 1, 0, 0, seconds);
            utimesSync(path, when, when);
        };
        at(a, 10);
        at(b, 20); // inode mtimes say b is newer
        // No journal yet (pre-AV-11 mailbox): inode times order the rows.
        assert.deepEqual(readMailbox(box).rows.map(row => row.id), [b, a]);
        // The journal says a arrived last -- its time is the link's, not the object's.
        const journal = join(root, "mail", "inboxes", "principal", "arrival");
        writeFileSync(journal, `1000 ${b}\n2000 ${a}\n`);
        assert.deepEqual(readMailbox(box).rows.map(row => row.id), [a, b]);
        // A republished link takes the newest line for its id.
        writeFileSync(journal, `1000 ${b}\n2000 ${a}\n3000 ${b}\n`);
        assert.deepEqual(readMailbox(box).rows.map(row => row.id), [b, a]);
        // A journal that cannot be read is reported, never silently treated as empty.
        chmodSync(journal, 0o000);
        assert.ok(readMailbox(box).unreadable !== null);
        chmodSync(journal, 0o600);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("mail-v1 / spec §6: a thread folds into the latest arrival's row; earlier revisions stay reachable", () => {
    const root = scratch("oma-tui-thread-");
    try {
        const box = principalMailbox(root);
        mkdirSync(box.newDir, { recursive: true });
        mkdirSync(box.curDir, { recursive: true });
        const rfc = (id: string) => `<${id}@demo.oma.invalid>`;
        const eml = (id: string, subject: string, references: string[]): string => ["From: principal-society@demo.oma.invalid", `Subject: ${subject}`, "X-OMA-Kind: message",
            `Message-ID: ${rfc(id)}`, ...(references.length ? [`References: ${references.map(rfc).join(" ")}`] : []), "", "body", ""].join("\n");
        // Three revisions of one request's thread: root, reply, reply-to-reply.
        // The middle one is already read (cur/), the rest are new.
        const write = (dir: string, name: string, text: string, seconds: number): void => {
            const path = join(dir, name);
            writeFileSync(path, text);
            const when = new Date(2026, 0, 1, 0, 0, seconds);
            utimesSync(path, when, when);
        };
        write(box.curDir, "m-aaaaaaaa-0000-4000-8000-000000000001-0:2,", eml("m-aaaaaaaa-0000-4000-8000-000000000001-0", "[merge-deadbeef-0000-4000-8000-000000000000] change (rev 0)", []), 1);
        write(box.newDir, "m-bbbbbbbb-0000-4000-8000-000000000002-0", eml("m-bbbbbbbb-0000-4000-8000-000000000002-0", "[merge-deadbeef-0000-4000-8000-000000000000] change (rev 1)", ["m-aaaaaaaa-0000-4000-8000-000000000001-0"]), 2);
        write(box.newDir, "m-cccccccc-0000-4000-8000-000000000003-0", eml("m-cccccccc-0000-4000-8000-000000000003-0", "[merge-deadbeef-0000-4000-8000-000000000000] change (rev 2)", ["m-aaaaaaaa-0000-4000-8000-000000000001-0", "m-bbbbbbbb-0000-4000-8000-000000000002-0"]), 3);
        write(box.newDir, "m-dddddddd-0000-4000-8000-000000000004-0", eml("m-dddddddd-0000-4000-8000-000000000004-0", "an unrelated mail", []), 4);
        const rows = readMailbox(box).rows;
        assert.equal(rows.length, 2, "four messages fold into two rows");
        const folded = rows.find(row => row.id === "m-cccccccc-0000-4000-8000-000000000003-0")!;
        assert.ok(folded, "the latest revision is the row");
        assert.equal(folded.threadCount, 3);
        assert.equal(folded.unread, true, "an unread member keeps the row unread");
        assert.deepEqual(folded.earlier!.length, 2);
        assert.ok(folded.earlier![0]!.includes("m-aaaaaaaa"), "the earliest revision is listed first");
        assert.ok(folded.earlier![1]!.includes("m-bbbbbbbb"));
        assert.equal(rows.find(row => row.id === "m-dddddddd-0000-4000-8000-000000000004-0")!.threadCount, 1);
        // The fold never moves, renames or writes files.
        assert.equal(readMailbox(box).rows.length, 2);
        assert.equal(unreadCount(box), 3, "delivery facts are untouched: three unread messages remain");
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("TUI-011: folded and encoded headers are read without truncating the subject", () => {
    const encoded = Buffer.from("긴 제목", "utf8").toString("base64");
    const parsed = parseMessage([
        "From: a@demo.oma.invalid",
        `Subject: =?UTF-8?B?${encoded}?=`,
        "References: <one@x>",
        "  <two@x>",
        "",
        "body",
    ].join("\n"));
    assert.equal(parsed.headers["subject"], "긴 제목");
    assert.equal(parsed.headers["references"], "<one@x> <two@x>");
    assert.equal(parsed.body, "body");
});
test("T98/TUI-012: the Dashboard keeps an unobserved value unknown instead of guessing", () => {
    const root = scratch("oma-tui-dash-");
    try {
        const cfg = config(root);
        const unknownLines = dashboardLines({
            config: cfg, principalModel: { configured: "strong", session: null }, unread: 2,
            observation: { kind: "unknown", reason: "principal 실행 endpoint 없음", observedAtMs: Date.UTC(2026, 8, 18) },
        });
        const byLabel = new Map(unknownLines.map(line => [line.label, line.value]));
        for (const label of ["Active", "Pending", "Status"]) {
            assert.match(byLabel.get(label)!, /^unknown \(/, `${label} must stay unknown`);
            assert.doesNotMatch(byLabel.get(label)!, /^(0|Ready|inactive)$/);
        }
        // A configured seed count must not be presented as a running count.
        assert.match(byLabel.get("Workers")!, /configured/);
        assert.match(byLabel.get("Usage")!, /^unknown/);
        // WP28, P0V-66: what waits for the Principal's session is the ledger's
        // count, unknown here; the mailbox says only what arrived in no batch yet.
        assert.match(byLabel.get("Mail")!, /^unknown \(principal 실행 endpoint 없음; [0-9:]+ observed\) · 2 new arrivals$/);
        const observed = dashboardLines({
            config: cfg, principalModel: { configured: "strong", session: null }, unread: 0,
            observation: {
                kind: "observed", observedAtMs: Date.UTC(2026, 8, 18),
                statuses: [
                    { agent: "a", desired: "enabled", activeState: "active", subState: null, unitResult: null, execMainStatus: null, pending: 1, preparedBatches: 0, reason: null, runnerObservedAtMs: null },
                    { agent: "b", desired: "stopped", activeState: "inactive", subState: null, unitResult: null, execMainStatus: null, pending: 2, preparedBatches: 0, reason: null, runnerObservedAtMs: null },
                    { agent: "principal", desired: "enabled", activeState: "active", subState: null, unitResult: null, execMainStatus: null, pending: 0, preparedBatches: 0, reason: null, runnerObservedAtMs: null },
                ],
            },
        });
        const observedByLabel = new Map(observed.map(line => [line.label, line.value]));
        assert.equal(observedByLabel.get("Active"), "1");
        assert.equal(observedByLabel.get("Workers"), "2 created");
        assert.match(observedByLabel.get("Pending")!, /^3 \(/);
        assert.match(observedByLabel.get("Status")!, /^observed \(/);
        assert.match(observedByLabel.get("Mail")!, /^0 pending delivery to the Principal session \([0-9:]+ observed\) · 0 new arrivals$/);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("P0V-66 / R11, P0-5: mail in a batch prepared while the session was in a turn still waits for it", () => {
    const root = scratch("oma-tui-prepared-");
    try {
        // The batch was prepared -- its two messages left new/ for cur/ -- and the
        // session, in a turn, has not taken it: the ledger still counts them.
        const lines = dashboardLines({
            config: config(root), principalModel: { configured: "strong", session: null }, unread: 0,
            observation: { kind: "observed", observedAtMs: Date.UTC(2026, 8, 27), statuses: [
                    { agent: "principal", desired: "enabled", activeState: null, subState: null, unitResult: null, execMainStatus: null,
                        pending: 2, preparedBatches: 1, reason: null, runnerObservedAtMs: null }
                ] },
        });
        const mail = new Map(lines.map(line => [line.label, line.value])).get("Mail")!;
        assert.match(mail, /^2 pending delivery to the Principal session /, "prepared mail was shown as delivered");
        assert.match(mail, /0 new arrivals$/);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("TUI-012/SB-002-E: the Dashboard states required confinement without claiming an observed execution", () => {
    const root = scratch("oma-tui-sandbox-");
    try {
        const lines = dashboardLines({
            config: config(root), principalModel: { configured: "strong", session: null }, unread: 0,
            observation: { kind: "unknown", reason: "no live observation", observedAtMs: Date.UTC(2026, 8, 18) },
        });
        const sandbox = new Map(lines.map(entry => [entry.label, entry.value])).get("Sandbox")!;
        assert.equal(sandbox, "Required");
        assert.doesNotMatch(sandbox, /Confined|Running|rootfs|Unconfined/);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test("TUI-021: the Dashboard reads the broker's status view and never invents one", async () => {
    const root = scratch("oma-tui-view-");
    try {
        let clock = Date.UTC(2026, 8, 19, 12, 0, 0);
        const transport = new TuiTransport(root, "demo", 65536, () => clock);
        // No broker has published anything: unknown, with the reason.
        const absent = await transport.status();
        assert.equal(absent.kind, "unknown");
        assert.match((absent as {
            reason: string;
        }).reason, /No broker observation/);
        const row: AgentStatus = { agent: "a", desired: "enabled", activeState: "active", subState: "running",
            unitResult: "success", execMainStatus: 0, pending: 2, preparedBatches: 0, reason: null, runnerObservedAtMs: null };
        writeFileSync(statusViewPath(root), encodeStatusView("demo", { observedAtMs: clock, agents: [row] }));
        const fresh = await transport.status();
        assert.equal(fresh.kind, "observed");
        assert.equal((fresh as {
            statuses: readonly unknown[];
        }).statuses.length, 1);
        // A broker that stopped publishing is not a quiet broker.
        clock += STATUS_STALE_MS + 1;
        const stale = await transport.status();
        assert.equal(stale.kind, "unknown");
        assert.match((stale as {
            reason: string;
        }).reason, /stale/);
        // The last real observation time is kept so the screen can show its age.
        assert.equal(stale.observedAtMs, clock - STATUS_STALE_MS - 1);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("TUI-021: a malformed or foreign status view is unknown, not partially shown", async () => {
    const root = scratch("oma-tui-view-bad-");
    try {
        const now = Date.UTC(2026, 8, 19);
        const transport = new TuiTransport(root, "demo", 65536, () => now);
        const good: AgentStatus = { agent: "a", desired: "enabled", activeState: null, subState: null, unitResult: null,
            execMainStatus: null, pending: 0, preparedBatches: 0, reason: null, runnerObservedAtMs: null };
        for (const [label, body] of [
            ["not json", "{"],
            ["other society", encodeStatusView("other", { observedAtMs: now, agents: [good] })],
            ["negative pending", encodeStatusView("demo", { observedAtMs: now, agents: [{ ...good, pending: -1 }] })],
            ["unknown schema", JSON.stringify({ schema: 2, society: "demo", observedAtMs: now, agents: [] })],
            ["unknown desired state", JSON.stringify({ schema: 1, society: "demo", observedAtMs: now, agents: [{ ...good, desired: "ready" }] })],
            ["no time", JSON.stringify({ schema: 1, society: "demo", agents: [] })],
        ] as const) {
            writeFileSync(statusViewPath(root), body);
            const observed = await transport.status();
            assert.equal(observed.kind, "unknown", `${label} was shown as observed`);
        }
        // Oversized: larger than one frame is not a view the broker wrote.
        writeFileSync(statusViewPath(root), " ".repeat(70000));
        assert.equal((await transport.status()).kind, "unknown");
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("T92/TUI-004,014: the Principal session runs Pi in RPC mode; OMA suppresses only extension discovery", () => {
    const argv = sessionArgv({ piCommand: "/usr/bin/pi", coreExtension: "/lib/core.js", sessionDir: "/s", workspace: "/w", home: "/h" }, { society: "demo", provider: "pi", model: "current", extensions: [{ path: "/lib/core.js", sha256: "0".repeat(64) }, { path: "/lib/review.js", sha256: "1".repeat(64) }] });
    assert.equal(argv[0], "--mode");
    assert.equal(argv[1], "rpc");
    for (const flag of ["--no-approve", "--no-extensions"])
        assert.ok(argv.includes(flag), `missing ${flag}`);
    // C15–C17: context files, skills and prompt templates are Pi's ordinary
    // surface; the core extension filters them rather than OMA suppressing the
    // loader's discovery of them.
    for (const flag of ["--no-context-files", "--no-skills", "--no-prompt-templates"])
        assert.ok(!argv.includes(flag), `${flag} must not be passed`);
    assert.equal(argv[argv.indexOf("--exclude-tools") + 1], "bash,powershell,write,edit");
    // provider=pi/model=current uses the existing connection rather than pinning a model.
    assert.ok(!argv.includes("--model"));
    // The core extension is passed once, not duplicated by the profile list.
    assert.equal(argv.filter(entry => entry === "/lib/core.js").length, 1);
    assert.ok(argv.includes("/lib/review.js"));
    const pinned = sessionArgv({ piCommand: "/usr/bin/pi", coreExtension: "/lib/core.js", sessionDir: "/s", workspace: "/w", home: "/h" }, { society: "demo", provider: "openai-codex", model: "gpt", extensions: [] });
    assert.equal(pinned[pinned.indexOf("--model") + 1], "openai-codex/gpt");
});
test("DR27/CREATE-003: obsolete Worker quota is absent from settings", () => {
    const root = scratch("oma-total-workers-");
    try {
        assert.equal(fieldsOf(config(root), "resident").some(field => field.id === "worker-limit"), false);
        assert.throws(() => applyField(settingsOf(join(root, "config.json"), config(root)), "worker-limit", 12), { code: "INVALID_REQUEST" });
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
for (const desired of ["provisioning", "enabled", "stopped", "retired"] as const)
    for (const activeState of ["active", "inactive"] as const)
        test(`DR27/CREATE-003: ${desired}/${activeState} consumes one created slot; activity stays a separate observation`, () => {
            const cfg = config("/fixture");
            const status: AgentStatus = { agent: "worker", desired, activeState, subState: null, unitResult: null, execMainStatus: null,
                pending: 0, preparedBatches: 0, reason: null, runnerObservedAtMs: null };
            const rows = new Map(dashboardLines({ config: cfg, principalModel: { configured: "strong", session: null }, unread: 0,
                observation: { kind: "observed", observedAtMs: 0, statuses: [status, { ...status, agent: "principal" }] },
            }).map(row => [row.label, row.value]));
            assert.equal(rows.get("Workers"), "1 created");
            assert.equal(rows.get("Active"), activeState === "active" ? "1" : "0");
        });
test("DR27/P0-5: an unknown unit does not erase its created slot or invent active capacity", () => {
    const status: AgentStatus = { agent: "worker", desired: "enabled", activeState: null, subState: null, unitResult: null,
        execMainStatus: null, pending: 0, preparedBatches: 0, reason: "Unit unavailable", runnerObservedAtMs: null };
    const rows = new Map(dashboardLines({ config: config("/fixture"), principalModel: { configured: "strong", session: null }, unread: 0,
        observation: { kind: "observed", observedAtMs: 0, statuses: [status] },
    }).map(row => [row.label, row.value]));
    assert.equal(rows.get("Workers"), "1 created");
    assert.match(rows.get("Active")!, /^unknown /);
});
