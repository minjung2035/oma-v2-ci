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
  entries: Object.freeze({ broker: "dist/src/entry/broker.js", runner: "dist/src/entry/runner.js", host: "dist/src/entry/host.js" }),
  templateEntries: Object.freeze({ "broker.service.in": "broker", "resident.service.in": "runner",
    "principal-relay.service.in": "host", "reconcile.service.in": "host" } as const),
  runtimeDependencies: Object.freeze(["koffi", "nodemailer"] as const),
});
