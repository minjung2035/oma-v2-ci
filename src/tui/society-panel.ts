/** Society panel actions and views. Runtime supplies observations of the live
 * conversation; settings writes retain the project's own tenure check. */
import type { AppPorts } from "./app.js";
import type { ProjectSessionSettings } from "./project-session-settings.js";
import type { Observation } from "./transport.js";
import { dashboardData } from "./dashboard.js";
import { principalMailbox, readBody, readMailbox, unreadCount } from "./sources/mail.js";
import { PRINCIPAL_MODEL, WORKER_MODEL, bootstrapStateOf, fieldsOf, followsEngine, workerModelText } from "./sources/settings.js";
import { storedMailBytes } from "../domain/mail-values.js";

interface PanelState {
  readonly observation: Observation;
  readonly owned: boolean;
  readonly conversationOpen: boolean;
  readonly screenReady: boolean;
  readonly sessionModel: string | null;
  readonly engine: { readonly model: string | null; readonly thinking: string | null };
}

export function societyPanelPorts(configuration: ProjectSessionSettings,
    mailbox: ReturnType<typeof principalMailbox>, observe: () => PanelState):
    Pick<AppPorts, "configFields" | "dashboard" | "mail" | "extensions" | "body" | "setField" | "setExtension"> {
  const follows = (): boolean => {
    const { config } = configuration.settings;
    return followsEngine(config.modelProfiles[config.agentProfiles[config.principalProfile]?.modelProfile ?? ""]);
  };
  const engineText = (state: PanelState): string | null => state.engine.model === null ? null
    : `${state.engine.model}${state.engine.thinking === null ? "" : ` · ${state.engine.thinking}`}`;
  return {
    configFields: () => {
      const state = observe(), settings = configuration.settings;
      if (configuration.unread !== null)
        return fieldsOf(settings.config, settings.workerProfile).map(field => field.kind === "link" ? field
          : Object.freeze({ kind: "choice" as const, id: field.id, label: field.label, value: "?", options: Object.freeze([]),
            apply: field.apply, blocked: `Could not read settings back: ${configuration.unread}` }));
      const fields = fieldsOf(settings.config, settings.workerProfile, bootstrapStateOf(state.observation));
      if (!state.owned) return fields;
      const unavailable = !state.conversationOpen || !state.screenReady ? "Available while the conversation is open" : null;
      return fields.map(field => {
        if (field.id === PRINCIPAL_MODEL && follows())
          return Object.freeze({ kind: "link" as const, id: field.id, label: field.label, value: engineText(state) ?? "unknown", blocked: unavailable });
        if (field.id === WORKER_MODEL)
          return Object.freeze({ kind: "link" as const, id: field.id, label: field.label, blocked: field.blocked ?? unavailable,
            value: workerModelText(settings.config, settings.workerProfile) });
        return field;
      });
    },
    dashboard: () => {
      const state = observe(), settings = configuration.settings, engine = engineText(state);
      return dashboardData({ config: settings.config, principalModel: {
        configured: configuration.unread === null ? settings.config.agentProfiles[settings.config.principalProfile]?.modelProfile ?? "unknown" : "unknown",
        session: state.conversationOpen ? state.sessionModel : null,
        ...(engine === null ? {} : { engine }),
        engineManaged: configuration.unread === null && follows(),
      },
      ...(configuration.unread === null ? { workerModel: workerModelText(settings.config, settings.workerProfile) } : {}),
      unread: unreadCount(mailbox), observation: state.observation });
    },
    mail: () => {
      const { observation } = observe();
      return readMailbox(mailbox, observation.kind === "observed" ? observation.statuses.map(status => status.agent) : undefined);
    },
    extensions: () => configuration.extensions.rows,
    body: path => path.length === 0 ? null : readBody(path, storedMailBytes(configuration.settings.config.limits.mailBodyBytes)),
    setField: (field, value) => configuration.saveField(field, value, bootstrapStateOf(observe().observation)),
    setExtension: (id, role, enabled) => configuration.setExtension(id, role, enabled),
  };
}
