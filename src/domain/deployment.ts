/** Trusted installation layout, not a host-selected runtime policy or proof.
 * tsc rootDir='.' emits src under dist/src and contracts under dist/implementation.
 * Raw schema/templates remain beside dist at the installation root.
 */
export const DEPLOYMENT_LAYOUT = Object.freeze({
  compiledRoot: "dist/src",
  contract: "dist/implementation/contracts.js",
  schema: "implementation/schema-v3.sql",
  systemd: "implementation/systemd",
  extension: "dist/src/pi-extension.js",
  // BL2: the Personal host's `-e` path — the ask_user_question entry point is
  // its own extension file so Personal gets the tool without loading the
  // society-wide trusted extension it has no use for.
  extensionAsk: "dist/src/extension/ask-user-question.js",
  // The model-facing command surface, as an installed path. Every agent that
  // has OMA tools runs this same file; naming it once keeps the Principal's
  // and a Resident's engine pointed at one binary.
  cli: "dist/src/cli.js",
  // AV16, CLI-001: the `oma` command a Resident runs in its sandbox. The build
  // writes it from the sandbox's paths (src/sandbox.ts) and the manifest pins it.
  modelCommand: "dist/libexec/oma",
  // TUI-002: `tui` is the host product entrypoint a Human runs. It has no
  // systemd unit, so it is absent from templateEntries by design.
  entries: Object.freeze({ broker: "dist/src/entry/broker.js", preparation: "dist/src/entry/prepare-society.js", runner: "dist/src/entry/runner.js", host: "dist/src/entry/host.js", tui: "dist/src/entry/oma.js", interactive: "dist/src/entry/pi-interactive.js",
    society: "dist/src/entry/oma-society.js", personalHost: "dist/src/entry/personal-host.js", personal: "dist/src/entry/pi-personal.js",
    mac: "dist/src/entry/oma-mac.js",
    // DR25: the macOS engine's side of `oma pi`, run by its guest host service.
    guestPackages: "dist/src/entry/guest-packages.js" }),
  templateEntries: Object.freeze({ "resident.service.in": "runner",
    "principal-relay.service.in": "host" } as const),
  // TUI-003: the host product's files, relative to the installation. The
  // installation is mounted into every Resident, so these are hidden there;
  // nothing a model runs may read the product surface's code.
  productSurface: Object.freeze(["dist/src/tui", "dist/src/entry/oma.js", "src/tui", "src/entry/oma.ts", "dist/src/entry/prepare-society.js", "src/entry/prepare-society.ts", "dist/src/runtime/society-preparation.js", "src/runtime/society-preparation.ts", "dist/src/entry/pi-interactive.js", "src/entry/pi-interactive.ts",
    "dist/src/runtime/pi-interactive.js", "src/runtime/pi-interactive.ts",
    "dist/src/pi-compat/interactive-tool-setup.js", "src/pi-compat/interactive-tool-setup.ts",
    "dist/src/pi-compat/interactive-tools.js", "src/pi-compat/interactive-tools.ts", "src/pi-compat/pi-private.d.ts",
    "dist/src/runtime/pi-presentation.js", "src/runtime/pi-presentation.ts",
    "dist/src/entry/oma-society.js", "src/entry/oma-society.ts", "dist/src/entry/personal-host.js", "src/entry/personal-host.ts",
    "dist/src/entry/pi-personal.js", "src/entry/pi-personal.ts", "dist/src/entry/pi-interactive-host.js", "src/entry/pi-interactive-host.ts",
    "dist/src/entry/oma-mac.js", "src/entry/oma-mac.ts"] as const),
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
