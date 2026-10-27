import { engineStartEffects } from "#oma-test/app/engine/start-effects";
import { testBroker } from "../helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createGitServices } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
// A society and its Principal, composed the way `oma` composes them, with only
// the model scripted (./scripted-provider.ts).
//
// Real: provisioning, Store, mail, broker and Principal endpoints, bundled Pi,
// credential delivery, and PrincipalDelivery. Residents use createNativeResidents
// with the production ExecutionRuntime, PID namespace, journal, private runner
// channel and confined Worker. Candidate and quarantine use that same owner.
// Only model replies and the host's Principal registration channel are scripted.
// Actual native tests separately exercise crash, socket transfer and death gates.
//
// Scenarios assert durable facts -- ledger rows, mailbox files, receipts, the
// session history -- not screen text.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor, AuthContext, ProtocolLimits, Request, ExecutionObservation } from "@oma/contracts";
import { Broker, type PrincipalHostChannel } from "@oma/broker";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { ExecutionRuntime } from "#oma-test/app/runtime/execution-runtime";
import { createNativeResidents, type NativeResidents } from "#oma-test/app/runtime/native-residents";
import { quarantineExecution } from "#oma-test/app/runtime/quarantine-execution";
import { withAsyncCleanup } from "@oma/native/cleanup";
import { validateConfig } from "@oma/config";
import { defaultHostConfig } from "@oma/config/defaults";

import { GitModule } from "@oma/git";
import { CandidateChecks } from "#oma-test/app/runtime/candidate-checks";
import { integrationPolicyFromConfig } from "@oma/domain/integration-policy";
import { readCurrentHostPolicy } from "@oma/config";
import { createChildSpecResolver } from "@oma/config/policy";
import { residentProjectGit } from "@oma/domain/resident-paths";
import type { HostConfig, ResolvedAgentSpec } from "@oma/contracts";
import type { NewAgent } from "@oma/contracts/ledger";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { exportRefForRequestKey } from "@oma/domain/derived";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { provisionSociety } from "#oma-test/app/runtime/provision";
import { processIdentity, type ProcessIdentity } from "@oma/broker/process-ancestry";
import { encodeHostMessage } from "@oma/protocol/host-channel";
import { PrincipalSession, newSessionHandle, principalEnvironment, principalSessionDir, principalWorkspace } from "@oma/engine/principal-session";
import { principalSessionProfile } from "#oma-test/app/engine/principal-profile";
import { PrincipalDelivery, principalHostBroker, type DeliveryOutcome } from "#oma-test/app/runtime/principal-delivery";
import { resolvePiRuntime } from "@oma/engine/pi-runtime";
import type { VerifiedExtension } from "@oma/contracts/assets";
import { tryHoldSociety } from "#oma-test/app/runtime/society-lease";
import type { PiEvent } from "@oma/engine/pi-rpc";
import { agentRootPathAt, projectGitPathAt, runnerViewPathAt, workspacePathAt } from "@oma/domain/paths";
import { makeValidAgent } from "./spec.js";
import { CONFINED_MODEL, CONFINED_MODEL_2, scriptedProvider, type Reply, type Script, type ScriptedProvider } from "./scripted-provider.js";
import { RESIDENT_TEST_OPTIONS } from "./resident.js";
export const SCENARIO_LIMITS: ProtocolLimits = {
    frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64,
    replyReferences: 64, contextFiles: 256, contextBytes: 8 * 1024 * 1024,
    bundleBytes: 256 * 1024 * 1024, logBytes: 1024 * 1024, batchMaxMessages: 24,
    idleStreamSeconds: 30, receiptWaitSeconds: 30,
};
const SOCIETY = "demo";
const REPO = process.cwd();
/** The host's side of the supervision channel, as `oma` holds it: grants and
 * refusals are recorded, and a session is registered through the listener the
 * broker installed, exactly as the real channel delivers one. */
