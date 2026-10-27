/** Build cache, never an authority: replay every compiler filesystem input and
 * hash every emitted byte before reusing a workspace. A missing/old/drifted
 * record requests an ordinary clean build. */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import ts from "typescript";
import { workspaceAssetSnapshot } from "./workspace-assets.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const methods = ["readFile", "fileExists", "directoryExists", "getDirectories", "readDirectory", "realpath"];
function observation(method, args) {
  const value = ts.sys[method](...args.map(arg => arg === null ? undefined : arg));
  return method === "readFile" ? (value === undefined ? null : hash(value)) : value;
}

/** Capture the resolver's negative lookups too. Checking only previously read
 * files misses a newly added source, type declaration or package.json that
 * changes the compiler's input set without changing any old file. */
function compilerConfiguration(root, directory) {
  const observations = new Map();
  const observed = Object.fromEntries(methods.map(method => [method, (...args) => {
    const value = ts.sys[method](...args);
    const entry = { method, args, value: method === "readFile" ? (value === undefined ? null : hash(value)) : value };
    observations.set(JSON.stringify([method, args]), entry);
    return value;
  }]));
  const parsed = ts.getParsedCommandLineOfConfigFile(join(directory, "tsconfig.json"), {}, {
    ...ts.sys, ...observed, getCurrentDirectory: () => root,
    onUnRecoverableConfigFileDiagnostic: diagnostic => { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")); },
  });
  if (!parsed || parsed.errors.length) throw new Error(`cannot discover compiler inputs for ${directory}`);
  return { parsed, observed, observations };
}

function compilerInputs(root, directory) {
  const { parsed, observed, observations } = compilerConfiguration(root, directory);
  const host = Object.assign(ts.createIncrementalCompilerHost(parsed.options), observed, { getCurrentDirectory: () => root });
  const program = ts.createIncrementalProgram({ rootNames: parsed.fileNames, options: parsed.options,
    projectReferences: parsed.projectReferences, host }).getProgram();
  // The public incremental host computes the compiler's source versions,
  // including its treatment of trailing source-map comments. Match them to
  // what the completed compile actually read, not just what exists afterward.
  const info = JSON.parse(readFileSync(join(directory, ".tsbuildinfo"), "utf8"));
  if (info.version !== ts.version || !Array.isArray(info.fileNames) || !Array.isArray(info.fileInfos) ||
      info.fileNames.length !== info.fileInfos.length) throw new Error(`unsupported compiler input record: ${directory}`);
  // Build-info keys use the compiler host's canonical spelling on a
  // case-insensitive filesystem. SourceFile.fileName retains import spelling.
  // Use that same host identity for both, while keeping full version/format
  // equality and every positive/negative resolver observation.
  const canonical = name => host.getCanonicalFileName(resolve(name));
  const versions = new Map(info.fileNames.map((name, index) => [canonical(resolve(directory, name)), info.fileInfos[index]]));
  const sources = program.getSourceFiles();
  const changed = sources.flatMap(source => {
    const entry = versions.get(canonical(resolve(root, source.fileName)));
    const expectedVersion = typeof entry === "string" ? entry : entry?.version;
    const expectedFormat = typeof entry === "string" ? undefined : entry?.impliedFormat;
    return source.version !== expectedVersion || source.impliedNodeFormat !== expectedFormat
      ? [{ file: source.fileName, version: source.version, expectedVersion,
        format: source.impliedNodeFormat, expectedFormat }] : [];
  });
  if (sources.length !== versions.size || changed.length) throw new Error(
    `compiler inputs changed during workspace build: ${directory}\n${JSON.stringify({ sources: sources.length, recorded: versions.size, changed: changed.slice(0, 20) })}`);
  return [...observations.values()];
}

/** Include directories, modes and the incremental compiler state. Links and
 * special files are never a valid compiler output; removal never follows them. */
export function workspaceOutputs(directory) {
  const entries = {};
  const walk = (path, relative) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`linked workspace output: ${path}`);
    const mode = stat.mode & 0o7777;
    if (stat.isDirectory()) {
      entries[relative] = { mode };
      for (const name of readdirSync(path).sort()) walk(join(path, name), `${relative}/${name}`);
    } else if (stat.isFile()) entries[relative] = { mode, bytes: stat.size, sha256: hash(readFileSync(path)) };
    else throw new Error(`nonregular workspace output: ${path}`);
  };
  walk(join(directory, "dist"), "dist");
  walk(join(directory, ".tsbuildinfo"), ".tsbuildinfo");
  return entries;
}

