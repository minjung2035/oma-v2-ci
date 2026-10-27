#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
import { workspaceAssetSnapshot } from "./workspace-assets.mjs";

export async function checkPackage(rootInput) {
  const root = realpathSync(rootInput);
  const { DEPLOYMENT_LAYOUT: layout } = await import(pathToFileURL(join(root, "packages/domain/dist/deployment.js")).href);
  const { assertRuntimeAssets, runtimeAssets } = await import(pathToFileURL(join(root, "apps/oma/dist/runtime/assets.js")).href);
  const paths = runtimeAssets(root);
  assertRuntimeAssets(paths, { schema: join(root, layout.schema) });
  function requiredFile(path) {
    if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) throw new Error(`missing/nonregular package file: ${relative(root, path)}`);
    const rel = relative(root, realpathSync(path));
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("package file escapes installation root");
  }
  // AV16: the sandbox's `oma` is installed, executable, and exactly its owner's script.
  {
    const command = join(root, layout.modelCommand);
    requiredFile(command);
    if ((lstatSync(command).mode & 0o111) === 0) throw new Error(`model command is not executable: ${layout.modelCommand}`);
    const { modelCommandScript } = await import(pathToFileURL(join(root, layout.modelCommandBuilder)).href);
    if (readFileSync(command, "utf8") !== modelCommandScript()) throw new Error(`model command differs from its owner: ${layout.modelCommand}`);
  }
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  // DR18 (C2): the install command is the package's `oma` bin, and it is the
  // product's TUI entry -- the one the deployment layout names -- run by node.
  if (packageJson.bin?.oma !== layout.entries.tui) throw new Error(`package bin "oma" is not the TUI entry ${layout.entries.tui}`);
  requiredFile(join(root, layout.entries.tui));
  if (!readFileSync(join(root, layout.entries.tui), "utf8").startsWith("#!/usr/bin/env node\n"))
    throw new Error("the oma entry cannot be run as a command: it has no node shebang");
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const dependencyOwners = [{ name: packageJson.name, directory: root, manifest: packageJson, lockPath: "" },
    ...layout.workspaces.map(workspace => {
      const directory = join(root, workspace.root), path = join(directory, "package.json");
      requiredFile(path);
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      if (manifest.name !== workspace.name) throw new Error(`workspace dependency owner identity mismatch: ${workspace.root}`);
      return { name: workspace.name, directory, manifest, lockPath: workspace.root };
    })];
  const versions = {};
  for (const name of layout.runtimeDependencies) {
    const owners = dependencyOwners.filter(owner => Object.hasOwn(owner.manifest.dependencies ?? {}, name));
    if (owners.length === 0) throw new Error(`undeclared runtime dependency: ${name}`);
    let canonicalVersion;
    const verifiedOwners = [];
    for (const owner of owners) {
      const declaredRange = owner.manifest.dependencies[name];
      if (lock.packages?.[owner.lockPath]?.dependencies?.[name] !== declaredRange)
        throw new Error(`runtime dependency declaration/lock mismatch: ${owner.name}/${name}`);
      // Resolve at the actual declaring package. A hoisted or nested copy is
      // allowed only inside this installation and at its own locked version.
      // Reading its manifest also supports exports maps without a CJS entry.
      let found = null, installedAt = null, expected;
      for (let directory = owner.directory; ; directory = dirname(directory)) {
        const manifest = join(directory, "node_modules", name, "package.json");
        if (lstatSync(manifest, { throwIfNoEntry: false })?.isFile()) {
          const packageDirectory = realpathSync(dirname(manifest));
          const offset = relative(root, packageDirectory);
          if (offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset))
            throw new Error(`dependency resolved outside installation: ${owner.name}/${name}`);
          const value = JSON.parse(readFileSync(manifest, "utf8"));
          if (value.name !== name) throw new Error(`installed dependency identity mismatch: ${owner.name}/${name}`);
          installedAt = offset.split(sep).join("/");
          expected = lock.packages?.[installedAt]?.version;
          found = value; break;
        }
        if (directory === root) break;
        const parent = dirname(directory);
        if (parent === directory || relative(root, parent).startsWith(`..${sep}`)) break;
      }
      if (!found || typeof expected !== "string" || found.version !== expected)
        throw new Error(`installed/lock version mismatch: ${owner.name}/${name}`);
      if (canonicalVersion !== undefined && canonicalVersion !== found.version)
        throw new Error(`runtime dependency owners use different versions: ${name}`);
      canonicalVersion = found.version;
      verifiedOwners.push({ name: owner.name, declaredRange, installedAt });
      // Loading the native boundary catches missing Koffi binaries, without
      // claiming kernel/cgroup/namespace or deploymentDigest qualification.
      if (Array.isArray(found.pi?.extensions)) {
        for (const entry of found.pi.extensions) requiredFile(resolve(root, installedAt, entry));
        requiredFile(join(root, installedAt, "LICENSE"));
      } else try { createRequire(join(owner.directory, "package.json"))(name); }
      catch (error) {
        if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED" && error?.code !== "ERR_REQUIRE_ESM") throw error;
      }
    }
    versions[name] = { installed: canonicalVersion, locked: canonicalVersion,
      declaredRange: verifiedOwners[0].declaredRange, owners: verifiedOwners };
  }
  const moduleDirectories = [];
  function compiledFiles(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("compiled runtime must not contain source symlinks");
    if (stat.isDirectory()) {
      if (path.endsWith(`${sep}node_modules`)) moduleDirectories.push(path);
      return readdirSync(path).sort().flatMap(name => compiledFiles(join(path, name)));
    }
    return path.endsWith(".js") ? [path] : [];
  }
  for (const workspace of layout.workspaces) {
    requiredFile(join(root, workspace.root, "package.json"));
    const manifest = JSON.parse(readFileSync(join(root, workspace.root, "package.json"), "utf8"));
    workspaceAssetSnapshot(join(root, workspace.root), "dist", manifest.oma?.assets ?? []);
  }
  const files = [...new Set([...compiledFiles(join(root, layout.compiledRoot)),
    ...layout.workspaces.flatMap(workspace => compiledFiles(join(root, workspace.root, "dist")))])];
  assertRuntimeAssets(paths, { schema: join(root, layout.schema) }, moduleDirectories);
  // Vendored bundled-extension payloads live under
  // packages/tool-NAME/dist/vendor/<bundle>/ and carry their own pinned
  // dependency closure in <bundle>/node_modules/ plus the bundle manifest's
  // generated.dependencies table -- integrity-bound bytes, verified
  // fail-closed by verifyVendorBundle at load. Only a bundle's runtime/
  // tree is code OMA evaluates: a bare specifier there is declared when it
  // is a node: builtin, a root package dependency (the host Pi API), or a
  // name in that bundle's vendored dependency closure. The rest of the
  // bundle -- upstream/ (the byte-exact npm snapshot, never loaded),
  // upstream-tests/ (provenance), and node_modules/ (the pinned closure
  // itself, whose internal specifiers are upstream's own resolution
  // domain: an in-closure name resolves bundle-locally, a host-API peer
  // resolves to the root install by design, and a dead optional-peer
  // specifier fails at load exactly as it does upstream) -- is pinned
  // input, not OMA code, so its import specifiers are not OMA's
  // declaration boundary.
  const workspaceBundles = layout.workspaces.flatMap(workspace => {
    const manifest = JSON.parse(readFileSync(join(root, workspace.root, "package.json"), "utf8"));
    return (manifest.oma?.assets ?? []).filter(asset => /^vendor\/[^/]+$/.test(asset))
      .map(asset => `${workspace.root}/dist/${asset}/`);
  });
  const vendorManifests = new Map();
  const vendoredDependencies = file => {
    const rel = relative(root, file).split(sep).join("/");
    const bundleRoot = workspaceBundles.find(prefix => rel.startsWith(prefix));
    if (bundleRoot === undefined) return null;
    if (!rel.slice(bundleRoot.length).startsWith("runtime/")) return "skip";
    if (!vendorManifests.has(bundleRoot)) {
      const manifest = JSON.parse(readFileSync(join(root, bundleRoot, "manifest.json"), "utf8"));
      vendorManifests.set(bundleRoot, manifest?.generated?.dependencies ?? {});
    }
    return vendorManifests.get(bundleRoot);
  };
  for (const file of files) {
    requiredFile(file);
    const vendoredDeps = vendoredDependencies(file);
    if (vendoredDeps === "skip") continue;
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const verifyImport = specifier => {
      if (specifier.startsWith(".")) {
        const target = resolve(dirname(file), specifier); requiredFile(target);
        const rel = relative(root, target).split(sep).join("/");
        if (!rel.startsWith("apps/oma/dist/") && !layout.workspaces.some(workspace => rel.startsWith(`${workspace.root}/dist/`)))
          throw new Error(`runtime import reaches non-runtime tree: ${rel}`);
      } else if (!specifier.startsWith("node:")) {
        const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
        // A vendored extension's runtime may also name the Pi host API by
        // peer-dependency semantics: @earendil-works/* packages resolve to
        // the deployment's own root install (never a user package -- the
        // name must exist there to pass).
        const hostApi = vendoredDeps !== null && packageName.startsWith("@earendil-works/") &&
          lstatSync(join(root, "node_modules", packageName, "package.json"), { throwIfNoEntry: false })?.isFile() === true;
        const workspace = layout.workspaces.find(workspace => file.startsWith(join(root, workspace.root, "dist") + sep));
        const declared = workspace ? JSON.parse(readFileSync(join(root, workspace.root, "package.json"), "utf8")) : packageJson;
        if (!Object.hasOwn(declared.dependencies ?? {}, packageName) &&
            !(vendoredDeps !== null && Object.hasOwn(vendoredDeps, packageName)) &&
            !hostApi)
          throw new Error(`runtime imports undeclared or dev dependency: ${specifier}`);
      }
    };
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) verifyImport(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) verifyImport(node.arguments[0].text);
      ts.forEachChild(node, visit);
    }; visit(source);
  }
  return { status: "STATIC_PACKAGE_CHECKED", root, entries: layout.entries, runtimeDependencies: versions,
    limitations: ["entrypoints not started", "native kernel/rootfs/Pi pins not attested", "deploymentDigest bytes not synthesized"] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flag = process.argv.indexOf("--root");
  const root = flag < 0 ? process.cwd() : process.argv[flag + 1];
  if (!root) throw new Error("--root requires an installation directory");
  console.log(JSON.stringify(await checkPackage(root), null, 2));
}
