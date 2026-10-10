/** Application binds settings/mail effects to the TUI's data-only panel API. */
import { societyPanelPorts as composePanel, type PanelState } from "../tui/society-panel.js";
import { storedMailBytes } from "../domain/mail-values.js";
import { principalMailbox, readBody, readMailbox, unreadCount } from "./mail.js";
import type { ProjectSessionSettings } from "./project-session-settings.js";

export function societyPanelPorts(configuration: ProjectSessionSettings,
    mailbox: ReturnType<typeof principalMailbox>, observe: () => PanelState) {
  return composePanel({
    settings: () => ({ config: configuration.settings.config, workerProfile: configuration.settings.workerProfile,
      unread: configuration.unread, extensions: configuration.extensions.rows }),
    unread: () => unreadCount(mailbox),
    mail: () => {
      const { observation } = observe();
      return readMailbox(mailbox, observation.kind === "observed" ? observation.statuses.map(status => status.agent) : undefined);
    },
    body: path => path.length === 0 ? null : readBody(path, storedMailBytes(configuration.settings.config.limits.mailBodyBytes)),
    saveField: (field, value, bootstrap) => configuration.saveField(field, value, bootstrap),
    setExtension: (id, role, enabled) => configuration.setExtension(id, role, enabled),
  }, observe);
}
