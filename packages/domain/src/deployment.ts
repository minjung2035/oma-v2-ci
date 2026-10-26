/** Trusted installation layout, not a host-selected runtime policy or proof.
 * The app owns executable entries; each workspace owns its dist and exports.
 * Raw schema/templates remain at their manifest-owned installation paths.
 */
export const DEPLOYMENT_LAYOUT = Object.freeze({
  /** Each workspace's compiled payload and export map are deployment inputs.
   * Development symlinks must resolve to these exact installation-local roots. */
  workspaces: Object.freeze([
    { name: "@oma/contracts", root: "packages/contracts" },
    { name: "@oma/domain", root: "packages/domain" },
    { name: "@oma/protocol", root: "packages/protocol" },
    { name: "@oma/client", root: "packages/client" },
    { name: "@oma/tui", root: "packages/tui" },
    { name: "@oma/native", root: "packages/native" },
    { name: "@oma/process", root: "packages/process" },
    { name: "@oma/storage", root: "packages/storage" },
    { name: "@oma/config", root: "packages/config" },
    { name: "@oma/tool-files", root: "packages/tool-files" },
    { name: "@oma/tool-runtime", root: "packages/tool-runtime" },
    { name: "@oma/tool-lsp", root: "packages/tool-lsp" },
    { name: "@oma/tool-mcp", root: "packages/tool-mcp" },
    { name: "@oma/tool-web", root: "packages/tool-web" },
    { name: "@oma/tool-hashline", root: "packages/tool-hashline" },
    { name: "@oma/extension", root: "packages/extension" },
    { name: "@oma/mail", root: "packages/mail" },
    { name: "@oma/git", root: "packages/git" },
    { name: "@oma/review", root: "packages/review" },
    { name: "@oma/lifecycle", root: "packages/lifecycle" },
    { name: "@oma/reconcile", root: "packages/reconcile" },
    { name: "@oma/broker", root: "packages/broker" },
    { name: "@oma/engine", root: "packages/engine" },
    { name: "@oma/platform-linux", root: "packages/platform-linux" },
    { name: "@oma/platform-mac", root: "packages/platform-mac" },
    { name: "@oma/app", root: "apps/oma" },
  ] as const),
  compiledRoot: "apps/oma/dist",
  /** App-owned in-process client composition, loaded before the engine. */
  interactiveToolsPreload: "packages/engine/dist/pi-compat/interactive-tool-setup.js",
  settingsPreload: "apps/oma/dist/entry/pi-settings-preload.js",
  clientPreload: "apps/oma/dist/runtime/client-preload.js",
  contract: "packages/contracts/dist/index.js",
  schema: "packages/storage/dist/schema-v4.sql",
  extension: "packages/extension/dist/index.js",
  // BL2: the Personal host's `-e` path — the ask_user_question entry point is
  // its own extension file so Personal gets the tool without loading the
  // society-wide trusted extension it has no use for.
  extensionAsk: "packages/extension/dist/ask-user-question.js",
  // The model-facing command surface, as an installed path. Every agent that
  // has OMA tools runs this same file; naming it once keeps the Principal's
  // and a Resident's engine pointed at one binary.
  cli: "apps/oma/dist/cli.js",
  // AV16, CLI-001: the `oma` command a Resident runs in its sandbox. The build
  // writes it from the sandbox's paths (src/sandbox.ts) and the manifest pins it.
  modelCommand: "apps/oma/dist/libexec/oma",
  modelCommandBuilder: "packages/domain/dist/resident-paths.js",
  // TUI-002: `tui` is the native host entrypoint a Human runs.
  entries: Object.freeze({ candidateCheck: "apps/oma/dist/entry/candidate-check.js", quarantine: "apps/oma/dist/entry/quarantine.js", broker: "apps/oma/dist/entry/broker.js", preparation: "apps/oma/dist/entry/prepare-society.js", runner: "apps/oma/dist/entry/runner.js", tui: "apps/oma/dist/entry/oma.js", interactive: "apps/oma/dist/entry/pi-interactive.js",
    society: "apps/oma/dist/entry/oma-society.js", personalHost: "apps/oma/dist/entry/personal-host.js", personal: "apps/oma/dist/entry/pi-personal.js",
  }),
  // TUI-003: the host product's files, relative to the installation. The
  // installation is mounted into every Resident, so these are hidden there;
  // nothing a model runs may read the product surface's code.
  productSurface: Object.freeze(["packages/engine/src/open-tui-brand.ts", "packages/engine/dist/open-tui-brand.js", "packages/tui/dist", "packages/tui/src", "apps/oma/dist/application", "apps/oma/src/application",
    "apps/oma/dist/engine", "apps/oma/src/engine",
    "packages/engine/dist/login.js", "packages/engine/src/login.ts",
    "packages/engine/dist/principal-events.js", "packages/engine/src/principal-events.ts",
    "packages/engine/dist/principal-launch.js", "packages/engine/src/principal-launch.ts",
    "packages/engine/dist/principal-session.js", "packages/engine/src/principal-session.ts",
    "packages/engine/dist/session-directories.js", "packages/engine/src/session-directories.ts",
    "packages/domain/dist/settings-policy.js", "packages/domain/src/settings-policy.ts",
    "packages/domain/dist/surface-bounds.js", "packages/domain/src/surface-bounds.ts",
    "apps/oma/dist/entry/oma.js", "apps/oma/src/entry/oma.ts", "apps/oma/dist/entry/prepare-society.js", "apps/oma/src/entry/prepare-society.ts", "apps/oma/dist/runtime/society-preparation.js", "apps/oma/src/runtime/society-preparation.ts", "apps/oma/dist/entry/pi-interactive.js", "apps/oma/src/entry/pi-interactive.ts",
    "packages/engine/dist/pi-compat/prompt-editor.js", "packages/engine/src/pi-compat/prompt-editor.ts",
    "packages/engine/dist/pi-compat/interactive-tool-setup.js", "packages/engine/src/pi-compat/interactive-tool-setup.ts",
    "packages/engine/dist/pi-compat/interactive-tools.js", "packages/engine/src/pi-compat/interactive-tools.ts", "packages/engine/src/pi-compat/pi-private.d.ts",
    "packages/engine/dist/pi-presentation.js", "packages/engine/src/pi-presentation.ts",
    "apps/oma/dist/entry/oma-society.js", "apps/oma/src/entry/oma-society.ts", "apps/oma/dist/entry/personal-host.js", "apps/oma/src/entry/personal-host.ts",
    "apps/oma/dist/entry/pi-personal.js", "apps/oma/src/entry/pi-personal.ts", "packages/engine/dist/personal.js", "packages/engine/src/personal.ts", "packages/engine/dist/interactive.js", "packages/engine/src/interactive.ts"] as const),
  // The engine and its terminal measurement library ship with the product, so
  // they are pinned like any other runtime dependency (TUI-016).
  runtimeDependencies: Object.freeze([
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "pi-open-tui",
    "koffi",
    "nodemailer",
  ] as const),
});

