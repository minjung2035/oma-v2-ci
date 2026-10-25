/** Explicit host-side migration; never edits the input or an existing output. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfiguration } from "@oma/config";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { ACTOR_NAME_RE } from "@oma/domain/identifiers";

const [input, destination, ...extra] = process.argv.slice(2);
if (!input || !destination || extra.length) {
  console.error(
    "usage: split-operations-config.mjs <existing-config.json> <new-directory>",
  );
  process.exitCode = 2;
} else {
  let owned = false;
  const output = resolve(destination);
  try {
    const loaded = loadConfiguration(resolve(input));
    if (Object.keys(loaded.roles).length)
      throw new Error("input is already a split operations configuration");
    const { modelProfiles, agentProfiles, ...host } = loaded.config;
    const names = Object.keys(agentProfiles);
    if (
      !names.length ||
      names.length > 64 ||
      names.some((name) => !ACTOR_NAME_RE.test(name))
    )
      throw new Error(
        "split configuration requires 1..64 normalized role profile names",
      );
    mkdirSync(output, { mode: 0o700 });
    owned = true;
    mkdirSync(join(output, "roles"), { mode: 0o700 });
    mkdirSync(join(output, "prompts"), { mode: 0o700 });
    const json = (name, value) =>
      writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
    json("host.json", host);
    json("models.json", modelProfiles);
    const roles = Object.create(null);
    for (const name of names) {
      const promptFile = `prompts/${name}.md`;
      roles[name] = `roles/${name}.json`;
      writeFileSync(join(output, promptFile), "", { flag: "wx", mode: 0o600 });
      json(roles[name], {
        agentProfile: agentProfiles[name],
        extensions: [DEPLOYMENT_LAYOUT.extension],
        promptFile,
      });
    }
    // Publish the index last. Empty prompts preserve the previous configuration.
    json("config.json", {
      kind: "oma-operations-v1",
      host: "host.json",
      models: "models.json",
      roles,
    });
    console.log(join(output, "config.json"));
  } catch (error) {
    if (owned) rmSync(output, { recursive: true, force: true });
    console.error(
      `config split: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
  }
}
