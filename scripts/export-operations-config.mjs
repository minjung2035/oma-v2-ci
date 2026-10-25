/** D02 explicit export: writes the configuration a manifest currently names as
 * a flat manual operations bundle in a NEW directory. It never edits the input,
 * never flattens it in place and never overwrites an existing output. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfigurationSnapshot } from "@oma/config";

const [input, destination, ...extra] = process.argv.slice(2);
if (!input || !destination || extra.length) {
  console.error("usage: export-operations-config.mjs <config.json> <new-directory>");
  process.exitCode = 2;
} else {
  let owned = false;
  const output = resolve(destination);
  try {
    const snapshot = loadConfigurationSnapshot(resolve(input));
    if (snapshot.layout.kind !== "operations") throw new Error("input is an inline configuration; copy the file instead");
    const { modelProfiles, agentProfiles, ...host } = snapshot.config;
    mkdirSync(output, { mode: 0o700 });
    owned = true;
    mkdirSync(join(output, "roles"), { mode: 0o700 });
    mkdirSync(join(output, "prompts"), { mode: 0o700 });
    const write = (name, bytes) => writeFileSync(join(output, name), bytes, { flag: "wx", mode: 0o600 });
    const json = (name, value) => write(name, `${JSON.stringify(value, null, 2)}\n`);
    json("host.json", host);
    json("models.json", modelProfiles);
    const roles = Object.create(null);
    for (const [name, authored] of Object.entries(snapshot.authoredRoles)) {
      const { promptFile: _promptFile, ...role } = authored.value;
      const promptFile = `prompts/${name}.md`;
      write(promptFile, Buffer.from(snapshot.roles[name].prompt, "utf8"));
      roles[name] = `roles/${name}.json`;
      json(roles[name], { ...role, agentProfile: agentProfiles[name], promptFile });
    }
    // The index last, so a partial export is never a loadable bundle.
    json("config.json", { kind: "oma-operations-v1", host: "host.json", models: "models.json", roles });
    console.log(join(output, "config.json"));
  } catch (error) {
    if (owned) rmSync(output, { recursive: true, force: true });
    console.error(`config export: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
