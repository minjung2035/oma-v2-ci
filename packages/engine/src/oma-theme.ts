/** The engine theme oma installs as its default: the palette of Open TUI's own
 * preview (Catppuccin Mocha: mauve accent and borders, surface-toned user
 * messages). A Pi theme file, written into the society's private engine
 * directory; the Human can pick another in /settings. */
export const OMA_THEME_NAME = "oma";

export const OMA_THEME = Object.freeze({
  name: OMA_THEME_NAME,
  vars: {
    cyan: "#89dceb", blue: "#89b4fa", green: "#a6e3a1", red: "#f38ba8", yellow: "#f9e2af",
    text: "#cdd6f4", gray: "#a6adc8", dimGray: "#7f849c", darkGray: "#585b70",
    accent: "#cba6f7", selectedBg: "#45475a", userMsgBg: "#313244",
    toolPendingBg: "#2a2b3c", toolSuccessBg: "#263a33", toolErrorBg: "#3e2a35", customMsgBg: "#302d41",
  },
  colors: {
    accent: "accent", border: "accent", borderAccent: "accent", borderMuted: "darkGray",
    success: "green", error: "red", warning: "yellow", muted: "gray", dim: "dimGray", text: "text", thinkingText: "gray",
    selectedBg: "selectedBg", scrollbarTrack: "darkGray", scrollbarThumb: "text", searchMatchBg: "selectedBg", searchMatchText: "text",
    userMessageBg: "userMsgBg", userMessageText: "text", customMessageBg: "customMsgBg", customMessageText: "text",
    customMessageLabel: "accent", toolPendingBg: "toolPendingBg", toolSuccessBg: "toolSuccessBg", toolErrorBg: "toolErrorBg",
    toolTitle: "text", toolOutput: "gray",
    mdHeading: "accent", mdLink: "blue", mdLinkUrl: "dimGray", mdCode: "#fab387", mdCodeBlock: "green",
    mdCodeBlockBorder: "darkGray", mdQuote: "gray", mdQuoteBorder: "darkGray", mdHr: "darkGray", mdListBullet: "accent",
    toolDiffAdded: "green", toolDiffRemoved: "red", toolDiffContext: "gray",
    syntaxComment: "#6c7086", syntaxKeyword: "accent", syntaxFunction: "blue", syntaxVariable: "text", syntaxString: "green",
    syntaxNumber: "#fab387", syntaxType: "yellow", syntaxOperator: "cyan", syntaxPunctuation: "#9399b2",
    thinkingOff: "darkGray", thinkingMinimal: "#6c7086", thinkingLow: "#74c7ec", thinkingMedium: "blue",
    thinkingHigh: "accent", thinkingXhigh: "#f5c2e7", thinkingMax: "red",
    bashMode: "green",
  },
  export: { pageBg: "#1e1e2e", cardBg: "#181825", infoBg: "#45475a" },
});
