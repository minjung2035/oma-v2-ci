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
  for (const [template, name] of Object.entries(layout.templateEntries)) {
    const text = readFileSync(join(paths.systemd, template), "utf8");
    const starts = text.split(/\r?\n/).filter(line => line.startsWith("ExecStart="));
    if (starts.length !== 1 || !starts[0].startsWith(`ExecStart=@NODE@ @LIBDIR@/${layout.entries[name]} `))
      throw new Error(`template/build entry mismatch: ${template}`);
    if (text.includes("@LIBDIR@/dist/entry/")) throw new Error(`obsolete flattened entry: ${template}`);
  }
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const require = createRequire(join(root, "package.json"));
  const versions = {};
  for (const name of layout.runtimeDependencies) {
    if (!Object.hasOwn(packageJson.dependencies ?? {}, name)) throw new Error(`undeclared runtime dependency: ${name}`);
    const resolved = require.resolve(name);
    let directory = dirname(resolved); let found = null;
    for (;;) {
      const rel = relative(root, directory);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`dependency resolved outside installation: ${name}`);
      const manifest = join(directory, "package.json");
      if (lstatSync(manifest, { throwIfNoEntry: false })?.isFile()) {
        const value = JSON.parse(readFileSync(manifest, "utf8"));
        if (value.name === name) { found = value; break; }
      }
      const parent = dirname(directory); if (parent === directory || directory === root) break; directory = parent;
    }
    const expected = lock.packages?.[`node_modules/${name}`]?.version;
    if (!found || typeof expected !== "string" || found.version !== expected) throw new Error(`installed/lock version mismatch: ${name}`);
    versions[name] = { installed: found.version, locked: expected, declaredRange: packageJson.dependencies[name] };
    // Requiring the native boundary catches a missing Koffi binary. It does not
    // attest pidfd, SO_PEERPIDFD, cgroups, user namespaces or deploymentDigest.
    require(name);
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
