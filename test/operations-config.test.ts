import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadConfig, loadConfiguration } from "../src/config.js";
import { canonicalResourceLimits } from "../src/domain/resources.js";
import { writePackageIndex } from "../src/runtime/pi-packages.js";
import { createCompleteConfigurationFixture as fixture } from "./fixtures/configuration.js";

test("OPS config: migration preserves the closed host contract and does not overwrite input/output", () => {
  const f = fixture();
  try {
    const before = readFileSync(f.input);
    const config = loadConfiguration(f.path);
    assert.deepEqual(config.config, loadConfig(f.input));
    assert.deepEqual(Object.keys(config.roles), [
      "principal",
      "resident",
      "verifier",
    ]);
    assert.equal(config.roles.verifier!.prompt, "");
    assert.equal(config.roles.verifier!.extensions.length, 1);
    assert.match(
      config.roles.verifier!.extensions[0]!.sha256,
      /^[a-f0-9]{64}$/,
    );
    assert.equal(f.migrate().status, 2);
    assert.deepEqual(readFileSync(f.input), before);
    const alias = join(f.root, "selected-config.json");
    symlinkSync(f.path, alias);
    assert.deepEqual(loadConfig(alias), config.config);
    assert.deepEqual(loadConfig(f.path), config.config);
  } finally {
    f.close();
  }
});

test("OPS config: role models/prompts/extensions change only in a newly loaded snapshot", () => {
  const f = fixture();
  try {
    const old = loadConfiguration(f.path);
    writeFileSync(
      join(f.output, "prompts/verifier.md"),
      "Verify independently.\n",
    );
    writeFileSync(
      join(f.installation, "verifier.js"),
      "throw new Error('configuration must not execute extensions');\n",
    );
    f.edit("roles/verifier.json", (role) =>
      role.extensions.push("verifier.js"),
    );
    f.edit("models.json", (models) => {
      models.review.model = "model-c";
    });
    const fresh = loadConfiguration(f.path);
    assert.equal(old.config.modelProfiles.review!.model, "model-b");
    assert.equal(old.roles.verifier!.prompt, "");
    assert.equal(old.roles.verifier!.extensions.length, 1);
    assert.equal(fresh.config.modelProfiles.review!.model, "model-c");
    assert.equal(fresh.roles.verifier!.prompt, "Verify independently.\n");
    assert.equal(fresh.roles.verifier!.extensions.length, 2);
    assert.ok(Object.isFrozen(fresh.roles));
    assert.ok(Object.isFrozen(fresh.roles.verifier));
    assert.ok(Object.isFrozen(fresh.roles.verifier!.extensions));
    assert.equal(fresh.config.agentProfiles.resident!.modelProfile, "standard");
  } finally {
    f.close();
  }
});

for (const [name, file, update] of [
  [
    "unknown manifest field",
    "config.json",
    (v: any) => {
      v.extra = true;
    },
  ],
  [
    "duplicate ownership",
    "host.json",
    (v: any) => {
      v.modelProfiles = {};
    },
  ],
  [
    "missing model",
    "roles/verifier.json",
    (v: any) => {
      v.agentProfile.modelProfile = "missing";
    },
  ],
  [
    "missing required model setting",
    "models.json",
    (v: any) => {
      delete v.review.provider;
    },
  ],
  [
    "extra role field",
    "roles/verifier.json",
    (v: any) => {
      v.permissions = ["all"];
    },
  ],
  [
    "removed core extension",
    "roles/verifier.json",
    (v: any) => {
      v.extensions = [];
    },
  ],
  [
    "path traversal",
    "roles/verifier.json",
    (v: any) => {
      v.promptFile = "../legacy.json";
    },
  ],
  [
    "remote extension",
    "roles/verifier.json",
    (v: any) => {
      v.extensions.push("https://example.invalid/plugin.js");
    },
  ],
] as const) {
  test(`OPS config: rejects ${name} without fallback defaults`, () => {
    const f = fixture();
    try {
      f.edit(file, update);
      assert.throws(() => loadConfiguration(f.path), {
        code: "INVALID_REQUEST",
      });
    } finally {
      f.close();
    }
  });
}
/** Starts the real runner entry as its unit would, stopping before Pi runs,
 * and reports what it selected. */
