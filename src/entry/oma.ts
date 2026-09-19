/** TUI-002/003: the host product entrypoint.
 *
 * This is the `oma` a Human runs. It is a different executable from the
 * model-facing CLI in the Resident rootfs (src/cli.ts) and shares no argv
 * parser, capability or socket with it. Nothing here is mounted into a sandbox.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidSocietyName } from "../ids.js";
import { DEPLOYMENT_LAYOUT } from "../domain/deployment.js";
import { resolvePiRuntime } from "../runtime/pi-runtime.js";
import { ensureDirectory } from "../storage/directory.js";
import { TuiApp, type AppPorts } from "../tui/app.js";
import { codeFor, fail } from "../tui/exit.js";
import { openTerminal } from "../tui/screen.js";
import { dashboardData } from "../tui/dashboard.js";
import { PrincipalSession, newSessionHandle, principalEnvironment, principalSessionProfile } from "../tui/session.js";
import { principalCredentialPath, isPrincipalCredential } from "../protocol/principal-credential.js";
import { TuiTransport, limitsOf, type Observation } from "../tui/transport.js";
import { principalMailbox, readBody, readMailbox, unreadCount } from "../tui/sources/mail.js";
import { readExtensions, toggleExtension } from "../tui/sources/extensions.js";
import { commitField, readSettings, writeSettings, type Settings } from "../tui/sources/settings.js";
import { defaultHostConfig, societyFromDirectory } from "../config/defaults.js";
import { provisionSociety, residentRootfsPath, type ProvisionReport } from "../runtime/provision.js";
import { superviseBroker, type BrokerHandle } from "../runtime/broker-supervisor.js";
import { deploymentDigest } from "../runtime/deployment-manifest.js";
import type { ExtensionRow, MailRow } from "../tui/model.js";

function usage(): never {
  process.stderr.write("usage: oma [--society <name>] [--config <path>]\n");
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

/** The credential the running broker published for this run, or null.
 *
 * Null is a real answer and is shown as one: there is no broker, or the file is
 * not a credential, so the Principal starts without society authority instead of
 * starting with a value that would fail at the first request for a reason the
 * user could not see. */