export function workspaceBuildCache(root, workspaces) {
  // Compiler implementation and build policy are inputs, not just version
  // strings. Manifests/lockfile cover package resolution and generated assets.
  const files = ["package.json", "package-lock.json", "scripts/build-workspaces.mjs",
    "scripts/workspace-build-cache.mjs", "scripts/workspace-assets.mjs", "scripts/workspace-executables.mjs", "scripts/check-modules.mjs",
    "node_modules/typescript/package.json", "node_modules/typescript/bin/tsc",
    "node_modules/typescript/lib/tsc.js", "node_modules/typescript/lib/_tsc.js", "node_modules/typescript/lib/typescript.js",
    ...workspaces.map(workspace => join(workspace.path, "package.json"))];
  const policyOf = () => hash(JSON.stringify([process.version, process.platform,
    files.map(file => [file, hash(readFileSync(join(root, file)))])]));
  const policy = policyOf();
  // Common type libraries occur in many packages. Re-hash once per build,
  // while still replaying resolver observations independently of timestamps.
  const replayed = new Map();
  const replay = entry => {
    if (!methods.includes(entry.method) || !Array.isArray(entry.args)) throw new Error("invalid compiler input record");
    const key = JSON.stringify([entry.method, entry.args]);
    if (!replayed.has(key)) replayed.set(key, observation(entry.method, entry.args));
    return replayed.get(key);
  };
  const assets = workspace => {
    const directory = join(root, workspace.path);
    const entries = workspaceAssetSnapshot(directory, "src", workspace.manifest.oma?.assets ?? []);
    return Object.fromEntries(Object.entries(entries).map(([name, content]) => {
      if (content === "directory") return [name, { type: "directory" }];
      const stat = lstatSync(join(directory, "src", name));
      if (!stat.isFile()) throw new Error(`nonregular build asset: ${name}`);
      // copyFileSync copies file permissions as well as bytes. A chmod-only
      // edit must not leave a previously executable (or non-executable) asset.
      return [name, { sha256: content, mode: stat.mode & 0o7777 }];
    }));
  };
  return {
    before(workspace) {
      const snapshot = assets(workspace), directory = join(root, workspace.path);
      const { parsed, observations } = compilerConfiguration(root, directory);
      const emitted = parsed.fileNames.flatMap(file => ts.getOutputFileNames(parsed, file, !ts.sys.useCaseSensitiveFileNames));
      for (const asset of workspace.manifest.oma?.assets ?? []) {
        const target = resolve(directory, "dist", asset);
        if (emitted.some(file => file === target || file.startsWith(target + sep) || target.startsWith(file + sep)))
          throw new Error(`asset overlaps compiler output: ${workspace.manifest.name}/${asset}`);
      }
      return { configuration: [...observations.values()], assets: snapshot };
    },
    fresh(workspace, prior, dependencies) {
      try {
        return prior?.policy === policy && equal(prior.dependencies, dependencies) &&
          Array.isArray(prior.inputs) && prior.inputs.length > 0 &&
          prior.inputs.every(entry => equal(entry.value, replay(entry))) &&
          equal(prior.assets, assets(workspace)) && equal(prior.outputs, workspaceOutputs(join(root, workspace.path)));
      } catch { return false; }
    },
    record(workspace, dependencies, before) {
      if (!before.configuration.every(entry => equal(entry.value, observation(entry.method, entry.args))) ||
          !equal(before.assets, assets(workspace))) throw new Error(`configuration/asset inputs changed during workspace build: ${workspace.manifest.name}`);
      return { policy, dependencies, inputs: compilerInputs(root, join(root, workspace.path)),
        assets: assets(workspace), outputs: workspaceOutputs(join(root, workspace.path)) };
    },
    assertPolicyUnchanged() {
      if (policyOf() !== policy) throw new Error("policy inputs changed during workspace build");
    },
    outputDigest(record) { return hash(JSON.stringify(record.outputs ?? null)); },
  };
}
