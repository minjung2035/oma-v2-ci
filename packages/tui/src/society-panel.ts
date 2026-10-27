/** Society panel actions and views. Runtime supplies observations of the live
 * conversation; settings writes retain the project's own tenure check. */
import type { AppPorts } from "./app.js";
import type { HostConfig } from "@oma/contracts";
import type { BootstrapState, FieldValue } from "@oma/domain/settings-policy";
import type { ExtensionRow } from "./model.js";
import type { Observation } from "@oma/protocol/status-view";
import { dashboardData } from "./dashboard.js";
import { PRINCIPAL_MODEL, WORKER_MODEL, bootstrapStateOf, fieldsOf, followsEngine, workerModelText } from "@oma/domain/settings-policy";

export interface PanelState {
  readonly observation: Observation;
  readonly owned: boolean;
  readonly conversationOpen: boolean;
  readonly screenReady: boolean;
  readonly sessionModel: string | null;
  readonly engine: { readonly model: string | null; readonly thinking: string | null };
}

/** Complete presentation data; no path, managed generation or storage handles. */
export interface SocietySettingsView {
  readonly config: HostConfig;
  readonly workerProfile: string | null;
  readonly unread: string | null;
  readonly extensions: readonly ExtensionRow[];
}
export interface SocietyPanelEffects {
  readonly settings: () => SocietySettingsView;
  readonly unread: () => number | null;
  readonly mail: AppPorts["mail"];
  readonly body: AppPorts["body"];
  readonly saveField: (field: string, value: FieldValue, bootstrap: BootstrapState) => ReturnType<AppPorts["setField"]>;
  readonly setExtension: AppPorts["setExtension"];
}

export function societyPanelPorts(effects: SocietyPanelEffects, observe: () => PanelState):
    Pick<AppPorts, "configFields" | "dashboard" | "mail" | "extensions" | "body" | "setField" | "setExtension"> {
  const follows = (config: HostConfig): boolean => {
    return followsEngine(config.modelProfiles[config.agentProfiles[config.principalProfile]?.modelProfile ?? ""]);
  };
  const engineText = (state: PanelState): string | null => state.engine.model === null ? null
    : `${state.engine.model}${state.engine.thinking === null ? "" : ` · ${state.engine.thinking}`}`;
  return {
    configFields: () => {
      const state = observe(), settings = effects.settings();
      if (settings.unread !== null)
        return fieldsOf(settings.config, settings.workerProfile).map(field => field.kind === "link" ? field
          : Object.freeze({ kind: "choice" as const, id: field.id, label: field.label, value: "?", options: Object.freeze([]),
            apply: field.apply, blocked: `Could not read settings back: ${settings.unread}` }));
      const fields = fieldsOf(settings.config, settings.workerProfile, bootstrapStateOf(state.observation));
      if (!state.owned) return fields;
      const unavailable = !state.conversationOpen || !state.screenReady ? "Available while the conversation is open" : null;
      return fields.map(field => {
        if (field.id === PRINCIPAL_MODEL && follows(settings.config))
          return Object.freeze({ kind: "link" as const, id: field.id, label: field.label, value: engineText(state) ?? "unknown", blocked: unavailable });
        if (field.id === WORKER_MODEL)
          return Object.freeze({ kind: "link" as const, id: field.id, label: field.label, blocked: field.blocked ?? unavailable,
            value: workerModelText(settings.config, settings.workerProfile) });
        return field;
      });
    },
    dashboard: () => {
      const state = observe(), settings = effects.settings(), engine = engineText(state);
      return dashboardData({ config: settings.config, principalModel: {
        configured: settings.unread === null ? settings.config.agentProfiles[settings.config.principalProfile]?.modelProfile ?? "unknown" : "unknown",
        session: state.conversationOpen ? state.sessionModel : null,
        ...(engine === null ? {} : { engine }),
        engineManaged: settings.unread === null && follows(settings.config),
      },
      ...(settings.unread === null ? { workerModel: workerModelText(settings.config, settings.workerProfile) } : {}),
      unread: effects.unread(), observation: state.observation });
    },
    mail: effects.mail,
    extensions: () => effects.settings().extensions,
    body: effects.body,
    setField: (field, value) => effects.saveField(field, value, bootstrapStateOf(observe().observation)),
    setExtension: effects.setExtension,
  };
}