/** CFG-001: digest syntax is pinned; byte verification belongs to runtime assets. */
export function isDeploymentDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/** Host-only session storage tool. Both installer and execution owner verify
 * these exact upstream bytes; a mutable local manifest is never a tool pin. */
export const RESTIC_RELEASE = Object.freeze({
  version: "0.19.1",
  linux: Object.freeze({
    x64: Object.freeze({ archive: "restic_0.19.1_linux_amd64.bz2",
      archiveSha256: "f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c",
      binarySha256: "20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639" }),
    arm64: Object.freeze({ archive: "restic_0.19.1_linux_arm64.bz2",
      archiveSha256: "a5f64aaab53d51e311fa3829124c5b703f2d14cf187d8640b6be3b2b49376465",
      binarySha256: "2fb45ac6f9071b6f20eb883953a188f9e7c7cb6bbe43c67a2e47ada4e85ee7f0" }),
  }),
  darwin: Object.freeze({
    x64: Object.freeze({ archive: "restic_0.19.1_darwin_amd64.bz2",
      archiveSha256: "c38d579622cf602f665234c5a8c315030b6cf70656028fe6dc29a786b60e5f35",
      binarySha256: "b2b553b402b9971b0c3f673d880397a421526f55a08f21fe5b82b5dd9e049a08" }),
    arm64: Object.freeze({ archive: "restic_0.19.1_darwin_arm64.bz2",
      archiveSha256: "7be0a144ccc377880f294204aa271d76e4b79554b42a751151d425ce6ebac143",
      binarySha256: "06582569ff2f10e1935a6f12187c76db02f0bae99e6e54098f2cdc374766d768" }),
  }),
});
export function resticReleaseFor(platform: string, arch: string) {
  if ((platform !== "linux" && platform !== "darwin") || (arch !== "x64" && arch !== "arm64")) return null;
  return RESTIC_RELEASE[platform][arch];
}