class HostSide implements PrincipalHostChannel {
    readonly host: ProcessIdentity = processIdentity(process.pid)!;
    readonly grants: {
        credential: string;
        sessionHandle: string;
    }[] = [];
    readonly refused: string[] = [];
    private listeners: ((sessionHandle: string, pid: number) => void)[] = [];
    ready = (): void => { };
    grant = (credential: string, sessionHandle: string): void => { this.grants.push({ credential, sessionHandle }); };
    refuse = (sessionHandle: string): void => { encodeHostMessage({ kind: "refused", sessionHandle }); this.refused.push(sessionHandle); };
    onSession = (listener: (sessionHandle: string, pid: number) => void): void => { this.listeners.push(listener); };
    close = (): void => { };
    /** A new broker is a new channel owner; the old broker's listener is gone. */
    reset(): void { this.listeners = []; }
    register(sessionHandle: string, pid: number): {
        credential: string;
        sessionHandle: string;
    } | null {
        const before = this.grants.length;
        for (const listener of this.listeners)
            listener(sessionHandle, pid);
        return this.grants.length > before ? this.grants.at(-1)! : null;
    }
}
export interface Turn {
    /** Every event the engine emitted during the run. */
    readonly events: readonly PiEvent[];
    /** The lines the product's screen would show. */
    readonly lines: readonly string[];
}
export interface Scenario {
    readonly root: string;
    readonly runRoot: string;
    readonly provider: ScriptedProvider;
    readonly store: Store;
    readonly broker: Broker;
    readonly session: PrincipalSession;
    /** Everything the product's screen would have shown, in order. */
    readonly lines: string[];
    readonly events: PiEvent[];
    /** Scripts the requests still to come. */
    script(next: Script | readonly Reply[]): void;
    /** A Human prompt, as the Control Panel submits it; resolves when the run the
     * prompt started has settled. */
    prompt(text: string, timeoutMs?: number): Promise<Turn>;
    /** One delivery step, as `oma` runs it when the session is idle. */
    deliver(): Promise<DeliveryOutcome>;
    /** One delivery step started now, not awaited: for a scenario that acts
     * while the delivery's run is going. */
    tick(): Promise<DeliveryOutcome>;
    /** The ledger's operations, read directly from the database. */
    operations(actor?: string): {
        id: string;
        actor: string;
        kind: string;
        state: string;
        request_key: string;
    }[];
    /** Waits until the engine is idle (no run going). */
    idle(timeoutMs?: number): Promise<void>;
    /** A Resident writing to the society, through the broker's own dispatch. */
    residentSends(from: string, input: {
        to: string[];
        subject: string;
        body: string;
        kind?: string;
        replyTo?: string;
    }, key: string): Promise<Record<string, unknown>>;
    /** Any public method as a Resident, through the broker's own dispatch with
     * the resident profile's capabilities (mail.send, git.submit, ...). A null
     * `key` sends a read-style envelope: no top-level request key. */
    residentCall(from: string, method: string, params: Record<string, unknown>, key: string | null, stream?: AsyncIterable<Uint8Array> | null): Promise<Record<string, unknown>>;
    /** The trusted candidate path for a Resident: commits `change` on a clone
     * of canonical main and publishes it with git.submit. Returns the pushed
     * candidate oid and the main it was built on. */
    residentPushes(from: string, key: string, change: (workspace: string) => void): Promise<{
        candidate: string;
        base: string;
    }>;
    /** Stops the broker and starts a new one over the same state, as the
     * supervisor restarts it; the engine is registered with the new one. */
    restartBroker(): Promise<void>;
    /** Stops the broker without starting another. */
    stopBroker(): Promise<void>;
    /** Kills the engine outright and starts a new session over the same history. */
    restartEngine(signal?: NodeJS.Signals): Promise<void>;
    /** Observe the already-started native scope through completion and kernel death. */
    residentFinished(agent: string, timeoutMs?: number): Promise<ExecutionObservation>;
    /** The Maildir names in an actor's inbox. */
    inbox(actor: string, box?: "new" | "cur"): string[];
    /** The raw stored message a mail id names. */
    archived(messageId: string): string;
    /** The society's configuration file, as the Control Panel edits it. */
    readonly configPath: string;
    /** Runs a Resident through the production native owner: the product's runner
     * opens a run, takes one prepared batch, delivers it into a fresh engine
     * (the scripted model answers) and completes it. Resolves when it exits. */
    activate(agent: string, timeoutMs?: number): Promise<{
        readonly code: number | null;
        readonly stderr: string;
    }>;
    close(): Promise<void>;
}
export interface ScenarioOptions {
    /** Actual Open TUI, invoked only by a process running in the PTY harness. */
    readonly interactive?: {
        readonly onUi: (event: PiEvent, session: PrincipalSession) => void;
    };
    readonly extensions?: readonly VerifiedExtension[];
    readonly script?: Script | readonly Reply[];
    /** Initial Resident rows; activation uses the real owned native runner. */
    readonly residents?: readonly string[];
    readonly acceptMs?: number;
    readonly retryAfterMs?: number;
    /** Residents run confined, as a deployment with a rootfs runs them: under
     * bubblewrap in the society's generated rootfs, with bash, reaching the
     * (then TLS) scripted provider only through the runner's relay. */
    readonly confined?: true;
    /** Withhold git.submit, as the Control Panel can (DR4): a Resident without
     * it cannot publish candidates or open a merge request. */
    readonly submit?: boolean;
    /** mail-v1 notice splitting: a small bound makes applied-change notices
     * multi-part; the default keeps them whole. */
    readonly reviewBodyBytes?: number;
    /** Extra environment for the engines -- how an internal OMA policy such as
     * OMA_TOOL_SURFACE (D23: no longer configuration) reaches the process the
     * way OMA's own plumbing would set it. For the Principal the channel is the
     * spawn plan's explicit field, never the inherited environment: the same
     * value in this record is also spread into the engine env so a sessionEnv
     * filter still proves ambient copies are dropped. */
    readonly engineEnv?: Readonly<Record<string, string>>;
}
/** A broker over the society's state, composed as entry/broker.ts composes
 * it (mail, views, lifecycle, Git with its quarantine and the host's current
 * integration policy). It owns the Store it is given: its drain closes it, as
 * the product's broker process does on its way out. */
