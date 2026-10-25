import { PersonalSessionState } from "./personal-state.js";
import { createPersonalConfiguration } from "./personal-configuration.js";
import { createPersonalHistory } from "./personal-history.js";
import { brandHeader, brandFooter } from "./open-tui-brand.js";
import type { PersonalEngineInput, PersonalEnginePorts } from "./personal-ports.js";
import type { OpenTuiBrand } from "@oma/contracts/presentation";
/** Bundled Pi/Open TUI on the Human's cwd and ordinary OS permissions. No
 * Principal, mail, GOAL, broker, role prompt or Society extension is loaded. */
import { lstatSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices,
  DefaultResourceLoader, hasTrustRequiringProjectResources, InteractiveMode, ProjectTrustStore,
  SessionManager, VERSION, type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { StoreError } from "@oma/domain/errors";
import { createEngineSettings } from "./pi-compat/settings.js";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { verifiedPaths } from "@oma/domain/extension-paths";
import { ExtensionModules } from "./extension-modules.js";
import { preparePiRetry } from "./pi-runtime.js";
import { preparePiInteractive } from "./pi-presentation.js";
import { PI_RESUME_HINT } from "./pi-compat/env.js";
import { adaptInteractiveMode, createInteractiveTerminal } from "./pi-compat/interactive-mode.js";

export async function runPersonal(input: PersonalEngineInput, ports: PersonalEnginePorts): Promise<void> {
  const { withSearchTools } = await import("./pi-compat/interactive-tools.js");
  const { birth, agentDir, libdir } = input;
  // C19: project-local resources (.pi, .agents/skills) load only after an
  // explicit trust decision for this exact folder, persisted the way Pi itself
  // persists it. Nothing is trusted silently: a folder with no recorded
  // decision runs untrusted until the Human says otherwise in /oma Config.
  const trustStore = new ProjectTrustStore(agentDir);
  const projectNeedsTrust = hasTrustRequiringProjectResources(birth.cwd);
  let assets = ports.extensions.load();
  ports.assertExtensions(assets.extensions);
  preparePiRetry(ports.settings, agentDir); preparePiInteractive(ports.settings, agentDir);
  const packageResolver = createRequire(import.meta.url);
  const upstream = join(dirname(packageResolver.resolve("pi-open-tui/package.json")), "extensions/open-tui/index.ts");
  // BL2: Personal gets ask_user_question from its own bundled extension file
  // -- the deployment path, not a user-supplied entry, so it is not part of
  // the digest-pinned user list but sits on the same installed footing.
  const askExtension = join(libdir, DEPLOYMENT_LAYOUT.extensionAsk);
  const brand: OpenTuiBrand = { title: "oma", version: input.version,
    engineVersion: VERSION, project: birth.cwd, society: "Personal", mode: "Personal", tip: "Ctrl+X: Config" };
  const state = new PersonalSessionState();
  const config = createPersonalConfiguration(input, ports, state, { store: trustStore, needed: projectNeedsTrust });
  const history = createPersonalHistory(input, ports, state);
  const branded = new WeakSet<object>();
  const boundary: ExtensionFactory = pi => {
    pi.registerCommand("oma", { description: "Personal Config: model, effort and extensions", handler: async (_args, ctx) => config(ctx) });
    pi.registerCommand("society", { description: "Choose Personal or Society before starting a conversation", handler: history.society });
    pi.registerShortcut("ctrl+x", { description: "Personal Config", handler: config });
    // BL2: the ask_user_question presenter — the Personal counterpart of the
    // interactive host's seam. It reads `context` at request time so a
    // question asked with no live session resolves as a structured cancel.
    ports.presentation.registerQuestions(pi, { context: () => state.context });
    pi.on("session_start", (_event, ctx) => {
      const searchCwd = ctx.cwd;
      ctx.ui.addAutocompleteProvider(current => withSearchTools(current, searchCwd));
      state.enter(ctx);
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
    pi.on("session_shutdown", () => { state.leave(); });
  };
  const resume = input.resume;
  if (resume !== undefined) {
    await ports.history.target(resume, birth.cwd);
    if (dirname(resume) !== birth.history || !lstatSync(resume).isFile()) throw new StoreError("INVALID_REQUEST", "Personal history is outside its birth");
  }
  const manager = resume === undefined ? SessionManager.create(birth.cwd, birth.history) : SessionManager.open(resume, birth.history);
  if (manager.getCwd() !== birth.cwd) throw new StoreError("STORE_CORRUPT", "Session history and birth cwd disagree");
  const credentialOwner = await ports.acquireCredentials();
  const write = process.stdout.write, failures: unknown[] = [];
  let credentialClose: Promise<void> | undefined, modules: ExtensionModules | undefined;
  const closeCredentials = (): Promise<void> => credentialClose ??= Promise.resolve().then(() => credentialOwner?.close());
  const failed = (error: unknown): void => { if (!failures.includes(error)) failures.push(error); };
  try {
  modules = new ExtensionModules(verifiedPaths(assets.extensions));
  state.runtime = await createAgentSessionRuntime(async options => {
    if (options.cwd !== birth.cwd || options.sessionManager.getSessionDir() !== birth.history)
      throw new StoreError("INVALID_REQUEST", "Personal history cannot change its birth location");
    ports.assertExtensions(assets.extensions);
    // BL2: the bundled ask extension is an installed deployment file, on the
    // same trust footing as the packaged open-tui upstream beside it.
    const extensionPaths = [...verifiedPaths(assets.extensions), upstream, askExtension];
    // C18: the installed packages' skills, prompt templates and themes, from
    // the store's index -- the same resources the Society engines get by flag.
    const packageResources = ports.extensions.resources();
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
      settingsManager: createEngineSettings(ports.settings, options.cwd, agentDir,
        { projectTrusted: !projectNeedsTrust || trustStore.get(options.cwd) === true }), resourceLoaderOptions: resources() });
    const loader = services.resourceLoader, reload = loader.reload.bind(loader);
    loader.reload = async reloadOptions => {
      assets = ports.extensions.load();
      ports.assertExtensions(assets.extensions);
      extensionPaths.splice(0, extensionPaths.length, ...verifiedPaths(assets.extensions), upstream, askExtension);
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
          if (state.mode !== undefined) await adaptInteractiveMode(state.mode).fail("Personal reload failed", error);
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
  const dispose = state.runtime.dispose.bind(state.runtime), owned = state.runtime;
  let disposal: Promise<void> | undefined;
  state.runtime.dispose = (): Promise<void> => disposal ??= (async () => {
    state.leave();
    const errors: unknown[] = [];
    try { await owned.session.abort(); } catch (error) { errors.push(error); }
    try { await dispose(); } catch (error) { errors.push(error); }
    try { modules?.close(); } catch (error) { errors.push(error); }
    try { await closeCredentials(); } catch (error) { errors.push(error); }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Personal disposal failed");
  })();
  history.bindRuntime();
  // Personal keeps the engine's own /import: a foreign history lands in this
  // birth's directory under the session manager's name, like a Pi user's.
  const terminal = createInteractiveTerminal();
  state.mode = new InteractiveMode(state.runtime, { tuiMode: "fullscreen", terminal });
  const controls = adaptInteractiveMode(state.mode);
  controls.configurePersonal(state.runtime, history.showHistory, terminal);
  // Upstream's exit hint refers to Pi, not the host that owns this birth.
  process.stdout.write = ((chunk: unknown, ...args: unknown[]) =>
    (write as (...values: unknown[]) => boolean).call(process.stdout,
      String(chunk).includes(PI_RESUME_HINT)
        ? "Reopen this Personal session with oma --resume " + state.runtime!.session.sessionFile + "\n" : chunk,
      ...args)) as typeof process.stdout.write;
  await state.mode.run();
  } catch (error) { failed(error); }
  finally {
    state.leave();
    try { state.mode?.stop(); } catch (error) { failed(error); }
    try { await state.runtime?.dispose(); } catch (error) { failed(error); }
    if (state.runtime === undefined) try { modules?.close(); } catch (error) { failed(error); }
    try { await closeCredentials(); } catch (error) { failed(error); }
    process.stdout.write = write;
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Personal execution and cleanup failed");
}
