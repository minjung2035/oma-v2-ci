#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";

export async function checkPackage(rootInput) {
  const root = realpathSync(rootInput);
  const { DEPLOYMENT_LAYOUT: layout } = await import(pathToFileURL(join(root, "dist/src/domain/deployment.js")).href);
  const { assertRuntimeAssets, runtimeAssets } = await import(pathToFileURL(join(root, "dist/src/runtime/assets.js")).href);
  const paths = runtimeAssets(root);
  assertRuntimeAssets(paths, { schema: join(root, layout.schema), systemd: join(root, layout.systemd) });
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
    const { modelCommandScript } = await import(pathToFileURL(join(root, "dist/src/sandbox.js")).href);
    if (readFileSync(command, "utf8") !== modelCommandScript()) throw new Error(`model command differs from its owner: ${layout.modelCommand}`);
  }
  for (const [template, name] of Object.entries(layout.templateEntries)) {
    const text = readFileSync(join(paths.systemd, template), "utf8");
    const starts = text.split(/\r?\n/).filter(line => line.startsWith("ExecStart="));
    if (starts.length !== 1 || !starts[0].startsWith(`ExecStart=@NODE@ @LIBDIR@/${layout.entries[name]} `))
      throw new Error(`template/build entry mismatch: ${template}`);
    if (text.includes("@LIBDIR@/dist/entry/")) throw new Error(`obsolete flattened entry: ${template}`);
  }
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  // DR18 (C2): the install command is the package's `oma` bin, and it is the
  // product's TUI entry -- the one the deployment layout names -- run by node.
  if (packageJson.bin?.oma !== layout.entries.tui) throw new Error(`package bin "oma" is not the TUI entry ${layout.entries.tui}`);
  requiredFile(join(root, layout.entries.tui));
  if (!readFileSync(join(root, layout.entries.tui), "utf8").startsWith("#!/usr/bin/env node\n"))
    throw new Error("the oma entry cannot be run as a command: it has no node shebang");
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const require = createRequire(join(root, "package.json"));
  const versions = {};
  for (const name of layout.runtimeDependencies) {
    if (!Object.hasOwn(packageJson.dependencies ?? {}, name)) throw new Error(`undeclared runtime dependency: ${name}`);
    // A package may publish an exports map without a CJS main, which makes
    // require.resolve fail even though it is installed. Locate the manifest by
    // walking the installation's node_modules instead; the name and version are
    // still verified against the lockfile below, so this resolves differently
    // without checking less.
    let found = null;
    for (let directory = root; ; ) {
      const manifest = join(directory, "node_modules", name, "package.json");
      if (lstatSync(manifest, { throwIfNoEntry: false })?.isFile()) {
        const rel = relative(root, dirname(manifest));
        if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`dependency resolved outside installation: ${name}`);
        const value = JSON.parse(readFileSync(manifest, "utf8"));
        if (value.name === name) { found = value; break; }
      }
      const parent = dirname(directory); if (parent === directory) break; directory = parent;
    }
    const expected = lock.packages?.[`node_modules/${name}`]?.version;
    if (!found || typeof expected !== "string" || found.version !== expected) throw new Error(`installed/lock version mismatch: ${name}`);
    versions[name] = { installed: found.version, locked: expected, declaredRange: packageJson.dependencies[name] };
    // Loading the native boundary catches a missing Koffi binary. It does not
    // attest pidfd, SO_PEERPIDFD, cgroups, user namespaces or deploymentDigest.
    // Packages without a CJS entry are verified by manifest and lockfile only.
    if (Array.isArray(found.pi?.extensions)) {
      for (const entry of found.pi.extensions) requiredFile(resolve(root, "node_modules", name, entry));
      requiredFile(join(root, "node_modules", name, "LICENSE"));
    } else try { require(name); }
    catch (error) {
      if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED" && error?.code !== "ERR_REQUIRE_ESM") throw error;
    }
  }
  function compiledFiles(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("compiled runtime must not contain source symlinks");
    if (stat.isDirectory()) return readdirSync(path).sort().flatMap(name => compiledFiles(join(path, name)));
    return path.endsWith(".js") ? [path] : [];
  }
  const files = [...compiledFiles(join(root, layout.compiledRoot)), join(root, layout.contract)];
  for (const file of files) {
    requiredFile(file);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const verifyImport = specifier => {
      if (specifier.startsWith(".")) {
        const target = resolve(dirname(file), specifier); requiredFile(target);
        const rel = relative(root, target).split(sep).join("/");
        if (!rel.startsWith("dist/src/") && rel !== layout.contract) throw new Error(`runtime import reaches non-runtime tree: ${rel}`);
      } else if (!specifier.startsWith("node:") && !Object.hasOwn(packageJson.dependencies ?? {}, specifier.split("/")[0])) {
        const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
        if (!Object.hasOwn(packageJson.dependencies ?? {}, packageName)) throw new Error(`runtime imports undeclared or dev dependency: ${specifier}`);
      }
    };
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) verifyImport(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) verifyImport(node.arguments[0].text);
      ts.forEachChild(node, visit);
    }; visit(source);
  }
  return { status: "STATIC_PACKAGE_CHECKED", root, entries: layout.entries, runtimeDependencies: versions,
    limitations: ["entrypoints not started", "systemd/kernel/rootfs/Pi pins not attested", "deploymentDigest bytes not synthesized"] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flag = process.argv.indexOf("--root");
  const root = flag < 0 ? process.cwd() : process.argv[flag + 1];
  if (!root) throw new Error("--root requires an installation directory");
  console.log(JSON.stringify(await checkPackage(root), null, 2));
}
