import { ModelSelectorComponent, ThinkingSelectorComponent, type AgentSession, type ExtensionContext, type ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import type { PersonalEngineInput, PersonalEnginePorts } from "./personal-ports.js";
import type { PersonalSessionState } from "./personal-state.js";
/** Personal configuration owns model, effort, trust and extension selections. */
export function createPersonalConfiguration(input: PersonalEngineInput, ports: PersonalEnginePorts, state: PersonalSessionState,
  trust: { readonly store: Pick<ProjectTrustStore, "get" | "set">; readonly needed: boolean }) {
  const { birth } = input;
  const trustStore = trust.store, projectNeedsTrust = trust.needed;
  const current = (epoch: number): boolean => state.current(epoch);
  const modelConfig = async (ctx: ExtensionContext, epoch: number): Promise<void> => {
    const session = state.runtime!.session;
    const model = await ctx.ui.custom<NonNullable<AgentSession["model"]> | undefined>((tui, _theme, _keys, done) =>
      new ModelSelectorComponent(tui, session.model, session.modelRuntime, session.scopedModels, done, () => done(undefined)));
    if (!model || !current(epoch)) return;
    await session.setModel(model, { persist: true });
    if (!current(epoch)) return;
    const levels = session.getAvailableThinkingLevels();
    const level = levels.length <= 1 ? levels[0] : await ctx.ui.custom<AgentSession["thinkingLevel"] | undefined>((_tui, _theme, _keys, done) =>
      new ThinkingSelectorComponent(session.thinkingLevel, levels, done, () => done(undefined), done));
    if (level !== undefined && current(epoch)) { session.setThinkingLevel(level); state.runtime!.services.settingsManager.setDefaultThinkingLevel(level); }
  };
  const config = async (ctx: ExtensionContext): Promise<void> => {
    const epoch = state.epoch;
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
      state.runtime!.services.settingsManager.setProjectTrusted(next);
      ctx.ui.notify(next ? "Project trusted. Reloading this session to apply it."
        : "Project no longer trusted. Reloading this session to apply it.", "info");
      await state.runtime!.session.reload();
      return;
    }
    if (choice !== "Extensions") return;
    const saved = ports.extensions.readSelection();
    const entries = [...new Set([...saved.extensions, ...ports.extensions.availableEntries()])];
    const rows = entries.map(entry => `${saved.extensions.includes(entry) ? "[on]" : "[off]"} ${entry}`);
    const picked = await ctx.ui.select("Personal extensions — reload to apply", [...rows, "Add extension path", "Back"]);
    if (!current(epoch) || picked === undefined || picked === "Back") return;
    const raw = picked === "Add extension path" ? await ctx.ui.input("Extension entry (relative to installation, packages:..., or an absolute path)")
      : entries[rows.indexOf(picked)];
    // C20: an absolute path is stored under its local: spelling so the saved
    // entry is unambiguous next to installation- and store-relative ones.
    const entry = raw === undefined ? undefined : ports.extensions.entry(raw);
    if (!entry || !current(epoch)) return;
    ports.extensions.select(entry, !saved.extensions.includes(entry));
    // Pi has not written an empty session yet. Reload preserves that manager,
    // its pending entries and its birth instead of reopening a nonexistent file.
    await state.runtime!.session.reload();
    // Reload replaces the UI context; confirm on the screen that now owns it.
    if (!state.switching) state.context?.ui.notify("Personal extension choice saved. Reloaded this session to apply it.", "info");
  };
  return config;
}
