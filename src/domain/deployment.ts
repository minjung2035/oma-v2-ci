/** Trusted installation layout, not a host-selected runtime policy or proof.
 * tsc rootDir='.' emits src under dist/src and contracts under dist/implementation.
 * Raw schema/templates remain beside dist at the installation root.
 */
export const DEPLOYMENT_LAYOUT = Object.freeze({
  compiledRoot: "dist/src",
  contract: "dist/implementation/contracts.js",
  schema: "implementation/schema-v1.sql",
  systemd: "implementation/systemd",
  extension: "dist/src/pi-extension.js",
  // TUI-002: `tui` is the host product entrypoint a Human runs. It has no
  // systemd unit, so it is absent from templateEntries by design.
  entries: Object.freeze({ broker: "dist/src/entry/broker.js", runner: "dist/src/entry/runner.js", host: "dist/src/entry/host.js", tui: "dist/src/entry/oma.js" }),
  templateEntries: Object.freeze({ "broker.service.in": "broker", "resident.service.in": "runner",
    "principal-relay.service.in": "host", "reconcile.service.in": "host" } as const),
  // TUI-003: the host product's files, relative to the installation. The
  // installation is mounted into every Resident, so these are hidden there;
  // nothing a model runs may read the product surface's code.
  productSurface: Object.freeze(["dist/src/tui", "dist/src/entry/oma.js", "src/tui", "src/entry/oma.ts"] as const),
  // The engine and its terminal measurement library ship with the product, so
  // they are pinned like any other runtime dependency (TUI-016).
  runtimeDependencies: Object.freeze([
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "koffi",
    "nodemailer",
  ] as const),
});

/** CFG-001: digest syntax is pinned; byte verification belongs to runtime assets. */
export function isDeploymentDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
