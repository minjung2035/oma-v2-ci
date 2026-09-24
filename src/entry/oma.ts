/** TUI-002/003: the host product entrypoint.
 *
 * This is the `oma` a Human runs. It is a different executable from the
 * model-facing CLI in the Resident rootfs (src/cli.ts) and shares no argv
 * parser, capability or socket with it. Nothing here is mounted into a sandbox.
 */
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidSocietyName } from "../ids.js";
import { StoreError } from "../domain/errors.js";
import { DEPLOYMENT_LAYOUT } from "../domain/deployment.js";
import { assertHostDirectoryLayout, hostLaunchLocation } from "../runtime/assets.js";
import { resolvePiRuntime } from "../runtime/pi-runtime.js";
import { ensureDirectory } from "../storage/directory.js";
import { TuiApp, type AppPorts } from "../tui/app.js";
import { codeFor, fail } from "../tui/exit.js";
import { openTerminal } from "../tui/screen.js";
import { dashboardData } from "../tui/dashboard.js";
import { PrincipalSession, newSessionHandle, principalEnvironment, principalSessionDir, principalSessionProfile } from "../tui/session.js";
import { PrincipalDelivery, principalHostBroker } from "../runtime/principal-delivery.js";
import type { PiEvent } from "../runtime/pi-rpc.js";
import { TuiTransport, limitsOf, type Observation } from "../tui/transport.js";
import { principalMailbox, readBody, readMailbox, unreadCount } from "../tui/sources/mail.js";
import { readExtensions, toggleExtension } from "../tui/sources/extensions.js";
import { commitField, readSettings, writeSettings, type Settings } from "../tui/sources/settings.js";
import { collectManagedGenerations } from "../config/generations.js";
import { defaultHostConfig, defaultSocietyFor, societyFromDirectory } from "../config/defaults.js";
import { sha256Hex } from "../hash.js";
import {
  observeProjectBinding, projectBindingDecision, provisionSociety, publishProjectBinding, repairSociety, residentRootfsPath,
  stateRootHasSociety, type ProvisionReport,
} from "../runtime/provision.js";
import { brokerListening, superviseBroker, type BrokerHandle } from "../runtime/broker-supervisor.js";
import { HostTenure } from "../runtime/host-tenure.js";
import { deploymentDigest } from "../runtime/deployment-manifest.js";
import type { ExtensionRow, MailRow } from "../tui/model.js";
import type { PromptOutcome } from "../tui/prompt.js";

function usage(): never {
  process.stderr.write("usage: oma [--society <name>] [--config <path>] [--bind-project]\n");
  process.exit(4);
}

/** First run in a project: write a real, bounded configuration rather than
 * asking the user to compose one or to run a setup command. Every value is
 * visible in the Control Panel and editable there (CFG-002, arch §23.6).
 */
function ensureConfiguration(configPath: string, society: string, stateRoot: string): Settings {
  try { return readSettings(configPath); }
  catch (error) {
    if (existsSync(configPath)) throw error;
    const libdir = fileURLToPath(new URL("../../../", import.meta.url));
    mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
    // Residents are confined from the first run: the rootfs is the one OMA
    // builds under the state root, not the host's `/` (SB-001).
    writeSettings(configPath, defaultHostConfig({
      society, node: process.execPath, libdir, rootfs: residentRootfsPath(stateRoot),
      deploymentDigest: deploymentDigest(libdir),
    }));
    return readSettings(configPath);
  }
}

