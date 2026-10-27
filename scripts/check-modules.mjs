#!/usr/bin/env node
/** Check the actual imports, including erased types, against workspace APIs. */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { isBuiltin } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { darwinExecutables } from "./workspace-executables.mjs";

export const ALLOWED_WORKSPACE_DEPENDENCIES = Object.freeze({
  contracts: [], domain: ["contracts"], native: ["contracts", "domain"], process: ["contracts", "domain", "native"], protocol: ["contracts", "domain"],
  config: ["contracts", "domain", "protocol", "native", "file-descriptors", "storage"],
  git: ["contracts", "domain", "protocol", "process", "native", "file-descriptors", "storage"],
  app: ["broker","client","config","contracts","domain","engine","extension","file-descriptors","git","lifecycle","mail","native","platform-linux","platform-mac","process","protocol","reconcile","review","storage","tool-files","tool-hashline","tool-lsp","tool-mcp","tool-runtime","tool-web","tui"],
  "platform-mac": ["contracts", "domain", "protocol", "native", "process"],
  "platform-linux": ["contracts", "domain", "protocol", "native", "file-descriptors", "process", "storage"],
  engine: ["contracts", "domain", "protocol", "client", "process"],
  broker: ["contracts", "domain", "protocol", "native", "process"],
  reconcile: ["contracts", "domain", "protocol"],
  lifecycle: ["contracts", "domain", "protocol", "mail"],
  review: ["contracts", "domain", "protocol", "mail"],
  mail: ["contracts", "domain", "protocol"],
  storage: ["contracts", "domain", "protocol", "native", "file-descriptors", "process"],
  "file-descriptors": [],
  "tool-files": ["file-descriptors"],
  "tool-runtime": ["contracts", "domain", "protocol", "client", "tool-files"],
  "tool-hashline": ["contracts", "domain", "protocol", "tool-runtime", "tool-files"],
  "tool-web": ["contracts", "domain", "protocol", "tool-runtime"],
  "tool-mcp": ["contracts", "domain", "protocol", "tool-runtime"],
  "tool-lsp": ["contracts", "domain", "protocol", "tool-runtime", "tool-files"],
  extension: ["contracts", "domain", "protocol", "client", "tool-runtime", "tool-lsp", "tool-hashline", "tool-web", "tool-mcp"],
  client: ["contracts", "domain", "protocol"], tui: ["contracts", "domain", "protocol"],
});
const slash = path => path.split(sep).join("/");
const packageName = specifier => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
// These consumers may use physical files, never the SQLite ledger or its erased types.
const GIT_HOST_APIS = new Set(["@oma/git/project-preparation"]);
const STORAGE_FILE_CONSUMERS = new Set(["@oma/config", "@oma/git", "@oma/platform-linux"]);
const STORAGE_FILE_APIS = new Set([
  "directory", "durable-fs", "file-digest", "immutable-file", "preaccept-artifact",
  "context-files", "context-snapshot", "context-stream", "submit-spool", "tree-lease", "project-preparation", "staged-tree",
].map(name => `@oma/storage/${name}`));
export function workspaceManifests(root) {
  const directory = resolve(root, "packages");
  const packages = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
    const path = `packages/${entry.name}`;
    const manifest = JSON.parse(readFileSync(resolve(root, path, "package.json"), "utf8"));
    return { path, manifest };
  });
  const app = resolve(root, "apps/oma/package.json");
  if (existsSync(app)) packages.push({path: "apps/oma", manifest: JSON.parse(readFileSync(app, "utf8"))});
  return packages;
}
export function workspaceTestFiles(root) {
  return workspaceManifests(root).flatMap(workspace => {
    const directory = resolve(root, workspace.path, "test");
    return existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith(".test.mjs"))
      .map(name => `${workspace.path}/test/${name}`) : [];
  }).sort();
}
function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? ["vendor", "node_modules", "dist"].includes(entry.name) ? [] : sourceFiles(resolve(directory, entry.name))
    : /\.(?:ts|mjs)$/.test(entry.name) ? [resolve(directory, entry.name)] : []);
}
/** One export map is the resolution policy; implementation paths are never a fallback. */
export function workspaceExportSource(workspace, subpath) {
  const entry = workspace.manifest.exports?.[subpath];
  if (!entry || typeof entry.types !== "string" || typeof entry.default !== "string" ||
      !/^\.\/dist\/.+\.d\.ts$/.test(entry.types) || entry.default !== entry.types.replace(/\.d\.ts$/, ".js")) return null;
  return `${workspace.path}/src/${entry.types.slice("./dist/".length).replace(/\.d\.ts$/, ".ts")}`;
}

