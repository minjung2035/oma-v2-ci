/** Bundled Pi/Open TUI on the Human's cwd and ordinary OS permissions. No
 * Principal, mail, GOAL, broker, role prompt or Society extension is loaded. */
import { lstatSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices,
  DefaultResourceLoader, hasTrustRequiringProjectResources, InteractiveMode, ModelSelectorComponent, ProjectTrustStore,
  SessionManager, SessionSelectorComponent, SettingsManager,
  ThinkingSelectorComponent, VERSION, type AgentSession, type ExtensionContext, type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { StoreError } from "../domain/errors.js";
import { readSessionBirth } from "../runtime/session-mode.js";
import { sessionBirthForHistory, sessionHistoryDirectories } from "../runtime/session-catalog.js";
import { personalExtensions, personalExtensionEntry, updatePersonalSettings, type PersonalSettingsLocation } from "../runtime/personal-settings.js";
import { packageResourcePaths, readPackageIndex } from "../runtime/pi-packages.js";
import { assertExtensionIntegrity, verifiedPaths } from "../runtime/extension-integrity.js";
import { ExtensionModules } from "../runtime/extension-modules.js";
import { PI_AGENT_DIR_ENV, preparePiInteractive, preparePiRetry } from "../runtime/pi-runtime.js";
import { PI_RESUME_HINT } from "../pi-compat/env.js";
import { interactiveInternalsOf } from "../pi-compat/interactive-mode.js";
import { personalModels } from "../runtime/personal-models.js";
import { isGuestHistoryReference } from "../protocol/guest-history.js";
import { inspectMacGuestHistory, listMacGuestHistories } from "../platform/host/guest-histories.js";
import { brandHeader, brandFooter, type OpenTuiBrand } from "../tui/open-tui-brand.js";

const value = (name: string): string => {
  const at = process.argv.indexOf(name), result = process.argv[at + 1];
  if (at < 0 || result === undefined || process.argv.indexOf(name, at + 1) !== -1) throw new StoreError("INVALID_REQUEST", `Missing ${name}`);
  return result;
};
async function main(): Promise<void> {
  const root = value("--root"), dataRoot = value("--data-root"), libdir = value("--libdir"), packages = value("--packages");
  const birth = readSessionBirth(root), agentDir = process.env[PI_AGENT_DIR_ENV];
  if (birth === null || birth.mode !== "personal" || agentDir === undefined || birth.cwd !== process.cwd())
    throw new StoreError("INVALID_REQUEST", "Personal engine requires its saved birth and cwd");
  const location: PersonalSettingsLocation = { dataRoot, libdir, packages };
  // C19: project-local resources (.pi, .agents/skills) load only after an
  // explicit trust decision for this exact folder, persisted the way Pi itself
  // persists it. Nothing is trusted silently: a folder with no recorded
  // decision runs untrusted until the Human says otherwise in /oma Config.
  const trustStore = new ProjectTrustStore(agentDir);
  const projectNeedsTrust = hasTrustRequiringProjectResources(birth.cwd);
  let assets = personalExtensions(location, updatePersonalSettings(location));
  assertExtensionIntegrity(assets.extensions);
  preparePiRetry(agentDir); preparePiInteractive(agentDir);
  const require = createRequire(import.meta.url);
  const upstream = join(dirname(require.resolve("pi-open-tui/package.json")), "extensions/open-tui/index.ts");
  const brand: OpenTuiBrand = { title: "oma", version: (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }).version,
    engineVersion: VERSION, project: birth.cwd, society: "Personal", mode: "Personal", tip: "Ctrl+X: Config" };
  let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
  let mode: InteractiveMode | undefined, context: ExtensionContext | undefined, switching = false, replacing = false;
  let uiEpoch = 0;
  const current = (epoch: number): boolean => !switching && context !== undefined && epoch === uiEpoch;
  const beforeSwitch = async (reason: "new" | "resume", file?: string): Promise<boolean> => {
    const result = await runtime!.session.extensionRunner.emit({ type: "session_before_switch", reason,
      ...(file === undefined ? {} : { targetSessionFile: file }) });
    return result?.cancel !== true;
  };
  const transition = async (epoch: number, file?: string): Promise<void> => {
    if (!current(epoch)) return;
    if (file !== undefined && !lstatSync(file).isFile()) throw new StoreError("INVALID_REQUEST", "Session history is not a regular file");
    if (process.send === undefined || mode === undefined) throw new StoreError("BROKER_UNAVAILABLE", "Personal host channel is unavailable");
    switching = true;
    try {
      await new Promise<void>((resolve, reject) => process.send!({ type: "switch", ...(file === undefined ? {} : { session: file }) },
        error => { if (error) reject(error); else resolve(); }));
    } catch (error) { switching = false; throw error; }
    await interactiveInternalsOf(mode).shutdown();
  };
  const modelConfig = async (ctx: ExtensionContext, epoch: number): Promise<void> => {
    const session = runtime!.session;
    const model = await ctx.ui.custom<NonNullable<AgentSession["model"]> | undefined>((tui, _theme, _keys, done) =>
      new ModelSelectorComponent(tui, session.model, session.modelRuntime, session.scopedModels, done, () => done(undefined)));
    if (!model || !current(epoch)) return;
    await session.setModel(model, { persist: true });
    if (!current(epoch)) return;
    const levels = session.getAvailableThinkingLevels();
    const level = levels.length <= 1 ? levels[0] : await ctx.ui.custom<AgentSession["thinkingLevel"] | undefined>((_tui, _theme, _keys, done) =>
      new ThinkingSelectorComponent(session.thinkingLevel, levels, done, () => done(undefined), done));
    if (level !== undefined && current(epoch)) { session.setThinkingLevel(level); runtime!.services.settingsManager.setDefaultThinkingLevel(level); }
  };
  const config = async (ctx: ExtensionContext): Promise<void> => {
    const epoch = uiEpoch;
    if (!current(epoch)) return;
    // The trust row appears only when the folder actually holds gated
    // resources; otherwise there is nothing the decision would change.
    const trustRow = `Project trust — ${trustStore.get(birth.cwd) === true ? "trusted" : "not trusted"}`;
    const choice = await ctx.ui.select("Config — Personal (fixed for this session)",
      ["Model / effort", "Extensions", ...(projectNeedsTrust ? [trustRow] : []), "Back"]);
    if (!current(epoch)) return;
    if (choice === "Model / effort") { await modelConfig(ctx, epoch); return; }
    if (choice === trustRow && projectNeedsTrust) {
      const trusted = trustStore.get(birth.cwd) === true;
      const picked = await ctx.ui.select(
        `Trust ${birth.cwd}? This lets Pi load the project's .pi settings and resources (skills, prompt templates, context files). ` +
        `Extensions stay pinned to your saved list; trusting never loads a project extension.`,
        [trusted ? "Stop trusting this project" : "Trust this project", "Back"]);
      if (!current(epoch) || picked === undefined || picked === "Back") return;
      const next = !trusted;
      // The decision is persisted before it takes effect, and the session
      // reloads so the loader re-resolves every gated resource with it.
      trustStore.set(birth.cwd, next);
      runtime!.services.settingsManager.setProjectTrusted(next);
      ctx.ui.notify(next ? "Project trusted. Reloading this session to apply it."
        : "Project no longer trusted. Reloading this session to apply it.", "info");
      await runtime!.session.reload();
      return;
    }
    if (choice !== "Extensions") return;
    const saved = updatePersonalSettings(location);
    const entries = [...new Set([...saved.extensions, ...readPackageIndex(packages).flatMap(item => item.entries)])];
    const rows = entries.map(entry => `${saved.extensions.includes(entry) ? "[on]" : "[off]"} ${entry}`);
    const picked = await ctx.ui.select("Personal extensions — reload to apply", [...rows, "Add extension path", "Back"]);
    if (!current(epoch) || picked === undefined || picked === "Back") return;
    const raw = picked === "Add extension path" ? await ctx.ui.input("Extension entry (relative to installation, packages:..., or an absolute path)")
      : entries[rows.indexOf(picked)];
    // C20: an absolute path is stored under its local: spelling so the saved
    // entry is unambiguous next to installation- and store-relative ones.
    const entry = raw === undefined ? undefined : personalExtensionEntry(raw);
    if (!entry || !current(epoch)) return;
    updatePersonalSettings(location, [], { entry, enabled: !saved.extensions.includes(entry) });
    ctx.ui.notify("Personal extension choice saved. Reloading this session to apply it.", "info");
    // Pi has not written an empty session yet. Reload preserves that manager,
    // its pending entries and its birth instead of reopening a nonexistent file.
    await runtime!.session.reload();
  };
  const branded = new WeakSet<object>();
  const boundary: ExtensionFactory = pi => {
    pi.registerCommand("oma", { description: "Personal Config: model, effort and extensions", handler: async (_args, ctx) => config(ctx) });
    pi.registerShortcut("ctrl+x", { description: "Personal Config", handler: config });
    pi.on("session_start", (_event, ctx) => {
      uiEpoch++; context = ctx;
      ctx.ui.setStatus("oma-mode", "Personal");
      if (!branded.has(ctx.ui)) {
        branded.add(ctx.ui);
      const header = ctx.ui.setHeader.bind(ctx.ui), footer = ctx.ui.setFooter.bind(ctx.ui);
      ctx.ui.setHeader = factory => header(factory && ((tui, theme) => {
        const inner = factory(tui, theme);
        return { render: width => brandHeader(inner.render(width), brand, text => theme.fg("accent", text)),
          invalidate: () => inner.invalidate(), dispose: () => (inner as { dispose?(): void }).dispose?.() };
      }));
      ctx.ui.setFooter = factory => footer(factory && ((tui, theme, data) => {
        const inner = factory(tui, theme, data);
        return { render: width => brandFooter(inner.render(width), brand), invalidate: () => inner.invalidate(),
          dispose: () => (inner as { dispose?(): void }).dispose?.() };
      }));
      }
      for (const missing of assets.missing) ctx.ui.notify(`Personal extension is missing: ${missing}`, "warning");
    });
    pi.on("session_shutdown", () => { uiEpoch++; context = undefined; });
  };
  const resume = process.argv.includes("--resume") ? value("--resume") : undefined;
  if (resume !== undefined) {
    await sessionBirthForHistory(dataRoot, resume, birth.cwd);
    if (dirname(resume) !== birth.history || !lstatSync(resume).isFile()) throw new StoreError("INVALID_REQUEST", "Personal history is outside its birth");
  }
  const manager = resume === undefined ? SessionManager.create(birth.cwd, birth.history) : SessionManager.open(resume, birth.history);
  if (manager.getCwd() !== birth.cwd) throw new StoreError("STORE_CORRUPT", "Session history and birth cwd disagree");
  const credentialOwner = await personalModels(libdir, agentDir);
  const write = process.stdout.write, failures: unknown[] = [];
  let credentialClose: Promise<void> | undefined, modules: ExtensionModules | undefined;
  const closeCredentials = (): Promise<void> => credentialClose ??= Promise.resolve().then(() => credentialOwner?.close());
  const failed = (error: unknown): void => { if (!failures.includes(error)) failures.push(error); };
  try {
  modules = new ExtensionModules(verifiedPaths(assets.extensions));
  runtime = await createAgentSessionRuntime(async options => {
    if (options.cwd !== birth.cwd || options.sessionManager.getSessionDir() !== birth.history)
      throw new StoreError("INVALID_REQUEST", "Personal history cannot change its birth location");
    assertExtensionIntegrity(assets.extensions);
    const extensionPaths = [...verifiedPaths(assets.extensions), upstream];
    // C18: the installed packages' skills, prompt templates and themes, from
    // the store's index -- the same resources the Society engines get by flag.
    const packageResources = packageResourcePaths(packages);
    const resources = (): ConstructorParameters<typeof DefaultResourceLoader>[0] => ({
      cwd: options.cwd, agentDir,
      // Personal keeps Pi's ordinary semantics: skills, prompt templates and
      // context files are discovered, and Pi's own prompt composition runs.
      // Only extension discovery stays pinned to the selected files.
      noExtensions: true,
      additionalExtensionPaths: extensionPaths, extensionFactories: [boundary],
      ...(packageResources === undefined ? {} : {
        additionalSkillPaths: [...packageResources.skills],
        additionalPromptTemplatePaths: [...packageResources.prompts],
        additionalThemePaths: [...packageResources.themes],
      }),
      extensionsOverride: loaded => {
        if (loaded.errors.length || !loaded.extensions.some(extension => extension.resolvedPath === upstream)) {
          const error = new StoreError("UNSUPPORTED_PROFILE", `Personal extensions could not load: ${loaded.errors.map(error => `${error.path}: ${error.error}`).join("; ")}`);
          try { loaded.runtime.invalidate(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Personal extension load and cleanup failed"); }
          throw error;
        }
        const own = loaded.extensions.filter(extension => extension.path.startsWith("<inline:"));
        return { ...loaded, extensions: [...own, ...loaded.extensions.filter(extension => !extension.path.startsWith("<inline:"))] };
      },
    });
    const services = await createAgentSessionServices({ ...options,
      ...(credentialOwner === undefined ? {} : { modelRuntime: credentialOwner.modelRuntime }),
      // The recorded decision is the only source: absent means untrusted when
      // the folder holds gated resources, and trivially trusted when it does
      // not (upstream's own rule -- there is nothing the gate could hold back).
      settingsManager: SettingsManager.create(options.cwd, agentDir,
        { projectTrusted: !projectNeedsTrust || trustStore.get(options.cwd) === true }), resourceLoaderOptions: resources() });
    const loader = services.resourceLoader, reload = loader.reload.bind(loader);
    loader.reload = async reloadOptions => {
      assets = personalExtensions(location, updatePersonalSettings(location));
      assertExtensionIntegrity(assets.extensions);
      extensionPaths.splice(0, extensionPaths.length, ...verifiedPaths(assets.extensions), upstream);
      modules!.refresh(verifiedPaths(assets.extensions));
      // The already-loaded Pi owner clears its own module cache on reload. A new
      // loader would reuse factories from before the file's verified update.
      await reload(reloadOptions);
    };
    // Skills are discovered and their commands come with them: the engine's
    // persisted settings file carries no suppression (preparePiInteractive
    // scrubs the old pin), so no override is needed here.
    // No excludeTools, workspace guard, role prompt, proxy or Society extension.
    try {
      const created = await createAgentSessionFromServices({ services, sessionManager: options.sessionManager,
        ...(options.sessionStartEvent === undefined ? {} : { sessionStartEvent: options.sessionStartEvent }) });
      const sessionReload = created.session.reload.bind(created.session);
      created.session.reload = async reloadOptions => {
        try { await sessionReload(reloadOptions); }
        catch (error) {
          try { services.resourceLoader.getExtensions().runtime.invalidate(); }
          catch (cleanup) { error = new AggregateError([error, cleanup], "Personal reload and cleanup failed"); }
          if (mode !== undefined) await interactiveInternalsOf(mode).handleFatalRuntimeError("Personal reload failed", error);
          throw error;
        }
      };
      return { ...created, services, diagnostics: services.diagnostics };
    } catch (error) {
      try { services.resourceLoader.getExtensions().runtime.invalidate(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "Personal creation and cleanup failed"); }
      throw error;
    }
  }, { cwd: birth.cwd, agentDir, sessionManager: manager });
  // Upstream shutdown disposes this handle before process.exit, so its dispose
  // boundary owns the helper handoff too. A finally after run cannot own that.
  const dispose = runtime.dispose.bind(runtime), owned = runtime;
  let disposal: Promise<void> | undefined;
  runtime.dispose = (): Promise<void> => disposal ??= (async () => {
    uiEpoch++; context = undefined;
    const errors: unknown[] = [];
    try { await owned.session.abort(); } catch (error) { errors.push(error); }
    try { await dispose(); } catch (error) { errors.push(error); }
    try { modules?.close(); } catch (error) { errors.push(error); }
    try { await closeCredentials(); } catch (error) { errors.push(error); }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Personal disposal failed");
  })();
  // Every new session returns to birth selection, including an extension's call.
  const sameBirthSwitch = runtime.switchSession.bind(runtime);
  runtime.newSession = async options => {
    const epoch = uiEpoch;
    if (!current(epoch) || replacing) return { cancelled: true };
    if (options && Object.values(options).some(value => value !== undefined))
      throw new StoreError("INVALID_REQUEST", "A new OMA session selects its birth before extension setup");
    replacing = true;
    try { if (await beforeSwitch("new")) await transition(epoch); }
    finally { replacing = false; }
    return { cancelled: true };
  };
  runtime.switchSession = async (file, options) => {
    const epoch = uiEpoch;
    if (!current(epoch) || replacing) return { cancelled: true };
    replacing = true;
    try {
      if (process.platform === "darwin" && isGuestHistoryReference(file)) {
        await inspectMacGuestHistory(dataRoot, file);
        if (!current(epoch)) return { cancelled: true };
        if (options && Object.values(options).some(value => value !== undefined))
          throw new StoreError("INVALID_REQUEST", "Cross-birth resume cannot carry callbacks or cwd overrides");
        if (await beforeSwitch("resume", file)) await transition(epoch, file);
        return { cancelled: true };
      }
      const target = await sessionBirthForHistory(dataRoot, file, birth.cwd);
      if (!current(epoch)) return { cancelled: true };
      if (target.id === birth.id && target.mode === "personal") return await sameBirthSwitch(file, options);
      if (options && Object.values(options).some(value => value !== undefined))
        throw new StoreError("INVALID_REQUEST", "Cross-birth resume cannot carry callbacks or cwd overrides");
      if (await beforeSwitch("resume", file)) await transition(epoch, file);
      return { cancelled: true };
    } finally { replacing = false; }
  };
  // Personal keeps the engine's own /import: a foreign history lands in this
  // birth's directory under the session manager's name, like a Pi user's.
  mode = new InteractiveMode(runtime, { tuiMode: "fullscreen" });
  // The private members replaced below are all named in
  // pi-compat/interactive-mode.ts.
  const presentation = interactiveInternalsOf(mode);
  const fatal = presentation.handleFatalRuntimeError.bind(presentation);
  presentation.handleFatalRuntimeError = async (prefix, error) => {
    try { await runtime!.dispose(); }
    catch (cleanup) { error = new AggregateError([error, cleanup], "Personal failure and cleanup failed"); }
    await fatal(prefix, error);
  };
  presentation.renderProjectTrustWarningIfNeeded = () => {};
  presentation.crashReportInstructions = () => "Start oma --mode personal and reopen this session with /resume.";
  presentation.updateTerminalTitle = () => presentation.ui.terminal.setTitle("oma — Personal");
  presentation.showSessionSelector = () => {
    const ctx = context, epoch = uiEpoch;
    if (!ctx || !current(epoch)) return;
    void ctx.ui.custom<void>((tui, _theme, keybindings, done) => {
      const load = async (_progress: unknown, signal?: AbortSignal) => {
        const found = [];
        for (const entry of sessionHistoryDirectories(dataRoot, birth.cwd)) {
          signal?.throwIfAborted();
          const sessions = await SessionManager.listAll(entry.dir, undefined, signal);
          found.push(...sessions.map(info => ({ ...info, name: `[${entry.mode === "personal" ? "Personal" : "Society"}] ${info.name ?? ""}`.trim() })));
        }
        if (process.platform === "darwin") {
          try { found.push(...await listMacGuestHistories(dataRoot, libdir, signal)); }
          catch (error) {
            signal?.throwIfAborted();
            if (current(epoch)) ctx.ui.notify(`Guest histories unavailable: ${String(error)}`, "warning");
          }
        }
        return current(epoch) ? found.sort((a, b) => b.modified.getTime() - a.modified.getTime()) : [];
      };
      return new SessionSelectorComponent(load, load, file => { done(); if (current(epoch)) void runtime!.switchSession(file)
        .catch(error => { if (current(epoch)) ctx.ui.notify(String(error), "error"); }); },
        done, () => { done(); if (current(epoch)) void interactiveInternalsOf(mode!).shutdown(); }, () => tui.requestRender(),
        { keybindings, showRenameHint: false }, runtime!.session.sessionFile);
    }).catch(error => { if (current(epoch)) ctx.ui.notify(String(error), "error"); });
  };
  // Upstream's exit hint refers to Pi, not the host that owns this birth.
  process.stdout.write = ((chunk: unknown, ...args: unknown[]) =>
    (write as (...values: unknown[]) => boolean).call(process.stdout,
      String(chunk).includes(PI_RESUME_HINT)
        ? "Reopen this Personal session with oma --resume " + runtime!.session.sessionFile + "\n" : chunk,
      ...args)) as typeof process.stdout.write;
  await mode.run();
  } catch (error) { failed(error); }
  finally {
    uiEpoch++; context = undefined;
    try { mode?.stop(); } catch (error) { failed(error); }
    try { await runtime?.dispose(); } catch (error) { failed(error); }
    if (runtime === undefined) try { modules?.close(); } catch (error) { failed(error); }
    try { await closeCredentials(); } catch (error) { failed(error); }
    process.stdout.write = write;
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Personal execution and cleanup failed");
}
main().catch(error => { process.stderr.write(`oma: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