function argOf(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) usage();
  // No society given: derive one from the project directory, so running `oma`
  // in a checkout just works and two checkouts stay separate.
  // D05/WP16.01: the project directory is observed once, here; the identity
  // derived from it is pure, and it names a society only through the binding
  // checked below before anything of that society is written.
  let canonicalProjectPath: string;
  try { canonicalProjectPath = realpathSync(process.cwd()); }
  catch (error) { fail(`프로젝트 디렉터리를 확인할 수 없습니다: ${error instanceof Error ? error.message : String(error)}`, 4); }
  const explicitSociety = argOf(argv, "--society");
  const society = explicitSociety ?? defaultSocietyFor(canonicalProjectPath, sha256Hex(canonicalProjectPath));
  const bindRequested = argv.includes("--bind-project");
  if (!isValidSocietyName(society)) usage();
  // D03: this is where the society's location is decided; everything this
  // process starts is handed it rather than deriving its own.
  const location = hostLaunchLocation(society, process.env, argOf(argv, "--config"));
  const { stateRoot, runRoot, configPath } = location;

  // TUI-004/REC-007: before a byte of this society's state is written and
  // before any broker is started, this process either owns the society or it
  // does not. Ownership is this tenure and nothing else -- not a spawned pid,
  // not a broker that happens to be up, and not a lock that dies with a child,
  // which left a gap at every broker restart for a second `oma` to walk into.
  // A refusal here also covers the case no earlier design could: an `oma` that
  // is already gone but whose engine is still running holds the society until
  // that engine exits, because the engine inherited the lease.
  //
  // The paths the answer is derived from are checked before they are used, not
  // after. An `oma` pointed at a relative, denormalized or symlinked run root
  // would otherwise take the society, write its configuration, provision it and
  // repair it -- a repair that edits `/etc/passwd`, `/etc/group` and symlinks
  // inside the rootfs -- and only discover afterwards that the place it was
  // told to work in is not the place it checked. The state root is checked by
  // the lease itself, because that is where the name it takes comes from
  // (VAL-002, FS-005).
  try { assertHostDirectoryLayout(runRoot, true); }
  catch (error) { fail(`society의 실행 디렉터리를 신뢰할 수 없습니다: ${error instanceof Error ? error.message : String(error)}`, codeFor(error)); }

  let tenure: HostTenure | null;
  try { tenure = HostTenure.take(stateRoot); }
  catch (error) { fail(`society 소유권을 확인하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`, codeFor(error)); }

  // A broker that is already listening owns the writing of this society, no
  // matter who started it -- a systemd unit, an operator by hand, or an `oma`
  // whose host is gone. This question used to be asked inside `superviseBroker`,
  // which runs after the configuration has been written and after the society
  // has been provisioned and repaired: this process would have modified files
  // inside a rootfs another broker was already serving Residents from, and only
  // then stood down. It is asked here instead, before anything is written, so
  // standing down costs nothing and changes nothing.
  //
  // The lease is given up with it. Holding a society this process has refused
  // to act on would keep the next `oma` out for no reason.
  //
  // The question is asked whether or not this process got the lease. A broker
  // started outside the product now takes the society lease itself, so a
  // refused lease is often that broker rather than another `oma`, and a
  // refusal that names the wrong thing sends the Human to look for the wrong
  // process.
  let ownershipRefusal = "다른 oma가 이 society의 소유권을 쥐고 있습니다";
  if (await brokerListening(runRoot)) {
    if (tenure !== null) { await tenure.end(); tenure = null; }
    ownershipRefusal = "이 society의 broker가 이미 실행 중입니다";
  }

  // D05/WP16.02-03: a society is acted on only for the project it is bound
  // to, decided before this process writes anything of it. A fresh society is
  // bound to this project; an existing unbound one only on --bind-project; a
  // mismatch is refused even with --society. An earlier default name for this
  // project is never taken over or renamed implicitly.
  {
    const observation = observeProjectBinding(stateRoot);
    const hasSociety = stateRootHasSociety(stateRoot);
    if (explicitSociety === undefined && !hasSociety && observation.kind === "absent") {
      const legacy = societyFromDirectory(canonicalProjectPath);
      if (legacy !== society && isValidSocietyName(legacy) && stateRootHasSociety(join(dirname(stateRoot), legacy))) {
        if (tenure !== null) await tenure.end();
        fail(`이 프로젝트 이름으로 만든 이전 society '${legacy}'가 있습니다. 그 society를 계속 쓰려면 이 프로젝트의 것인지 확인한 뒤 \`oma --society ${legacy} --bind-project\`로 실행하세요. 새 society로 시작하지 않았습니다.`, 4);
      }
    }
    const decision = projectBindingDecision({ observation, society, canonicalProjectPath, hasSociety,
      bindRequested: bindRequested && tenure !== null });
    if (decision.kind === "refuse" || (decision.kind === "publish" && tenure === null && hasSociety)) {
      if (tenure !== null) await tenure.end();
      fail(decision.kind === "refuse" ? `이 society를 이 프로젝트에서 열 수 없습니다: ${decision.reason}` :
        "이 society에는 프로젝트 바인딩이 없고 다른 oma가 소유하고 있습니다", 4);
    }
    if (decision.kind === "publish" && tenure !== null) {
      try { publishProjectBinding(stateRoot, { society, canonicalProjectPath }); }
      catch (error) {
        await tenure.end();
        fail(`society의 프로젝트 바인딩을 기록하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`, codeFor(error));
      }
    }
  }

  let settings: Settings;
  try { settings = tenure === null ? readSettings(configPath) : ensureConfiguration(configPath, society, stateRoot); }
  catch (error) {
    // A process that does not own the society writes nothing into it, so it
    // does not create the configuration it is missing either.
    if (tenure === null && !existsSync(configPath))
      fail("다른 oma가 이 society를 소유하고 있고 설정은 아직 만들어지지 않았습니다. 잠시 후 다시 실행하세요.", 4);
    fail(`설정을 읽을 수 없습니다: ${error instanceof Error ? error.message : String(error)}`, codeFor(error));
  }
  if (settings.config.society !== society)
    fail("설정의 society가 요청한 society와 다릅니다", 4);

  // REC-007: the society's tree is made to exist and then made right, and both
  // finish before anything can act on it.
  //
  // This used to run after the broker said it was ready, which put a repair
  // the product performs in one process in a race with Resident activation
  // the broker performs in another: the broker's reconciliation starts enabled
  // Residents with pending work as soon as it is listening, and a rootfs entry
  // that was tampered with could still be wrong when a sandbox was built on
  // it. Nothing acknowledges between the two processes, so the only ordering
  // that can be relied on is the one that happens before the broker exists.
  //
  // A repair that fails is fatal here. Continuing would run Residents on a
  // rootfs the product has said it cannot vouch for, and the previous
  // behaviour -- writing the failure to the screen and carrying on -- made
  // that outcome indistinguishable from a healthy start.
  let provisioned: ProvisionReport | null = null;
  let corrected: readonly string[] = [];
  if (tenure !== null) {
    try { provisioned = provisionSociety(stateRoot, { projectDir: process.cwd() }); }
    catch (error) { fail(`society를 준비하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`, codeFor(error)); }
    try { corrected = repairSociety(stateRoot); }
    catch (error) { fail(`rootfs를 고치지 못해 society를 시작하지 않았습니다: ${error instanceof Error ? error.message : String(error)}`, codeFor(error)); }
    // D02/WP13: configuration generations no reader can still use are
    // collected only here -- this process owns the society, no broker is
    // listening and nothing it will start has read the configuration yet. The
    // current and the previously committed generation are kept. A failed
    // collection only leaves history behind, which a later edit reports.
    if (settings.snapshot !== null) {
      try { collectManagedGenerations(settings.snapshot); } catch { /* history kept; the edit budget says so */ }
    }
  }

  const mailbox = principalMailbox(stateRoot);
  const transport = new TuiTransport(stateRoot, society, settings.config.limits.frameBytes);
  let observation: Observation = { kind: "unknown", reason: "아직 관측하지 않음", observedAtMs: Date.now() };
  let extensionContext = readExtensions(settings.snapshot ?? configPath, settings.config.principalProfile, settings.workerProfile);

  const reload = (): void => {
    settings = readSettings(configPath);
    extensionContext = readExtensions(settings.snapshot ?? configPath, settings.config.principalProfile, settings.workerProfile);
  };

  const terminal = openTerminal({ input: process.stdin, output: process.stdout });
  let session: PrincipalSession | null = null;

  /** Every write this product performs on behalf of the Human passes here.
   *
   * A process without the tenure is a Control Panel over a society another
   * `oma` owns: it may read that society's configuration and mail, and it may
   * not change them. That was stated in the architecture and enforced only at
   * startup, so the panels themselves still called the real write paths -- two
   * `oma` processes could edit one running society's policy files at the same
   * time. The check belongs at the write, which is the only place that knows a
   * write is about to happen. */
  const owning = (what: string): HostTenure => {
    if (tenure === null) throw new StoreError("BROKER_UNAVAILABLE", `다른 oma가 이 society를 소유하고 있어 ${what}을(를) 바꿀 수 없습니다`);
    tenure.assertOwned(what);
    return tenure;
  };

  const ports: AppPorts = {
    configFields: () => settings.fields,
    dashboard: () => dashboardData({
      config: settings.config,
      principalModel: settings.config.agentProfiles[settings.config.principalProfile]?.modelProfile ?? "unknown",
      unread: unreadCount(mailbox),
      observation,
    }),
    mail: (): readonly MailRow[] => readMailbox(mailbox),
    extensions: (): readonly ExtensionRow[] => extensionContext.rows,
    body: (path: string) => (path.length === 0 ? null : readBody(path)),
    setField: (field, value) => {
      owning("설정");
      commitField(settings, field, value);
      reload();
    },
    setExtension: (id, role, enabled) => {
      owning("확장");
      toggleExtension(extensionContext, id, role, enabled);
      reload();
    },
    submitPrompt: (text: string): PromptOutcome => {
      if (session === null) return { kind: "refused", reason: "Pi 세션이 없습니다." };
      return session.submit(text);
    },
    quit: () => { void shutdown(0); },
  };

  const app = new TuiApp(ports, terminal, settings.config.limits.frameBytes);
  app.refresh();
  for (const path of corrected) app.line(`rootfs 항목을 기대값으로 되돌렸습니다: ${path}`);

  let broker: BrokerHandle | null = null;
  let finished = false;
  const shutdown = async (code: number): Promise<void> => {
    if (finished) return;
    finished = true;
    // The tenure closes the engine and waits for the operating system to say
    // it is gone before the lease is given up. Order alone was never enough:
    // `close()` on a child is a signal, and the next `oma` could start its own
    // engine while this one was still running.
    if (tenure !== null) await tenure.end();
    session = null;
    broker?.stop();
    terminal.restore();
    process.exit(code);
  };

  // A crash still stops the broker this process started, and still ends the
  // engine. It cannot wait for the engine to die -- the next statement is the
  // exit -- and it does not have to: the engine holds the lease's descriptor,
  // so the society stays this dying process's until the engine is really gone.
  process.on("uncaughtException", error => {
    tenure?.abandon();
    broker?.stop();
    terminal.restore();
    process.stderr.write(`oma: ${String(error)}\n`);
    process.exit(3);
  });
  process.on("SIGINT", () => { void shutdown(0); });
  process.on("SIGTERM", () => { void shutdown(0); });
  terminal.onResize(() => app.draw());
  terminal.onKeys(chunk => app.feed(chunk));

  // One command starts the society. A broker another `oma` already owns is left
  // alone and gives this process no Principal authority; a broker this process
  // started is supervised: restarted if it ends unexpectedly, and stopped when
  // this process exits -- or, if this process is killed, by itself when the
  // supervision channel closes. It inherits the lease so that a broker still
  // able to write to the society keeps the society from changing hands.
  broker = tenure === null ? null : await superviseBroker({
    node: process.execPath, libdir: settings.config.installation.libdir,
    society, stateRoot, runRoot, configPath, fence: tenure.fence,
    onEvent: line => { app.line(`broker: ${line}`); app.draw(); },
  });
  // OMA runs the engine it shipped with; it never resolves Pi from PATH, and it
  // gives that engine its own agent directory so a Pi the user installed keeps
  // its configuration, extensions and sessions to itself. It starts without
  // authority: the credential reaches it later, on a private socket.
  const startEngine = (owner: HostTenure): PrincipalSession => {
    const piRuntime = resolvePiRuntime({
      stateRoot, libdir: settings.config.installation.libdir, override: process.env.OMA_PI_COMMAND,
    });
    ensureDirectory(piRuntime.agentDir, 0o700);
    const profile = principalSessionProfile(configPath, society);
    const started = PrincipalSession.start(
      { piCommand: piRuntime.executable, piArgs: piRuntime.args, piAgentDir: piRuntime.agentDir,
        coreExtension: join(settings.config.installation.libdir, DEPLOYMENT_LAYOUT.extension),
        sessionDir: principalSessionDir(stateRoot),
        workspace: join(stateRoot, "principal", "private"), home: join(stateRoot, "principal", "private"),
        fence: owner.fence },
      profile,
      limitsOf(settings.config.limits),
      principalEnvironment({ stateRoot, runRoot, libdir: settings.config.installation.libdir }, profile, settings.config.limits),
      {
        onLine: line => app.line(line),
        onBusy: busy => app.setBusy(busy),
        onEnd: reason => { session = null; owner.engineEnded(); app.line(reason); },
        onPromptFailed: (text, reason) => app.returnPrompt(text, reason),
      },
    );
    app.line(`OMA · society ${society}. Ctrl+X 로 관리 화면을 엽니다.`);
    // Said once, on the start that decided it, so the user knows what the
    // society is working on.
    if (provisioned?.seedSource === "project")
      app.line("이 프로젝트의 커밋된 HEAD로 society를 시작했습니다. 커밋되지 않은 변경은 포함되지 않습니다.");
    else if (provisioned?.seedSource === "empty")
      app.line(`빈 저장소로 society를 시작했습니다${provisioned.seedNote ? ` (${provisioned.seedNote})` : ""}.`);
    return started;
  };
  // PR-001/LIFE-006: each time a broker of this process's becomes ready -- at
  // start, and again after it is restarted -- the engine is named to it and
  // receives the credential it mints. A restarted broker's credential replaces
  // the old one in the engine, so the Principal reconnects without the Human
  // doing anything.
  //
  // The registration is not a formality that precedes delivery in program
  // order; it is what makes delivery permissible at all, so its outcome is
  // recorded on the tenure and delivery asks the tenure. A refusal used to
  // print a line and resolve, and the delivery chained after it ran anyway.
  const sessionHandle = newSessionHandle();
  const register = async (): Promise<void> => {
    const pid = session?.pid ?? null;
    if (pid === null || broker === null || tenure === null) return;
    const credential = await broker.register(sessionHandle, pid);
    if (credential === null) {
      tenure.principalUnregistered();
      app.line("broker가 Principal 세션을 받아들이지 않았습니다. 요청은 보낼 수 없습니다.");
      app.draw();
      return;
    }
    session?.grant(credential, sessionHandle);
    tenure.principalRegistered();
  };

  // PR-002: pending mail reaches the Principal while this product runs, one
  // bounded batch at a time, whenever the session is idle. Built with the
  // engine, because there is nothing to deliver into before one exists.
  let delivery: PrincipalDelivery | null = null;
  /** Said once and never taken back, exactly as the supervisor says it. */
  let disowned = false;
  const deliver = (): void => {
    if (delivery === null || tenure === null || !tenure.deliverable) return;
    void delivery.tick().then(outcome => {
      if (outcome.kind === "delivered") { app.line(`[메일] ${outcome.messages}통을 Principal에게 전달했습니다.`); app.refresh(); app.draw(); }
      else if (outcome.kind === "failed") { app.line(`[메일] 전달하지 못했습니다: ${outcome.reason}`); app.draw(); }
    }, (error: unknown) => {
      app.line(`[메일] 전달 중 오류: ${error instanceof Error ? error.message : String(error)}`);
      app.draw();
    });
  };

  // One engine per society, and this is the only place one is started.
  //
  // A spawned broker is not an owned society. The supervisor probes, spawns and
  // hands back a pid, and between that probe and the lock the child takes,
  // another `oma` can take the society; the loser's broker exits and the
  // product that started it would have had a second engine on one society, a
  // second writer of the same private workspace and session history. So the
  // engine waits for the one fact that settles ownership: a broker of this
  // process's saying it is ready, which it says only after it holds the society
  // lock. Nothing branches on `broker.state` to decide this -- a state that is
  // merely "not already-running" has never been proof of anything.
  let engineStarted = false;
  const startSessionOnce = (): void => {
    if (engineStarted || disowned || tenure === null) return;
    engineStarted = true;
    const owner = tenure;
    let live: PrincipalSession;
    try { live = startEngine(owner); }
    catch (error) {
      // The Control Panel stays usable without a session: the product must
      // still show status and settings when Pi cannot start.
      app.line(`Pi 세션을 시작하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
      app.line("Ctrl+X 로 Dashboard, Config, Mail 은 계속 사용할 수 있습니다.");
      app.draw();
      return;
    }
    session = live;
    owner.adopt(live);
    delivery = new PrincipalDelivery({
      get running() { return live.running; },
      get busy() { return live.busy; },
      onEvent: (listener: (event: PiEvent) => void) => live.onEvent(listener),
      deliver: (batchId: string) => live.deliver(batchId),
      release: () => { live.release("delivery"); },
    }, principalHostBroker(runRoot, settings.config.limits), {
      stateRoot, frameBytes: settings.config.limits.frameBytes,
      acceptMs: settings.config.limits.receiptWaitSeconds * 1000, retryAfterMs: 60_000,
    });
    live.onEvent(event => { if (event.type === "agent_settled") deliver(); });
  };

  // A society this process will not own, or has stopped owning: another `oma`
  // holds it, or no broker of this process's could be kept running.
  //
  // This is a teardown, not a message. Everything that existed because this
  // process owned the society ends here, and the lease is given up only once
  // the engine is actually gone -- the instant the society is free another
  // `oma` may take it and start its own engine, and two engines on one society
  // are two writers of one private workspace and one session history. Leaving
  // "the session the Human was using" alive across that boundary is the same
  // invariant violation as starting a second engine; it just takes longer to
  // notice.
  const disown = async (reason: string): Promise<void> => {
    if (disowned) return;
    disowned = true;
    delivery = null;
    const had = session !== null;
    if (tenure !== null) await tenure.end();
    tenure = null;
    session = null;
    app.line(`이 society의 broker를 이 프로세스가 소유하지 않습니다: ${reason}.`);
    app.line(had
      ? "소유권을 잃어 Pi 세션을 닫았습니다. Ctrl+X 로 Dashboard, Config, Mail 은 계속 사용할 수 있습니다."
      : "권한 있는 대화 세션은 열 수 없습니다. Ctrl+X 로 Dashboard, Config, Mail 은 계속 사용할 수 있습니다.");
    app.draw();
  };

  if (broker === null) {
    // No tenure, so no broker was ever started and nothing was written. The
    // product is a Control Panel over state another `oma` owns.
    await disown(ownershipRefusal);
  } else {
    broker.onReady(() => {
      if (disowned || tenure === null) return;
      tenure.brokerReady();
      startSessionOnce();
      void register().then(deliver);
    });
    broker.onLost(() => { tenure?.brokerLost(); });
    broker.onDisowned(reason => { void disown(reason); });
  }

  const poll = setInterval(() => {
    void transport.status().then(next => { observation = next; app.refresh(); app.draw(); });
    deliver();
  }, 5000);
  poll.unref();
  observation = await transport.status();
  app.refresh();
  app.draw();
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`oma: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(codeFor(error));
});