/** Root integration tests can name only the App's own authored modules. */
export function appTestSource(root, specifier, from) {
  if (!/^(?:test\/|implementation\/tests\/)/.test(slash(relative(root, from)))) return null;
  const match = /^#oma-test\/app\/([a-z][a-z0-9/-]*)$/.exec(specifier);
  if (!match || match[1].split("/").some(part => !part)) return null;
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const map = manifest.imports?.["#oma-test/app/*"];
  if (!map || Object.keys(map).join(",") !== "types,default" ||
      map.types !== "./apps/oma/dist/*.d.ts" || map.default !== "./apps/oma/dist/*.js") return null;
  const file = `apps/oma/src/${match[1]}.ts`;
  return existsSync(resolve(root, file)) ? file : null;
}

const RAW_INTERACTIVE_CONTACTS = new Set([
  "interactiveInternalsOf", "InteractiveModeInternals", "handleFatalRuntimeError",
  "renderProjectTrustWarningIfNeeded", "suggestBugReport", "crashReportInstructions",
  "updateTerminalTitle", "handleExportCommand", "getPathCommandArgument", "getCrashExtensionHint",
  "showManagedToolStatus", "showSessionSelector", "getRegisteredToolDefinition",
  "toggleThinkingBlockVisibility", "hideThinkingBlock",
]);
export function interactiveHostFindings(source) {
  const findings = new Set();
  const visit = node => {
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && RAW_INTERACTIVE_CONTACTS.has(node.text))
      findings.add(`host depends on raw SDK private contact ${node.text}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...findings];
}

/** Production, package tests and root consumers share module syntax handling. */
function scanReferences(source, reference, asset = () => {}, computed = () => {}) {
  const requires = new Set(["require"]), createRequires = new Set(["createRequire"]);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier) ||
        !["module", "node:module"].includes(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements)
      if ((item.propertyName ?? item.name).text === "createRequire") createRequires.add(item.name.text);
    if (bindings && ts.isNamespaceImport(bindings)) createRequires.add(`${bindings.name.text}.createRequire`);
  }
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings ?? node.exportClause;
      const allTypes = bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) &&
        bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly) && !clause?.name;
      reference(node.moduleSpecifier.text, !(node.isTypeOnly || clause?.isTypeOnly || allTypes));
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal))
      reference(node.argument.literal.text, false);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) &&
        createRequires.has(node.initializer.expression.getText(source))) requires.add(node.name.text);
    if (ts.isNewExpression(node) && node.expression.getText(source) === "URL" && node.arguments?.length === 2 &&
        node.arguments[1].getText(source) === "import.meta.url" && ts.isStringLiteralLike(node.arguments[0])) asset(node.arguments[0].text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        ts.isIdentifier(node.expression) && requires.has(node.expression.text))) {
      const specifier = node.arguments[0];
      if (specifier && ts.isStringLiteralLike(specifier)) reference(specifier.text, true);
      else computed();
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === "import.meta.resolve" &&
        node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) reference(node.arguments[0].text, false);
    ts.forEachChild(node, visit);
  };
  visit(source);
}
export function moduleFindings(root = process.cwd()) {
  root = resolve(root);
  const workspaces = workspaceManifests(root);
  const byName = new Map(workspaces.map(item => [item.manifest.name, item]));
  const edges = new Map(workspaces.map(item => [item.manifest.name, new Set()]));
  const findings = [];
  const report = (file, message) => findings.push(`${file}: ${message}`);
  const rootManifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  if (byName.has("@oma/app")) {
    const maps = Object.entries(rootManifest.imports ?? {});
    if (maps.length !== 1 || maps[0][0] !== "#oma-test/app/*" ||
        JSON.stringify(maps[0][1]) !== JSON.stringify({ types: "./apps/oma/dist/*.d.ts", default: "./apps/oma/dist/*.js" }))
      report("package.json", "invalid private App test map");
    const expected = ["./diagnostics/files", "./diagnostics/integrity", "./diagnostics/ledger", "./runtime/assets"];
    if (JSON.stringify(Object.keys(byName.get("@oma/app").manifest.exports ?? {}).sort()) !== JSON.stringify(expected))
      report("apps/oma/package.json", "App public API differs from the reviewed installer/admin surface");
  }
  for (const workspace of workspaces) {
    const { path, manifest } = workspace;
    const allowed = ALLOWED_WORKSPACE_DEPENDENCIES[manifest.name?.slice(5)];
    if (!allowed || manifest.name !== (path === "apps/oma" ? "@oma/app" : `@oma/${path.split("/").at(-1)}`)) {
      report(path, "workspace has no reviewed dependency policy"); continue;
    }
    if (manifest.version !== JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version)
      report(path, "workspace version differs from the product");
    if (manifest.name === "@oma/tool-files" && Object.keys(manifest.dependencies ?? {}).some(name => name !== "@oma/file-descriptors"))
      report(path, "tool-files runtime dependencies are limited to the standalone descriptor leaf");
    if (manifest.name === "@oma/file-descriptors" && Object.keys(manifest.dependencies ?? {}).some(name => name !== "koffi"))
      report(path, "file-descriptors runtime dependencies are limited to Koffi");
    for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) if (name.startsWith("@oma/")) {
      if (!allowed.includes(name.slice(5))) report(path, `forbidden dependency ${name}`);
      if (!byName.has(name) || version !== byName.get(name).manifest.version) report(path, `unresolved workspace dependency ${name}@${version}`);
      edges.get(manifest.name).add(name);
    }
    for (const subpath of Object.keys(manifest.exports ?? {})) {
      const file = workspaceExportSource(workspace, subpath);
      if (subpath.includes("*") || !file || !existsSync(resolve(root, file))) report(path, `invalid public export ${subpath}`);
    }
    const inspect = (file, specifier, runtime, test = false) => {
      if (specifier.startsWith("#oma-test/")) {
        report(slash(relative(root, file)), `private App test import outside root integration tests: ${specifier}`);
        return;
      }
      if (isBuiltin(specifier)) {
        if (!test && runtime && ["@oma/contracts", "@oma/domain", "@oma/protocol", "@oma/tui", "@oma/mail", "@oma/review", "@oma/lifecycle", "@oma/reconcile"].includes(manifest.name) &&
            /^(?:node:)?(?:fs(?:\/promises)?|net|child_process|sqlite)$/.test(specifier))
          report(slash(relative(root, file)), `effectful builtin forbidden in ${manifest.name}: ${specifier}`);
        return;
      }
      if (specifier.startsWith(".")) {
        const absolute = resolve(dirname(file), specifier);
        const target = slash(relative(resolve(root, path, ...(test ? [] : ["src"])), absolute));
        if (target === ".." || target.startsWith("../")) report(slash(relative(root, file)), `relative import leaves workspace: ${specifier}`);
        else {
          const source = absolute.replace(`${resolve(root, path, "dist")}${sep}`, `${resolve(root, path, "src")}${sep}`);
          if (![absolute, source, source.replace(/\.js$/, ".ts")].some(candidate => existsSync(candidate))) report(slash(relative(root, file)), `unresolved relative import: ${specifier}`);
        }
        return;
      }
      const name = packageName(specifier);
      if (manifest.name === "@oma/file-descriptors" && name !== manifest.name && name !== "koffi")
        report(slash(relative(root, file)), `file-descriptors may import only its own files, Node builtins and Koffi: ${specifier}`);
      if (manifest.name === "@oma/tool-files" && name !== manifest.name &&
          !(slash(relative(root, file)) === "packages/tool-files/src/descriptor-files.ts" && specifier === "@oma/file-descriptors"))
        report(slash(relative(root, file)), `tool-files may import only its own files, Node builtins and the private descriptor adapter: ${specifier}`);
      if (manifest.name === "@oma/platform-mac" && name === "@oma/git" && !GIT_HOST_APIS.has(specifier))
        report(slash(relative(root, file)), `Git host adapter API required in ${manifest.name}: ${specifier}`);
      if (name === "@oma/storage" && STORAGE_FILE_CONSUMERS.has(manifest.name) && !STORAGE_FILE_APIS.has(specifier))
        report(slash(relative(root, file)), `storage ledger capability forbidden in ${manifest.name}: ${specifier}`);
      if (name !== manifest.name && !Object.hasOwn(manifest.dependencies ?? {}, name) && !((test || runtime === false) && Object.hasOwn(manifest.devDependencies ?? {}, name)))
        report(slash(relative(root, file)), `undeclared ${runtime ? "runtime" : "type"} dependency ${specifier}`);
      if (name.startsWith("@oma/")) {
        const target = byName.get(name);
        const subpath = specifier === name ? "." : `.${specifier.slice(name.length)}`;
        if (!target || !workspaceExportSource(target, subpath)) report(slash(relative(root, file)), `private or missing export ${specifier}`);
        if (name !== manifest.name) {
          if (!allowed.includes(name.slice(5))) report(slash(relative(root, file)), `forbidden dependency ${name}`);
          edges.get(manifest.name).add(name);
        }
      }
    };
    for (const scope of ["src", "test"]) for (const file of sourceFiles(resolve(root, path, scope))) {
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      if (scope === "src" && manifest.name === "@oma/engine" && /^packages\/engine\/src\/(?:interactive(?:-[a-z]+)?|personal)\.ts$/.test(slash(relative(root, file))))
        for (const finding of interactiveHostFindings(source)) report(slash(relative(root, file)), finding);
      scanReferences(source, (specifier, runtime) => inspect(file, specifier, runtime, scope === "test"), value => {
        if (scope === "src" && value !== "./") {
          const asset = resolve(dirname(file), value);
          const sourceRoot = resolve(root, path, "src");
          const name = slash(relative(sourceRoot, asset));
          const moduleSource = asset.endsWith(".js") ? asset.slice(0, -3) + ".ts" : null;
          const compiledModule = moduleSource !== null && existsSync(moduleSource) && !moduleSource.endsWith(".d.ts");
          const ownManifest = asset === resolve(root, path, "package.json") && existsSync(asset);
          // Generated binaries have the same reviewed owner/source recipe as
          // the build. A manifest cannot grant another workspace an exception.
          let nativeExecutable = false;
          try { nativeExecutable = darwinExecutables(manifest).some(recipe => recipe.output === name &&
            existsSync(resolve(sourceRoot, recipe.source))); } catch { /* Invalid declarations cannot own an asset. */ }
          const appRootProvider = manifest.name === "@oma/app" && value === "../../../../" &&
            ["src/entry/personal-host.ts", "src/entry/oma-society.ts", "src/entry/oma-mac.ts"]
              .some(entry => file === resolve(root, path, entry));
          if (!ownManifest && !appRootProvider && !nativeExecutable && (name.startsWith("../") || !compiledModule && (!existsSync(asset) || !(manifest.oma?.assets ?? []).includes(name))))
            report(slash(relative(root, file)), `unowned or missing package asset ${value}`);
        }
      }, () => report(slash(relative(root, file)), "computed module loading has no verifiable dependency"));
    }
  }
  // Root consumers also use exports; they cannot bypass a boundary by location.
  for (const directory of ["src", "test", "scripts", "implementation/tests"]) for (const file of sourceFiles(resolve(root, directory))) {
    if (file.includes(`${sep}vendor${sep}`)) continue;
    // Historical audit programs are preserved records and are not build/test
    // inputs. Retiring a runtime must not rewrite the imports in past reviews.
    // Active tests and fixtures keep the export/private-import enforcement.
    if (slash(relative(root, file)).startsWith("test/audit/")) continue;
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    scanReferences(source, specifier => {
        if (specifier.startsWith("#oma-test/")) {
          if (!appTestSource(root, specifier, file)) report(slash(relative(root, file)), `invalid private App test import ${specifier}`);
          return;
        }
        if (specifier.startsWith(".") && slash(relative(root, resolve(dirname(file), specifier))).match(/^(?:packages\/[^/]+|apps\/oma)\//))
          report(slash(relative(root, file)), `workspace implementation import ${specifier}`);
        const target = byName.get(packageName(specifier));
        if (target && !workspaceExportSource(target, specifier === target.manifest.name ? "." : `.${specifier.slice(target.manifest.name.length)}`))
          report(slash(relative(root, file)), `private workspace import ${specifier}`);
    });
  }
  const active = new Set(), done = new Set();
  const visit = name => {
    if (active.has(name)) { report(name, "workspace dependency cycle (including types)"); return; }
    if (done.has(name)) return;
    active.add(name); for (const next of edges.get(name) ?? []) visit(next);
    active.delete(name); done.add(name);
  };
  for (const name of edges.keys()) visit(name);
  return findings;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const findings = moduleFindings();
  for (const finding of findings) console.error(finding);
  console.log(`Workspace boundaries: ${findings.length ? "FAIL" : "PASS"}; ${findings.length} findings`);
  process.exitCode = findings.length ? 1 : 0;
}
