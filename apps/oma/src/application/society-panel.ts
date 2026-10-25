/** Application binds settings/mail effects to the TUI's data-only panel API. */
import { societyPanelPorts as composePanel, type PanelState } from "@oma/tui/society-panel";
import { storedMailBytes } from "@oma/domain/mail-values";
import { principalMailbox, readBody, readSocietyMail, unreadCount } from "./mail.js";
import type { ProjectSessionSettings } from "./project-session-settings.js";

export function societyPanelPorts(configuration: ProjectSessionSettings,
    stateRoot: string, observe: () => PanelState) {
  const mailbox = principalMailbox(stateRoot);
  return composePanel({
    settings: () => ({ config: configuration.settings.config, workerProfile: configuration.settings.workerProfile,
      unread: configuration.unread, extensions: configuration.extensions.rows }),
    unread: () => unreadCount(mailbox),
    mail: () => {
      const { observation } = observe();
      return readSocietyMail(stateRoot, observation.kind === "observed" ? observation.statuses.map(status => status.agent) : undefined);
    },
    body: path => path.length === 0 ? null : readBody(path, storedMailBytes(configuration.settings.config.limits.mailBodyBytes)),
    saveField: (field, value, bootstrap) => configuration.saveField(field, value, bootstrap),
    setExtension: (id, role, enabled) => configuration.setExtension(id, role, enabled),
  }, observe);
}