function runningBrokerCredential(runRoot: string): string | null {
  let text: string;
  try { text = readFileSync(principalCredentialPath(runRoot), "utf8"); }
  catch { return null; }
  const value = text.trim();
  return isPrincipalCredential(value) ? value : null;
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
  const society = argOf(argv, "--society") ?? societyFromDirectory(process.cwd());
  if (!isValidSocietyName(society)) usage();
  const stateRoot = join(process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? "/tmp", ".local", "share"), "oma", society);
  const runRoot = join(process.env.XDG_RUNTIME_DIR ?? "/tmp", "oma", society);
  const configPath = argOf(argv, "--config") ?? join(stateRoot, "config.json");

  let settings: Settings;
  try { settings = ensureConfiguration(configPath, society, stateRoot); }
  catch (error) { fail(`설정을 읽을 수 없습니다: ${error instanceof Error ? error.message : String(error)}`, codeFor(error)); }
  if (settings.config.society !== society)
    fail("설정의 society가 요청한 society와 다릅니다", 4);

  // The society's state tree has to exist before anything can observe it: the
  // broker opens a ledger and reads a canonical repository at startup. This is
  // idempotent, so it runs every time rather than being a setup command the
  // user has to remember (TUI-002).
  let provisioned: ProvisionReport;
  try { provisioned = provisionSociety(stateRoot, { projectDir: process.cwd() }); }
  catch (error) { fail(`society를 준비하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`, codeFor(error)); }

  const mailbox = principalMailbox(stateRoot);
  const transport = new TuiTransport(stateRoot, society, settings.config.limits.frameBytes);
  let observation: Observation = { kind: "unknown", reason: "아직 관측하지 않음", observedAtMs: Date.now() };
  let extensionContext = readExtensions(configPath, settings.config.principalProfile, settings.workerProfile);

  const reload = (): void => {
    settings = readSettings(configPath);
    extensionContext = readExtensions(configPath, settings.config.principalProfile, settings.workerProfile);
  };

  const terminal = openTerminal({ input: process.stdin, output: process.stdout });
  let session: PrincipalSession | null = null;

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
      commitField(settings, field, value);
      reload();
    },
    setExtension: (id, role, enabled) => {
      toggleExtension(extensionContext, id, role, enabled);
      reload();
    },
    submitPrompt: (text: string) => {
      if (session === null) { app.note("Pi 세션이 없어 전송할 수 없습니다."); return; }
      void session.submit(text).catch((error: unknown) => {
        app.note(`전송 실패: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
    quit: () => { shutdown(0); },
  };

  const app = new TuiApp(ports, terminal);
  app.refresh();

  let broker: BrokerHandle | null = null;
  let finished = false;
  const shutdown = (code: number): void => {
    if (finished) return;
    finished = true;
    session?.close();
    broker?.stop();
    terminal.restore();
    process.exit(code);
  };

  process.on("uncaughtException", error => { terminal.restore(); process.stderr.write(`oma: ${String(error)}\n`); process.exit(3); });
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  terminal.onResize(() => app.draw());
  terminal.onKeys(chunk => app.feed(chunk));

  // One command starts the society. A broker another `oma` already owns is left
  // alone, and a broker this process started is stopped when it exits. It
  // starts before the engine because the engine's authority comes from the
  // credential the running broker publishes: a session started first would hold
  // no authority and could not be given one afterwards.
  broker = await superviseBroker({
    node: process.execPath, libdir: settings.config.installation.libdir,
    society, runRoot, configPath,
    onEvent: line => { app.line(`broker: ${line}`); app.draw(); },
  });
  if (broker.state.kind === "unavailable")
    app.line(`broker를 시작하지 못했습니다: ${broker.state.reason}. Dashboard 관측값은 unknown으로 남습니다.`);

  // OMA runs the engine it shipped with; it never resolves Pi from PATH, and it
  // gives that engine its own agent directory so a Pi the user installed keeps
  // its configuration, extensions and sessions to itself.
  const piRuntime = resolvePiRuntime({
    stateRoot, libdir: settings.config.installation.libdir, override: process.env.OMA_PI_COMMAND,
  });
  ensureDirectory(piRuntime.agentDir, 0o700);
  const coreExtension = join(settings.config.installation.libdir, DEPLOYMENT_LAYOUT.extension);
  const credential = runningBrokerCredential(runRoot);
  if (credential === null)
    app.line("broker가 없어 Principal은 사회에 요청을 보낼 수 없습니다. 메일·설정 화면은 그대로 사용할 수 있습니다.");
  try {
    const profile = principalSessionProfile(configPath, society);
    session = PrincipalSession.start(
      { piCommand: piRuntime.executable, piArgs: piRuntime.args, piAgentDir: piRuntime.agentDir,
        coreExtension, sessionDir: join(stateRoot, "principal", "private", "sessions"),
        workspace: join(stateRoot, "principal", "private"), home: join(stateRoot, "principal", "private") },
      profile,
      limitsOf(settings.config.limits),
      principalEnvironment(
        { stateRoot, runRoot, libdir: settings.config.installation.libdir },
        profile, settings.config.limits, { credential, sessionHandle: newSessionHandle() },
      ),
      {
        onLine: line => app.line(line),
        onBusy: busy => app.setBusy(busy),
        onEnd: reason => { session = null; app.line(reason); },
      },
    );
    app.line(`OMA · society ${society}. Ctrl+X 로 관리 화면을 엽니다.`);
    // Said once, on the start that decided it, so the user knows what the
    // society is working on.
    if (provisioned.seedSource === "project")
      app.line("이 프로젝트의 커밋된 HEAD로 society를 시작했습니다. 커밋되지 않은 변경은 포함되지 않습니다.");
    else if (provisioned.seedSource === "empty")
      app.line(`빈 저장소로 society를 시작했습니다${provisioned.seedNote ? ` (${provisioned.seedNote})` : ""}.`);
  } catch (error) {
    // The Control Panel stays usable without a session: the product must still
    // show status and settings when Pi cannot start.
    app.line(`Pi 세션을 시작하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    app.line("Ctrl+X 로 Dashboard, Config, Mail 은 계속 사용할 수 있습니다.");
  }

  const poll = setInterval(() => {
    void transport.status().then(next => { observation = next; app.refresh(); app.draw(); });
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