function runnerEntry(f: ReturnType<typeof fixture>, env: Record<string, string>) {
  // WP31: a runner uses the engine its installation ships, and no other; the
  // fixture installation gets this repository's, as a real one has its own.
  const engine = join(f.installation, "node_modules", "@earendil-works", "pi-coding-agent");
  if (!existsSync(engine)) {
    mkdirSync(dirname(engine), { recursive: true });
    symlinkSync(fileURLToPath(new URL("../../node_modules/@earendil-works/pi-coding-agent", import.meta.url)), engine);
  }
  const capture = join(f.root, "selected.json");
  const preload = join(f.root, "capture.mjs");
  rmSync(capture, { force: true });
  writeFileSync(
    preload,
    `import { writeFileSync } from 'node:fs';
    import { RunnerModule } from ${JSON.stringify(new URL("../src/runner.js", import.meta.url).href)};
    import { packageResourcePaths } from ${JSON.stringify(new URL("../src/runtime/pi-packages.js", import.meta.url).href)};
    RunnerModule.prototype.run = async function () {
      writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ profile: this.profile, confinement: this.paths.confinement ?? null,
        packages: this.paths.packages ?? null, packageResources: packageResourcePaths(this.paths.packages) ?? null })); return 0; };`,
  );
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      preload,
      resolve("dist/src/entry/runner.js"),
      "--society",
      "demo",
      "--agent",
      "worker",
      "--config",
      f.path,
      // D03: a unit-started runner is handed the broker's roots explicitly.
      "--state-root",
      join(f.root, "data", "oma", "demo"),
      "--run-root",
      join(f.root, "run", "oma", "demo"),
    ],
    { env: { ...process.env, ...env }, encoding: "utf8", timeout: 10000 },
  );
  const selected = run.status === 0 ? JSON.parse(readFileSync(capture, "utf8")) : null;
  return { status: run.status, stderr: run.stderr, selected };
}
const hex = (text: string): string => Buffer.from(text, "utf8").toString("hex");

test("U1: rootfs '/' fails startup before RunnerModule can run", () => {
  const f = fixture();
  try {
    const resources = loadConfiguration(f.path).config.agentProfiles.verifier!.resources;
    f.edit("host.json", host => { host.installation.rootfs = "/"; });
    const result = runnerEntry(f, { OMA_PROFILE_HEX: hex("verifier"), OMA_RESOURCES_HEX: hex(canonicalResourceLimits(resources)) });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /UNSUPPORTED_PROFILE/);
    assert.doesNotMatch(result.stderr, /runs unconfined/);
    assert.equal(existsSync(join(f.root, "selected.json")), false);
  } finally { f.close(); }
});

test("OPS config: runner entry selects the broker-rendered role at startup without executing Pi", () => {
  const f = fixture();
  try {
    const accepted = loadConfiguration(f.path).config.agentProfiles.verifier!.resources;
    const run = runnerEntry(f, { OMA_PROFILE_HEX: hex("verifier"), OMA_RESOURCES_HEX: hex(canonicalResourceLimits(accepted)) });
    assert.equal(run.status, 0, run.stderr);
    const selected = run.selected.profile;
    assert.equal(selected.name, "verifier");
    assert.equal(selected.model.model, "model-b");
    assert.equal(
      selected.settings.extensions[0].path,
      join(f.installation, "dist/src/pi-extension.js"),
    );
  } finally {
    f.close();
  }
});

/** A package store laid out as the engine's package manager installs into it. */
function store(root: string, packages: Record<string, Record<string, string>>): string {
  const dir = join(root, "packages");
  for (const [name, files] of Object.entries(packages)) for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, "npm", "node_modules", name, file, ".."), { recursive: true });
    writeFileSync(join(dir, "npm", "node_modules", name, file), text);
  }
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages: Object.keys(packages).map(name => `npm:${name}`) }));
  return dir;
}
const richPackage = {
  "package.json": JSON.stringify({ name: "oma-rich", version: "1.0.0",
    pi: { skills: ["./skills/roll/SKILL.md"], prompts: ["./prompts/review.md"], themes: ["./themes/dark.json"] } }),
  "skills/roll/SKILL.md": "---\nname: roll\ndescription: Roll.\n---\n",
  "prompts/review.md": "Review the change.\n",
  "themes/dark.json": JSON.stringify({ name: "dark", colors: {} }),
};

test("DR25/C18: the runner entry hands the package store to the spawn plan, so package resources reach a Resident's argv", async () => {
  const f = fixture();
  try {
    const packages = store(f.root, { "oma-rich": richPackage });
    await writePackageIndex(packages);
    f.edit("host.json", host => { host.installation.packages = packages; });
    const accepted = loadConfiguration(f.path).config.agentProfiles.verifier!.resources;
    const run = runnerEntry(f, { OMA_PROFILE_HEX: hex("verifier"), OMA_RESOURCES_HEX: hex(canonicalResourceLimits(accepted)) });
    assert.equal(run.status, 0, run.stderr);
    // The store's real root reaches RunnerPaths.packages -- without it
    // packageResourcePaths sees undefined and no --skill/--prompt-template/
    // --theme flag is ever emitted for a Resident.
    assert.equal(run.selected.packages, realpathSync(packages));
    const root = realpathSync(packages);
    assert.deepEqual(run.selected.packageResources, {
      skills: [join(root, "npm/node_modules/oma-rich/skills/roll/SKILL.md")],
      prompts: [join(root, "npm/node_modules/oma-rich/prompts/review.md")],
      themes: [join(root, "npm/node_modules/oma-rich/themes/dark.json")],
    });
    // And the confinement mounts the same root read-only inside.
    assert.equal(run.selected.confinement.packages, root);
  } finally { f.close(); }
});