async function composeBroker(root: string, runRoot: string, store: Store, host: HostSide, config: HostConfig, configPath: string,
    options: ScenarioOptions, trust: Readonly<Record<string, string>>): Promise<{ broker: Broker; units: NativeResidents; executions: ExecutionRuntime }> {
    const executions = new ExecutionRuntime(root);
    await executions.recover();
    let broker: Broker;
    const units = createNativeResidents(store, executions, { stateRoot: root, runRoot, society: SOCIETY, configPath }, config,
        (socket, peer) => broker.attachRunner(socket, peer), () => broker.hintWork(),
        (actor, invocation) => broker.residentIncarnation(actor, invocation),
        { environment: { ...process.env, ...trust, ...options.engineEnv },
          ...(options.engineEnv?.OMA_TOOL_SURFACE === undefined ? {} : { toolSurface: options.engineEnv.OMA_TOOL_SURFACE }) });
    const mail = createMailModule({ stateRoot: root, society: SOCIETY }, store, 64, SCENARIO_LIMITS.batchMaxMessages, SCENARIO_LIMITS);
    const views = new ViewsModule(store, root, SOCIETY, "p");
    const gitPaths = { stateRoot: root, projectGit: projectGitPathAt(root), contextGit: join(root, "repos", "context.git"),
        worldDir: join(root, "world"), society: SOCIETY,
         checkNode: config.installation.node, checkAssetsDir: config.installation.libdir, };
    const checks = new CandidateChecks(gitPaths, (command, signal, authorize, fds, prepared) => executions.run("candidate", command, signal, authorize, fds, undefined, prepared));
    const { git, reviews } = createGitServices(gitPaths, store, mail, integrationPolicyFromConfig(config.integration), () => integrationPolicyFromConfig(readCurrentHostPolicy(configPath, SOCIETY).integration),
        (candidate, check, cancellation, authorize) => checks.run(candidate, check, cancellation, authorize),
        { mailBodyBytes: options.reviewBodyBytes ?? SCENARIO_LIMITS.mailBodyBytes, subjectBytes: SCENARIO_LIMITS.subjectBytes, bundleBytes: SCENARIO_LIMITS.bundleBytes },
        quarantineExecution(gitPaths, executions));
    const resolveSpec = createChildSpecResolver(() => readCurrentHostPolicy(configPath, SOCIETY), () => store.inTransaction);
    const lifecycle = createLifecycleModule(store, units, { stateRoot: root, projectGit: projectGitPathAt(root), society: SOCIETY, hasGoal: () => true, activationAllowed: () => true,
        residentProjectGit: residentProjectGit() }, resolveSpec, mail);
    broker = testBroker({ store, mail, units, views, lifecycle, git, reviews, reconcile: null, paths: { stateRoot: root, runRoot, society: SOCIETY, hasGoal: () => true,
        quiesceOnDrain: async () => {
            await withAsyncCleanup(() => units.close(), () => executions.close());
        } }, limits: SCENARIO_LIMITS, principalHost: host });
    return { broker, units, executions };
}
export async function startScenario(options: ScenarioOptions = {}): Promise<Scenario> {
    // D03: a launched runner checks that its roots name this society under `oma`.
    const base = mkdtempSync(join(tmpdir(), "oma-scn-"));
    const root = join(base, "oma", SOCIETY);
    const runDirectory = join(base, "run"), physicalRunRoot = join(runDirectory, "oma", SOCIETY);
    mkdirSync(root, { recursive: true });
    mkdirSync(physicalRunRoot, { recursive: true });
    // Linux Unix-socket names must fit sun_path; use a bounded test TMPDIR.
    // All bytes stay under base; parent /proc/fd links cannot cross bwrap's user namespace.
    const runRoot = physicalRunRoot;
    provisionSociety(root);
    ExecutionJournal.initialize(root);
    // The society's configuration: the product's defaults with the scripted
    // model for Residents and the generated rootfs, so every runner is confined.
    const defaults = defaultHostConfig({ society: SOCIETY, node: process.execPath, libdir: REPO,
         deploymentDigest: "a".repeat(64) });
    const residentProfile = Object.keys(defaults.agentProfiles).find(name => name !== defaults.principalProfile)!;
    const config = validateConfig({ ...defaults,
        modelProfiles: { ...defaults.modelProfiles, scripted: { ...CONFINED_MODEL, inferenceTimeoutSeconds: 120 },
            "scripted-2": { ...CONFINED_MODEL_2, inferenceTimeoutSeconds: 120 } },
        agentProfiles: { ...defaults.agentProfiles, [residentProfile]: { ...defaults.agentProfiles[residentProfile]!, modelProfile: "scripted",
                capabilities: [...defaults.agentProfiles[residentProfile]!.capabilities
                        .filter(capability => options.submit !== false || capability !== "git.submit")] } } });
    const configPath = join(root, "config.json");
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    const provider = await scriptedProvider(options.script ?? [], { tls: true });
    // The engines and the runner's relay trust the scripted provider's own
    // certificate; certificate checking stays on.
    const trust: Record<string, string> = provider.caFile === null ? {} : { NODE_EXTRA_CA_CERTS: provider.caFile };
    let store = new Store(join(root, "runtime.sqlite"));
    // Agents as the product records them: the configuration's profiles, their
    // capabilities and model reference, based on the canonical main.
    const main = execFileSync("/usr/bin/git", ["--git-dir", projectGitPathAt(root), "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim();
    const agentRow = (name: string): NewAgent => {
        const profileName = name === "principal" ? config.principalProfile : residentProfile;
        const profile = config.agentProfiles[profileName]!;
        const spec: ResolvedAgentSpec = { name, from: main, brief: name === "principal" ? "Principal" : `${name}의 역할`, profile: profileName,
            capabilities: [...profile.capabilities], modelProfile: profile.modelProfile };
        // Seeded Residents are the Principal's children, as bootstrap records them.
        return { ...makeValidAgent(name), specHash: resolvedSpecDigest(spec), profile: profileName, specJson: JSON.stringify(spec),
            createdBy: name === "principal" ? null : "principal" };
    };
    store.transaction(tx => {
        tx.insertAgent(agentRow("principal"));
        for (const name of options.residents ?? [])
            tx.insertAgent(agentRow(name));
    });
    const host = new HostSide();
    let { broker, units, executions } = await composeBroker(root, runRoot, store, host, config, configPath, options, trust);
    await broker.start();
    const runtime = resolvePiRuntime({ stateRoot: root, libdir: REPO });
    provider.configure(runtime.agentDir);
    const lines: string[] = [];
    const events: PiEvent[] = [];
    const handle = newSessionHandle();
    const fence = options.interactive ? tryHoldSociety(root) : null;
    if (options.interactive)
        assert.ok(fence);
    const startSession = (): PrincipalSession => {
        const profile = { ...principalSessionProfile(configPath, SOCIETY), provider: "fake", model: "scripted", ...(options.extensions === undefined ? {} : { extensions: options.extensions }) };
        const started = PrincipalSession.start(engineStartEffects, { piCommand: runtime.executable, piArgs: runtime.args, piAgentDir: runtime.agentDir,
            ...(options.interactive && fence ? { interactiveEntry: join(REPO, "apps/oma/dist/entry/pi-interactive.js"), fence: fence.fence, project: REPO } : {}),
            coreExtension: join(REPO, "packages/extension/dist/index.js"), sessionDir: principalSessionDir(root),
            workspace: principalWorkspace(root), home: principalWorkspace(root),
            // The deliberate plan travels the plumbing field, not the inherited
            // env -- the runner's own hop, applied to the host engine.
            ...(options.engineEnv?.OMA_TOOL_SURFACE === undefined ? {} : { toolSurface: options.engineEnv.OMA_TOOL_SURFACE }) }, profile, { frameBytes: SCENARIO_LIMITS.frameBytes, idleStreamSeconds: SCENARIO_LIMITS.idleStreamSeconds, receiptWaitSeconds: SCENARIO_LIMITS.receiptWaitSeconds }, { ...principalEnvironment({ stateRoot: root, runRoot, libdir: REPO }, profile, SCENARIO_LIMITS), ...trust, ...options.engineEnv }, { onLine: line => { lines.push(line); }, onBusy: () => { }, onEnd: reason => { lines.push(`[end] ${reason}`); },
            onUi: event => options.interactive?.onUi(event, started),
            onPromptFailed: (_text, reason) => { lines.push(`[prompt failed] ${reason}`); },
            onPromptUnconfirmed: (_text, reason) => { lines.push(`[prompt unconfirmed] ${reason}`); } });
        started.onEvent(event => { events.push(event); });
        return started;
    };
    let session = startSession();
    const register = (): void => {
        const pid = session.pid;
        assert.ok(pid !== null, "the engine is not running");
        const grant = host.register(handle, pid);
        assert.ok(grant !== null, `the broker did not accept the host's engine: ${JSON.stringify(host.refused)}`);
        session.grant(grant.credential, grant.sessionHandle);
    };
    register();
    // Bound to the session it was made with, as `oma` binds it (`live`): a
    // delivery in flight when that engine dies must see that engine end.
    const makeDelivery = (): PrincipalDelivery => {
        const live = session;
        return new PrincipalDelivery({
            get running() { return live.running; },
            get busy() { return live.busy; },
            onEvent: listener => live.onEvent(listener),
            deliver: batchId => live.deliver(batchId),
        }, principalHostBroker(runRoot, SCENARIO_LIMITS), {
            stateRoot: root, frameBytes: SCENARIO_LIMITS.frameBytes,
            acceptMs: options.acceptMs ?? 20000, retryAfterMs: options.retryAfterMs ?? 0,
        });
    };
    let delivery = makeDelivery();
    const waitFor = (match: (event: PiEvent) => boolean, timeoutMs: number): Promise<void> => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { stop(); reject(new Error(`the engine did not settle within ${timeoutMs} ms; last lines: ${JSON.stringify(lines.slice(-5))}`)); }, timeoutMs);
        const stop = session.onEvent(event => { if (match(event)) {
            clearTimeout(timer);
            stop();
            resolve();
        } });
    });
    const idle = async (timeoutMs = 30000): Promise<void> => {
        const deadline = Date.now() + timeoutMs;
        while (session.busy) {
            if (Date.now() > deadline)
                throw new Error(`the session stayed busy; last lines: ${JSON.stringify(lines.slice(-5))}`);
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    };
    const scenario: Scenario = {
        root, runRoot, provider, lines, events, configPath,
        get store() { return store; },
        get broker() { return broker; },
        get session() { return session; },
        script: next => { provider.script(next); },
        async prompt(text, timeoutMs = 30000) {
            await idle(timeoutMs);
            const from = events.length;
            const fromLines = lines.length;
            const settled = waitFor(event => event.type === "agent_settled", timeoutMs);
            const outcome = session.submit(text);
            assert.equal(outcome.kind, "accepted", `the session did not take the prompt: ${JSON.stringify(outcome)}`);
            await settled;
            await idle(timeoutMs);
            return { events: events.slice(from), lines: lines.slice(fromLines) };
        },
        async deliver() {
            await idle();
            const outcome = await delivery.tick();
            await idle();
            return outcome;
        },
        tick: () => delivery.tick(),
        operations(actor) {
            const db = new DatabaseSync(join(root, "runtime.sqlite"), { readOnly: true });
            try {
                const rows = db.prepare("SELECT id, actor, kind, state, request_key FROM operations ORDER BY created_at_ms, id").all() as {
                    id: string;
                    actor: string;
                    kind: string;
                    state: string;
                    request_key: string;
                }[];
                return actor === undefined ? rows : rows.filter(row => row.actor === actor);
            }
            finally {
                db.close();
            }
        },
        idle,
        async residentSends(from, input, key) {
            return await scenario.residentCall(from, "mail.send", {
                to: input.to, subject: input.subject, kind: input.kind ?? "message", body: input.body,
                ...(input.replyTo === undefined ? {} : { replyToMessage: input.replyTo })
            }, key);
        },
        async residentCall(from, method, params, key, stream = null) {
            const agent = store.getAgent(from);
            assert.ok(agent, `no resident ${from}`);
            const auth: AuthContext = { actor: from, incarnation: agent.incarnation, role: "resident", channel: "actor",
                capabilities: new Set(["mail.send", "route.follow", "git.submit", "agent.manage.self"]),
                peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
            const request = { v: 1, id: key ?? method, method, ...(key === null ? {} : { request: key }), params };
            return await broker.dispatch(auth, request as unknown as Request, stream) as Record<string, unknown>;
        },
        async residentPushes(from, key, change) {
            const workspace = join(root, "scratch", `push-${from}-${key}`);
            mkdirSync(join(root, "scratch"), { recursive: true });
            // A private clone of canonical main, as a Resident's workspace is.
            execFileSync("git", ["clone", "--no-local", "--single-branch", "--branch", "main", projectGitPathAt(root), workspace]);
            const work = (argv: string[]): string => execFileSync("git", argv, { cwd: workspace, encoding: "utf8" }).trim();
            work(["config", "user.email", `${from}@demo.oma.invalid`]);
            work(["config", "user.name", from]);
            const base = work(["rev-parse", "HEAD"]);
            change(workspace);
            work(["add", "-A"]);
            work(["commit", "-m", `${from} change ${key}`]);
            const candidate = work(["rev-parse", "HEAD"]);
            // The same publication oma submit runs: an export ref bundled off the
            // clone and handed to the broker as a git.submit stream.
            const exportRef = exportRefForRequestKey(key);
            work(["update-ref", exportRef, candidate]);
            const bundlePath = join(root, "scratch", `bundle-${from}-${key}`);
            work(["bundle", "create", bundlePath, exportRef]);
            const content = readFileSync(bundlePath);
            const digest = { bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") };
            const reply = await scenario.residentCall(from, "git.submit", {
                candidate, exportRef, prerequisites: [], to: [from],
                subject: `merge candidate ${candidate.slice(0, 12)}`,
                body: "Candidate for a merge request; review happens in the request thread.",
                paths: [], bundle: { ...digest, mediaType: "application/x-git-bundle" },
            }, `${key}.submit`, (async function* () { yield content; })());
            assert.equal(reply.ok, true, `git.submit refused: ${JSON.stringify(reply).slice(0, 400)}`);
            return { candidate, base };
        },
        async stopBroker() {
            await broker.drainAndClose();
            host.reset();
        },
        async restartBroker() {
            await scenario.stopBroker();
            store = new Store(join(root, "runtime.sqlite"));
            ({ broker, units, executions } = await composeBroker(root, runRoot, store, host, readCurrentHostPolicy(configPath, SOCIETY), configPath, options, trust));
            await broker.start();
            register();
        },
        async restartEngine(signal = "SIGKILL") {
            const prior = session, pid = prior.pid;
            if (pid !== null) process.kill(pid, signal);
            // RPC completion/running=false can precede actual child close.
            // The old history writer keeps ownership until the OS closes it.
            await prior.exited;
            session = startSession();
            register();
            delivery = makeDelivery();
        },
        async residentFinished(agent, timeoutMs = 30000) {
            const owner = executions, residents = units, end = performance.now() + timeoutMs;
            for (;;) {
                const observed = residents.observe(agent);
                if (owner.confirmDead(`resident:${agent}`) && !["active", "activating"].includes(observed.activeState)) return observed;
                assert.ok(performance.now() < end, `Resident ${agent} did not finish: ${JSON.stringify(observed)}`);
                await new Promise(resolve => setTimeout(resolve, 20));
            }
        },
        inbox(actor, box = "new") {
            const directory = join(root, "mail", "inboxes", actor, box);
            return existsSync(directory) ? readdirSync(directory).sort() : [];
        },
        archived(messageId) {
            const name = readdirSync(join(root, "mail", "archive", "cur")).find(entry => entry.startsWith(messageId));
            assert.ok(name, `no archived message ${messageId}`);
            return readFileSync(join(root, "mail", "archive", "cur", name), "utf8");
        },
        async activate(agent, timeoutMs = 90000) {
            assert.equal(RESIDENT_TEST_OPTIONS.skip, false, String(RESIDENT_TEST_OPTIONS.skip));
            assert.equal(readCurrentHostPolicy(configPath, SOCIETY).schemaVersion, 4);
            // What provisioning a created Resident leaves: its home and its workspace.
            const home = join(agentRootPathAt(root, agent), "home");
            for (const path of [home, runnerViewPathAt(root, agent)])
                mkdirSync(path, { recursive: true });
            // The workspace lifecycle creates (LIFE-002): a private clone of the
            // canonical repository whose origin is that repository as the Resident sees it.
            const workspace = workspacePathAt(root, agent);
            if (!existsSync(join(workspace, ".git"))) {
                const git = (args: string[], cwd?: string): void => { execFileSync("/usr/bin/git", args, { cwd, stdio: "ignore" }); };
                git(["clone", "--no-local", "--single-branch", "--branch", "main", projectGitPathAt(root), workspace]);
                git(["remote", "set-url", "origin", residentProjectGit()], workspace);
            }
            // Retain this broker's owners. runner.open may still increment its
            // incarnation; a later Store must not supply the old run's identity.
            const owner = executions, residents = units, ledger = store;
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                await residents.start(agent, true);
                let timeout: Promise<unknown> | undefined;
                let failure: unknown;
                timer = setTimeout(() => {
                    if (owner.confirmDead(`resident:${agent}`)) return;
                    // The ledger stays open while this broker still owns a
                    // populated scope. Stop the current grant, not the seed row.
                    timeout = residents.stop(agent, ledger.getAgent(agent)!.incarnation).catch(error => { failure = error; });
                }, timeoutMs);
                while (!owner.confirmDead(`resident:${agent}`)) {
                    if (failure !== undefined) throw failure;
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
                await timeout;
                const observation = residents.observe(agent);
                const logs = await residents.readLogs(agent, 3600, SCENARIO_LIMITS.logBytes);
                return { code: observation.execMainStatus < 0 ? null : observation.execMainStatus, stderr: logs.text };
            }
            finally {
                clearTimeout(timer);
            }
        },
        async close() {
            try {
                session.close();
            }
            catch { /* already ended */ }
            const pid = session.pid;
            if (options.interactive)
                await session.exited;
            else if (pid !== null)
                try {
                    process.kill(pid, "SIGKILL");
                }
                catch { /* gone */ }
            await session.exited;
            fence?.release();
            await withAsyncCleanup(() => broker.drainAndClose(), () => provider.close());
            try {
                store.close();
            }
            catch { /* the broker's drain closed it */ }
            // Published context revisions are sealed read-only (CTX); open them to remove.
            execFileSync("chmod", ["-R", "u+rwX", base]);
            rmSync(base, { recursive: true, force: true });
        },
    };
    return scenario;
}
/** Runs `body` over a fresh scenario and always tears it down. */
export async function withScenario(options: ScenarioOptions, body: (scenario: Scenario) => Promise<void>): Promise<void> {
    const scenario = await startScenario(options);
    await withAsyncCleanup(async () => {
        try { await body(scenario); }
        catch (error) {
            const root = process.env.OMA_TEST_ARTIFACT_DIR ?? process.env.OMA_NATIVE_EVIDENCE_DIR;
            const snapshot = { error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
                lines: scenario.lines, events: scenario.events,
                provider: scenario.provider.seen.map(({ body, reply }) => ({ body, reply })) };
            if (root !== undefined) {
                try {
                    mkdirSync(root, { recursive: true });
                    const folder = mkdtempSync(join(root, "scenario-failure-"));
                    writeFileSync(join(folder, "failure.json"), JSON.stringify(snapshot, null, 2) + "\n");
                    console.error(`Scenario failure evidence: ${folder}`);
                } catch (capture) { throw new AggregateError([error, capture], "scenario failure and evidence capture failed"); }
            } else console.error("Scenario failure evidence:", JSON.stringify(snapshot));
            throw error;
        }
    }, () => scenario.close());
}