test("OMA_PI_COMMAND: an override supplies no shipped engine entry, so the runner refuses at startup -- not at first delivery", () => {
  const f = fixture();
  try {
    const accepted = loadConfiguration(f.path).config.agentProfiles.verifier!.resources;
    const run = runnerEntry(f, { OMA_PROFILE_HEX: hex("verifier"), OMA_RESOURCES_HEX: hex(canonicalResourceLimits(accepted)),
      // A pinned executable resolves to args:[]; a confined Resident would
      // then throw UNSUPPORTED_PROFILE on every delivery. The unit must fail
      // immediately instead.
      OMA_PI_COMMAND: process.execPath });
    assert.notEqual(run.status, 0, "the unit started on an engine entry a Resident cannot run");
    assert.match(run.stderr, /no shipped engine entry|requires the bundled engine/);
    assert.equal(existsSync(join(f.root, "selected.json")), false, "the runner ran before the refusal");
  } finally { f.close(); }
});

test("WP25.03 / D05: a Resident runs with its accepted resources; the current profile only names its model", () => {
  const f = fixture();
  try {
    const current = loadConfiguration(f.path).config.agentProfiles.verifier!.resources;
    // Accepted before the profile was edited: other limits than the current ones.
    const accepted = { ...current, workspaceBytes: current.workspaceBytes + 4096, tmpBytes: current.tmpBytes + 8192,
      checkTimeoutSeconds: current.checkTimeoutSeconds + 1 };
    const run = runnerEntry(f, { OMA_PROFILE_HEX: hex("verifier"), OMA_RESOURCES_HEX: hex(canonicalResourceLimits(accepted)) });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.selected.profile.workspaceBytes, accepted.workspaceBytes, "the engine's workspace limit came from the current profile");
    assert.equal(run.selected.confinement.tmpBytes, accepted.tmpBytes, "the sandbox /tmp came from the current profile");
    assert.equal(Object.hasOwn(run.selected.confinement, "checkResources"), false,
      "candidate check resources belong to the integration profile, not the Resident sandbox");
    assert.equal(run.selected.profile.model.model, "model-b", "the model is the current profile's");
    // No accepted spec, or anything but its canonical text, is refused -- never
    // replaced by the current profile.
    const { ["workspaceBytes"]: _dropped, ...partial } = accepted;
    for (const resources of [undefined, "", "zz", hex("{}"), hex(JSON.stringify(partial)),
      hex(JSON.stringify({ ...accepted, workspaceBytes: 0 })), hex(JSON.stringify({ ...accepted, extra: 1 })),
      hex(JSON.stringify(Object.fromEntries(Object.entries(accepted).reverse())))]) {
      const refused = runnerEntry(f, { OMA_PROFILE_HEX: hex("verifier"), ...(resources === undefined ? {} : { OMA_RESOURCES_HEX: resources }) });
      assert.equal(refused.status, 4, `resources ${resources} were accepted`);
      assert.match(refused.stderr, /broker-rendered resources/);
    }
  } finally {
    f.close();
  }
});

test("OPS config: rejects symlinked and oversized prompt assets", () => {
  const f = fixture();
  try {
    const prompt = join(f.output, "prompts/verifier.md");
    rmSync(prompt);
    symlinkSync(f.input, prompt);
    assert.throws(() => loadConfiguration(f.path), { code: "INVALID_REQUEST" });
    rmSync(prompt);
    writeFileSync(prompt, "x".repeat(1024 * 1024 + 1));
    assert.throws(() => loadConfiguration(f.path), { code: "INVALID_REQUEST" });
  } finally {
    f.close();
  }
});

for (const format of ["inline", "operations"] as const) {
  for (const defect of [
    { name: "quota", file: "host.json", inline: ["quota"], split: ["quota"], field: "storageBytes", error: /quota\.storageBytes is required/ },
    { name: "resources", file: "roles/resident.json", inline: ["agentProfiles", "resident", "resources"], split: ["agentProfile", "resources"], field: "memoryBytes", error: /resources\.memoryBytes is required/ },
    { name: "model relation", file: "roles/resident.json", inline: ["agentProfiles", "resident"], split: ["agentProfile"], field: "modelProfile", error: /modelProfile unknown/ },
  ]) {
    test(`V02A: ${format} fixture rejects deliberately missing ${defect.name}`, () => {
      const f = fixture();
      try {
        const source = format === "inline" ? f.input : f.path;
        const file = format === "inline" ? f.input : join(f.output, defect.file);
        assert.doesNotThrow(() => loadConfiguration(source), "positive control must load first");
        const raw = JSON.parse(readFileSync(file, "utf8"));
        let target = raw;
        for (const field of format === "inline" ? defect.inline : defect.split) target = target[field];
        if (defect.field === "modelProfile") target[defect.field] = "not-configured";
        else delete target[defect.field];
        // Explicit corruption: do not return this as a normal fixture.
        writeFileSync(file, JSON.stringify(raw));
        assert.throws(() => loadConfiguration(source), error =>
          error instanceof Error && "code" in error && error.code === "INVALID_REQUEST" && defect.error.test(error.message));
      } finally { f.close(); }
    });
  }
}
