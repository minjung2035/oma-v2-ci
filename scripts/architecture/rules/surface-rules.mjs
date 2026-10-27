// Structure rules for the product surface, the trusted extension and the seams
// around them. They replace tests that read source files and matched text:
// a regex over source cannot tell an import from a comment, so those tests
// passed or failed on prose. Every rule here reads the syntax tree.
import ts from "typescript";
import { readFileSync } from "node:fs";
import { extractEdges } from "../../dependency-graph.mjs";
import { authoredFiles, eachNode, exists, filesUnder, finding, normalizeRelativeImport, propertyName, sourceOf, strip, isVendoredExtension } from "./shared.mjs";

const EXTENSION_ENTRY = "packages/extension/src/index.ts";
const EXTENSION_EXTERNALS = new Set(["@earendil-works/pi-coding-agent", "typebox"]);
// TUI-020: each engine primitive has one owner, and only these names are borrowed.
const ENGINE_PRIMITIVE_OWNERS = Object.freeze({
  // DR37: this pinned compatibility seam updates Pi's existing autocomplete
  // provider after its own installer completes; it owns no terminal layout.
  "packages/engine/src/pi-compat/interactive-tools.ts": Object.freeze(["CombinedAutocompleteProvider", "AutocompleteProvider"]),
  // Public terminal injection replaces the private renderer field; only this
  // SDK adapter constructs the default terminal, and the SDK owns its layout.
  "packages/engine/src/pi-compat/interactive-mode.ts": Object.freeze(["ProcessTerminal"]),
  "packages/engine/src/open-tui-brand.ts": Object.freeze(["visibleWidth"]),
  "packages/tui/src/cells.ts": Object.freeze(["visibleWidth"]),
  "packages/tui/src/keys.ts": Object.freeze(["parseKey"]),
  // DR22: upstream owns the conversation; these adapters own input and lifetime, not layout.
  "packages/engine/src/pi-compat/interactive-editor.ts": Object.freeze(["EditorComponent", "matchesKey"]),
  "packages/engine/src/pi-compat/prompt-editor.ts": Object.freeze(["EditorComponent"]),
  // B1: ANSI-aware fitting and wrapping for the compact tool rows, and the
  // Component contract they are drawn through; the engine's own types are
  // met structurally, so the surface never imports the coding-agent package.
  "packages/tui/src/compact-tools.ts": Object.freeze(["Component", "truncateToWidth", "wrapTextWithAnsi"]),
  // BL2: the questionnaire overlay borrows the key matcher, the ANSI-aware
  // width helpers and the real-cursor marker; its state machine stays pure.
  "packages/tui/src/ask-user-question/component.ts": Object.freeze([
    "CURSOR_MARKER", "isKeyRelease", "isKeyRepeat", "matchesKey",
    "truncateToWidth", "visibleWidth", "wrapTextWithAnsi",
  ]),
  "packages/engine/src/interactive-display.ts": Object.freeze(["Text"]),
});
const VIEW = "packages/tui/src/view/";
const VIEW_SEAM = "packages/tui/src/view/index.ts";
// The chooser owns the terminal before a session/app exists, never alongside it.
const VIEW_CALLERS = new Set(["packages/tui/src/app.ts", "packages/tui/src/session-mode.ts"]);
const VIEW_MAY_IMPORT = [VIEW, "packages/tui/src/model.ts", "packages/domain/src/surface-bounds.ts", "packages/tui/src/cells.ts", "packages/domain/src/", "packages/contracts/src"];
// TUI-006: presentation writes belong to Application. Package staging keeps
// its independent descriptor/host-file checks in owned-state-rules.
// exit.ts's writeSync targets the process's own stdout/stderr fd before
// process.exit (NB-06: a buffered stream write can be dropped); it owns no file.
const TUI_WRITE_OWNERS = new Set(["apps/oma/src/application/settings.ts", "apps/oma/src/application/extensions.ts", "apps/oma/src/application/exit.ts", "apps/oma/src/application/local-packages.ts"]);
const WRITE_CALLS = new Set([
  "writeFileSync", "appendFileSync", "renameSync", "unlinkSync", "rmSync", "mkdirSync", "copyFileSync",
  "symlinkSync", "writeSync", "truncateSync", "replaceDerivedFile", "writeExclusiveFsyncedFile", "moveToCur",
]);
const LEDGER_MODULES = new Set(["node:sqlite", "better-sqlite3"]);
// The deployment layout names the product surface in order to hide it from
// Residents (TUI-003); that is the one legitimate mention on the Resident side.
const PRODUCT_SURFACE_DECLARATION = "packages/domain/src/deployment.ts";
// Host entries also run as separately installed processes; no router edge is
// required for their product/model boundary to be enforced.
const PRODUCT_ENTRIES = Object.freeze([
  "apps/oma/src/entry/oma.ts", "apps/oma/src/entry/oma-society.ts", "apps/oma/src/entry/oma-mac.ts", "apps/oma/src/entry/personal-host.ts",
  "apps/oma/src/entry/pi-personal.ts", "packages/engine/src/personal.ts", "apps/oma/src/entry/pi-interactive.ts", "packages/engine/src/interactive.ts",
]);
const isProductFile = file => file.startsWith("packages/tui/src/") || file.startsWith("apps/oma/src/application/") || PRODUCT_ENTRIES.includes(file);
const TUI_FORBIDDEN_CLOSURE = ["packages/storage/src/store.ts", "packages/storage/src/transaction.ts", "packages/storage/src/rows.ts", "packages/domain/src/durable.ts"];
const PRODUCT_DECLARATIONS = new Set(["packages/domain/src/surface-bounds.ts", "packages/tui/src/view/layout.ts", "packages/domain/src/tool-surface.ts", "packages/config/src/defaults.ts"]);
// Arch §23: closed unions whose switch must end in assertNever, so a new case
// cannot fall through unnoticed.
const CLOSED_SWITCHES = Object.freeze([
  { file: "packages/tui/src/app.ts", discriminant: "effect.kind", subject: "effect" },
  { file: "packages/tui/src/view/notice.ts", discriminant: "notice.kind", subject: "notice" },
  { file: "packages/broker/src/public-dispatcher.ts", discriminant: "method", subject: "method" },
  { file: "packages/broker/src/internal-dispatcher.ts", discriminant: "dispatchMethod", subject: "dispatchMethod" },
]);
// P11/P12: dispatchers reach modules through ports, never directly.
const DISPATCHER_FORBIDDEN = Object.freeze({
  "packages/broker/src/public-dispatcher.ts": ["packages/storage/src/store.ts", "packages/mail/src/index.ts", "packages/platform-linux/src/units.ts", "apps/oma/src/views.ts", "packages/lifecycle/src/index.ts", "packages/git/src/index.ts", "packages/reconcile/src/index.ts"],
  "packages/broker/src/internal-dispatcher.ts": ["packages/storage/src/store.ts", "packages/mail/src/index.ts", "packages/reconcile/src/index.ts"],
});
// The model-facing CLI parses only mail headers; it never loads the mail module.
const CLI_MAIL_FORBIDDEN = Object.freeze({
  "apps/oma/src/cli.ts": ["packages/mail/src/index.ts"],
  "apps/oma/src/cli/effects/mail.ts": ["packages/mail/src/index.ts"],
});

const present = (root, files) => files.filter(file => exists(root, file));
const productFiles = root => [...filesUnder(root, "packages/tui/src"), ...present(root, ["packages/domain/src/tool-surface.ts", "packages/config/src/defaults.ts"])];
const TOOL_SOURCE_ROOTS = Object.freeze(["tool-files", "tool-runtime", "tool-lsp", "tool-hashline", "tool-web", "tool-mcp"].map(name => `packages/${name}/src`));
const extensionFiles = root => [...filesUnder(root, "packages/extension/src"), ...TOOL_SOURCE_ROOTS.flatMap(dir => filesUnder(root, dir))];

/** Module edges, marking those erased at build time. */
function edges(source) {
  const out = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : [];
      const typeOnly = clause?.isTypeOnly === true ||
        (clause !== undefined && clause.name === undefined && named.length > 0 && named.every(element => element.isTypeOnly));
      out.push({ specifier: statement.moduleSpecifier.text, typeOnly, names: named.map(element => (element.propertyName ?? element.name).text), node: statement });
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier))
      out.push({ specifier: statement.moduleSpecifier.text, typeOnly: statement.isTypeOnly, names: [], node: statement });
  }
  return out;
}

/** The lattice's extractor also sees literal import()/require() edges and
 * erased re-exports; deferring a load cannot hide a runtime dependency here. */
function runtimeClosure(root, entries) {
  const seen = new Set();
  const walk = file => {
    if (seen.has(file) || !exists(root, file)) return;
    seen.add(file);
    const { edges } = extractEdges({ source: sourceOf(root, file),
      resolve: specifier => normalizeRelativeImport(file, specifier) });
    for (const edge of edges) if (edge.kind === "runtime") walk(edge.to);
  };
  for (const entry of typeof entries === "string" ? [entries] : entries) walk(entry);
  return seen;
}

/** A module specifier is an edge, judged by the import rules with its
 * type-only marking; as text it would count an erased import as a use. */
function isModuleSpecifier(node) {
  const parent = node.parent;
  return parent !== undefined && (
    ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) ||
    (ts.isLiteralTypeNode(parent) && parent.parent !== undefined && ts.isImportTypeNode(parent.parent)) ||
    (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword));
}

/** Every piece of literal text a program carries: strings and template parts,
 * but not comments and not module specifiers. */
function literalTexts(source) {
  const out = [];
  eachNode(source, node => {
    if (isModuleSpecifier(node)) return;
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      out.push({ text: node.text, node });
  });
  return out;
}

function calleeName(node) {
  const callee = strip(node.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

function internalMethodNames(root) {
  if (!exists(root, "packages/protocol/src/methods.ts")) return new Set();
  const names = new Set();
  const source = sourceOf(root, "packages/protocol/src/methods.ts");
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "INTERNAL_METHODS" || !declaration.initializer) continue;
      const table = strip(declaration.initializer);
      if (!ts.isObjectLiteralExpression(table)) continue;
      for (const property of table.properties) {
        const name = ts.isPropertyAssignment(property) ? propertyName(property.name) : null;
        if (name) names.add(name);
      }
    }
  }
  return names;
}

function extensionRules(root, findings) {
  const files = extensionFiles(root);
  const members = new Set(files);
  for (const file of [...files, ...filesUnder(root, "packages/client/src")]) {
    const source = sourceOf(root, file);
    // PI-001: the extension runs on the host and inside the sandbox from the
    // same files, so it may import nothing of OMA's runtime.
    for (const edge of edges(source)) {
      const target = normalizeRelativeImport(file, edge.specifier);
      if (target === null) {
        if (!edge.specifier.startsWith("node:") && !(members.has(file) && EXTENSION_EXTERNALS.has(edge.specifier)))
          findings.push(finding("extension-closure", file, `imports ${edge.specifier}; the extension may use only Node built-ins, the engine's extension API and typebox`));
      } else if (!(members.has(file) && target.startsWith("packages/extension/src/")) &&
        !["packages/client/src/", "packages/domain/src/", "packages/protocol/src/", ...TOOL_SOURCE_ROOTS.map(dir => `${dir}/`)].some(prefix => target.startsWith(prefix)) &&
        !(edge.typeOnly && (target === "packages/contracts/src/index.ts" || target.startsWith("packages/contracts/src/")))) {
        findings.push(finding("extension-closure", file, `imports ${target}; the extension imports no OMA runtime module`));
      }
      // BL1/F6: a static edge into the vendored bundle evaluates unverified
      // bytes at module load -- before verifyVendorBundle can run. Only a
      // dynamic import() behind verification may reach vendored code; a
      // type-only edge erases at compile and stays legal.
      if (!edge.typeOnly && members.has(file) && target !== null && isVendoredExtension(target))
        findings.push(finding("extension-dynamic-load", file, `statically imports ${target}; a static vendored edge evaluates before verifyVendorBundle -- only dynamic import() behind verification may load vendored code`));
    }
    eachNode(source, node => {
      if (!ts.isCallExpression(node)) return;
      // The one deferred load the extension may make: a literal import()
      // specifier inside the vendored bundle dir -- byte-pinned files
      // evaluated only after verifyVendorBundle has checked them (BL1/F3),
      // which static imports cannot express because they evaluate before
      // the importing module runs. Any other run-time load is forbidden.
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        const specifier = argument !== undefined && ts.isStringLiteralLike(argument) ? argument.text : null;
        const vendored = specifier !== null &&
          isVendoredExtension(normalizeRelativeImport(file, specifier) ?? "");
        if (!vendored)
          findings.push(finding("extension-dynamic-load", file, "the trusted extension loads no code at run time outside a verified vendored bundle"));
      } else if (["require", "createRequire"].includes(calleeName(node)))
        findings.push(finding("extension-dynamic-load", file, "the trusted extension loads no code at run time outside a verified vendored bundle"));
      // TSP-006: opening a group activates tools; Pi's own pipeline runs them.
      const callee = strip(node.expression);
      const executes = ts.isPropertyAccessExpression(callee) && (callee.name.text === "execute" ||
        (["call", "apply"].includes(callee.name.text) && ts.isPropertyAccessExpression(strip(callee.expression)) &&
          strip(callee.expression).name.text === "execute"));
      if (executes) findings.push(finding("extension-execute", file, "the extension never invokes a tool handler itself"));
    });
  }
  for (const file of authoredFiles(root)) {
    if (members.has(file)) continue;
    for (const edge of edges(sourceOf(root, file))) {
      const target = normalizeRelativeImport(file, edge.specifier);
      if (target?.startsWith("packages/extension/src/"))
        findings.push(finding("extension-closure", file, `imports ${target}; only ${EXTENSION_ENTRY} composes the extension`));
    }
  }
}

function engineRules(root, findings) {
  for (const file of authoredFiles(root)) {
    for (const edge of edges(sourceOf(root, file))) {
      if (!edge.specifier.startsWith("@earendil-works/")) continue;
      const owned = ENGINE_PRIMITIVE_OWNERS[file];
      if (edge.specifier === "@earendil-works/pi-tui") {
        if (!owned) findings.push(finding("engine-primitive-owner", file, "imports the engine's terminal library without being its declared owner"));
        else for (const name of edge.names)
          if (!owned.includes(name)) findings.push(finding("engine-primitive-owner", file, `borrows ${name}; only ${owned.join(", ")} is owned here, and layout is not borrowed`));
      } else if (file.startsWith("packages/tui/src/")) {
        findings.push(finding("engine-primitive-owner", file, `imports ${edge.specifier}; the product surface borrows only declared primitives`));
      }
    }
  }
}

function viewRules(root, findings) {
  for (const file of authoredFiles(root)) {
    const inView = file.startsWith(VIEW);
    for (const edge of edges(sourceOf(root, file))) {
      const target = normalizeRelativeImport(file, edge.specifier);
      if (inView) {
        // Presentation only: no I/O, and nothing but the data it is handed.
        if (target === null && edge.specifier !== "@earendil-works/pi-tui")
          findings.push(finding("tui-view-boundary", file, `imports ${edge.specifier}; the view performs no I/O`));
        if (target !== null && !VIEW_MAY_IMPORT.some(prefix => target.startsWith(prefix)))
          findings.push(finding("tui-view-boundary", file, `imports ${target}; the view sees only the model's data`));
      } else if (target?.startsWith(VIEW) && !(VIEW_CALLERS.has(file) && target === VIEW_SEAM)) {
        findings.push(finding("tui-view-boundary", file, `imports ${target}; only the app or pre-session chooser draws, through ${VIEW_SEAM}`));
      }
    }
  }
}

function surfaceEffectRules(root, findings) {
  const internal = internalMethodNames(root);
  for (const file of [...filesUnder(root, "packages/tui/src"), ...filesUnder(root, "apps/oma/src/application")]) {
    const source = sourceOf(root, file);
    eachNode(source, node => {
      if (ts.isCallExpression(node) && WRITE_CALLS.has(calleeName(node)) && !TUI_WRITE_OWNERS.has(file))
        findings.push(finding("tui-write-owner", file, `${calleeName(node)} writes; only the settings and extensions sources write`));
    });
    for (const edge of edges(source)) {
      const target = normalizeRelativeImport(file, edge.specifier);
      if (LEDGER_MODULES.has(edge.specifier) || target === "packages/storage/src/store.ts")
        findings.push(finding("tui-ledger", file, "the product surface owns no durable store"));
      if (target === "packages/client/src/channel.ts" && !(file === "apps/oma/src/application/status-observation.ts" && edge.typeOnly))
        findings.push(finding("tui-transport-owner", file, "the product surface reaches the broker only through its transport owner"));
    }
    for (const { text } of literalTexts(source))
      if (internal.has(text)) findings.push(finding("tui-internal-method", file, `names internal method ${text}; the Dashboard only observes`));
  }
}

function closureRules(root, findings) {
  for (const file of runtimeClosure(root, PRODUCT_ENTRIES)) {
    if (file === "apps/oma/src/cli.ts" || file.startsWith("apps/oma/src/cli/commands/") || file === "apps/oma/src/cli/arguments.ts" || file === "apps/oma/src/cli/exit.ts")
      findings.push(finding("product-cli-separation", file, "the host product reaches the model-facing command surface"));
    if (TUI_FORBIDDEN_CLOSURE.includes(file))
      findings.push(finding("tui-ledger", file, "the host product reaches the durable store owner"));
  }
  if (exists(root, "apps/oma/src/cli.ts"))
    for (const file of runtimeClosure(root, "apps/oma/src/cli.ts"))
      if (isProductFile(file))
        findings.push(finding("product-cli-separation", file, "the model-facing CLI reaches the host product"));
  // TUI-003: nothing a Resident runs can reach or name the product entrypoint.
  const resident = new Set([...runtimeClosure(root, "apps/oma/src/entry/runner.ts"), ...runtimeClosure(root, EXTENSION_ENTRY)]);
  for (const file of resident) {
    if (isProductFile(file)) {
      findings.push(finding("resident-product-surface", file, "the Resident closure reaches the host product"));
      continue;
    }
    if (file === PRODUCT_SURFACE_DECLARATION) continue;
    for (const { text } of literalTexts(sourceOf(root, file)))
      if (/\/tui\//.test(text) || PRODUCT_ENTRIES.some(entry => {
        const stem = entry.slice(0, -3);
        return (entry.startsWith("apps/oma/src/") ? [stem, stem.slice("apps/oma/src/".length), stem.replace("/src/", "/dist/")] : [stem, stem.replace("/src/", "/dist/")])
          .some(path => text.includes(path));
      }))
        findings.push(finding("resident-product-surface", file, `names the host product (${text})`));
  }
}

function vocabularyRules(root, findings) {
  // TUI-014: Pi is an engine, never a path the product offers. DR25: `oma pi
  // <command>` is oma's own command, which runs the engine's over oma's store.
  for (const file of [...filesUnder(root, "packages/tui/src"), ...present(root, PRODUCT_ENTRIES)])
    for (const { text } of literalTexts(sourceOf(root, file)))
      if (/(?<!\boma )\bpi (?:config|install|update)\b/.test(text))
        findings.push(finding("product-pi-command", file, `offers a Pi command (${text})`));
  // TUI-003: the model-facing surfaces do not advertise the Human's panel.
  for (const file of [...filesUnder(root, "apps/oma/src/cli"), ...present(root, ["apps/oma/src/cli.ts", "apps/oma/src/views.ts"])])
    for (const { text } of literalTexts(sourceOf(root, file)))
      if (/Ctrl\+X|Control Panel/.test(text))
        findings.push(finding("model-surface-product-words", file, `advertises the Control Panel (${text})`));
}

function productCodeRules(root, findings) {
  for (const file of productFiles(root)) {
    const source = sourceOf(root, file);
    eachNode(source, node => {
      // The closed error vocabulary: a bare Error has no code a caller can act on.
      if (ts.isThrowStatement(node) && node.expression && ts.isNewExpression(strip(node.expression)) &&
          ts.isIdentifier(strip(node.expression).expression) && strip(node.expression).expression.text === "Error")
        findings.push(finding("product-bare-error", file, "throws a bare Error instead of a StoreError with a closed code"));
      // Bounds are declared once, in a descriptor, not inlined where used.
      // `text` is normalised to decimal, so a hex byte or an octal mode is told
      // apart by how it is written: those name an identity, not a quantity.
      if (!PRODUCT_DECLARATIONS.has(file) && ts.isNumericLiteral(node) && Number(node.text) > 16 &&
          !/^0[xob]/i.test(node.getText())) {
        const call = node.parent && ts.isCallExpression(node.parent) ? node.parent : null;
        const charCode = call && ts.isPropertyAccessExpression(call.expression) &&
          call.expression.name.text === "fromCharCode";
        if (!charCode) findings.push(finding("product-undeclared-bound", file, `inlines ${node.text}; declare it as a named bound`));
      }
    });
  }
}

function userPiRules(root, findings) {
  // TUI-017: OMA's engine state lives under OMA; the user's Pi is never named.
  for (const file of authoredFiles(root)) {
    const source = sourceOf(root, file);
    for (const edge of edges(source))
      if ((edge.specifier === "node:os" || edge.specifier === "os") && edge.names.includes("homedir"))
        findings.push(finding("user-pi-state", file, "reads the user's home directory"));
    eachNode(source, node => {
      if (ts.isCallExpression(node) && calleeName(node) === "homedir")
        findings.push(finding("user-pi-state", file, "reads the user's home directory"));
    });
    for (const { text } of literalTexts(source))
      if (/(^|\/)\.pi(\/|$)/.test(text) && !(file === "apps/oma/src/engine/settings-files.ts" && text === ".pi"))
        // Personal's trusted project settings use Pi's ordinary .pi scope;
        // this storage never names the Human's global ~/.pi engine home.
        findings.push(finding("user-pi-state", file, `names the user's Pi state (${text})`));
  }
}

function ownerShapeRules(root, findings) {
  const settings = "packages/domain/src/settings-policy.ts";
  if (exists(root, settings)) {
    const source = sourceOf(root, settings);
    let switches = 0;
    let table = false;
    eachNode(source, node => {
      if (ts.isSwitchStatement(node) && ts.isIdentifier(strip(node.expression)) && strip(node.expression).text === "field") switches += 1;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "PLACEMENT") table = true;
    });
    if (switches > 1) findings.push(finding("settings-placement-owner", settings, "field behaviour is switched on in more than one place"));
    if (!table) findings.push(finding("settings-placement-owner", settings, "field placement must come from one PLACEMENT table"));
  }
  for (const { file, discriminant, subject } of CLOSED_SWITCHES) {
    if (!exists(root, file)) continue;
    let found = false;
    let closed = false;
    eachNode(sourceOf(root, file), node => {
      if (!ts.isSwitchStatement(node) || strip(node.expression).getText() !== discriminant) return;
      found = true;
      const fallback = node.caseBlock.clauses.find(clause => ts.isDefaultClause(clause));
      eachNode(fallback ?? node.caseBlock, inner => {
        if (fallback && ts.isCallExpression(inner) && calleeName(inner) === "assertNever" &&
            inner.arguments[0] && strip(inner.arguments[0]).getText() === subject) closed = true;
      });
    });
    if (!found || !closed)
      findings.push(finding("closed-switch", file, `the switch over ${discriminant} must end in assertNever(${subject})`));
  }
  for (const [file, forbidden] of Object.entries({ ...DISPATCHER_FORBIDDEN, ...CLI_MAIL_FORBIDDEN })) {
    if (!exists(root, file)) continue;
    for (const edge of edges(sourceOf(root, file))) {
      const target = normalizeRelativeImport(file, edge.specifier);
      if (target && forbidden.includes(target))
        findings.push(finding("module-port-import", file, `imports ${target} directly instead of through its port or leaf`));
    }
  }
}

// The places the Principal's session environment passes through. They broke
// apart once already: the host produced the credential, the CLI required it,
// and the tools in between rebuilt the environment from a list that never
// mentioned it, so every OMA tool failed authentication while every test
// passed.
const ENV_PRODUCER = "packages/engine/src/principal-launch.ts";
const ENV_PRODUCER_FUNCTION = "principalEnvironment";
// Everything the tools put in the CLI's environment: the list copied from the
// engine's own environment, and what the process owner adds itself.
const ENV_FORWARDERS = Object.freeze([
  { file: "packages/extension/src/mail-tools.ts", fn: "cliEnvironment" },
]);
const ENV_CONSUMER = "packages/client/src/settings.ts";
// `socketPath` reads names only to derive an endpoint when none was given; a
// caller that was given one never reaches them, so they are not requirements.
const ENV_CONSUMER_DERIVATION = "socketPath";
// PR-001: the credential and the session handle have no environment name at
// all. An environment is readable by any process of this user through
// /proc/<pid>/environ, so a name for either is a path to leaking it.
const SECRET_ENV_NAMES = Object.freeze(new Set(["OMA_PRINCIPAL_CREDENTIAL", "OMA_PRINCIPAL_SESSION"]));

/** Top-level `const NAME = "value"` in a file, including the ones it imports
 * from elsewhere in the tree, so a name held in a shared constant reads the
 * same here as it does at run time. */
function stringConstants(root, file) {
  const values = new Map();
  if (!exists(root, file)) return values;
  const source = sourceOf(root, file);
  const collect = current => {
    for (const statement of current.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.initializer && ts.isStringLiteralLike(declaration.initializer))
          values.set(declaration.name.text, declaration.initializer.text);
    }
  };
  collect(source);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const target = normalizeRelativeImport(file, statement.moduleSpecifier.text);
    if (target === null || target === file) continue;
    if (!exists(root, target)) continue;
    collect(sourceOf(root, target));
  }
  return values;
}

function functionBody(source, name) {
  let found = null;
  eachNode(source, node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
  });
  return found;
}

const OMA_NAME = /^OMA_[A-Z0-9_]+$/;
/** Engine-only names: the worker archive exists only inside a Resident's
 * sandbox; the Principal's session must never set it, and its absence is how
 * the Principal's engine is told it has no worker archive. */
const ENGINE_ONLY_ENV = new Set(["OMA_WORKER_ARCHIVE"]);
const isProcessEnv = value =>
  ts.isPropertyAccessExpression(value) && value.name.text === "env" &&
  ((ts.isIdentifier(value.expression) && value.expression.text === "process") ||
    (ts.isCallExpression(value.expression) && calleeName(value.expression) === "currentContext"));

/** Names the forwarders put into the CLI's environment, and the subset they
 * copy from the engine's own environment (which the host must therefore set). */
function forwardedNames(root) {
  const forwarded = new Set();
  const copied = new Set();
  let found = false;
  for (const { file, fn } of ENV_FORWARDERS) {
    if (!exists(root, file)) continue;
    const body = functionBody(sourceOf(root, file), fn);
    if (!body) continue;
    found = true;
    const constants = stringConstants(root, file);
    const resolve = node =>
      ts.isStringLiteralLike(node) ? node.text
        : ts.isIdentifier(node) && constants.has(node.text) ? constants.get(node.text) : null;
    eachNode(body, node => {
      // { NAME: value }
      if (ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent)) {
        const key = node.name;
        const name = ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text
          : ts.isComputedPropertyName(key) ? resolve(key.expression) : null;
        if (name) forwarded.add(name);
      }
      // environment[NAME] = value
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isElementAccessExpression(node.left) && !isProcessEnv(node.left.expression)) {
        const name = resolve(node.left.argumentExpression);
        if (name) forwarded.add(name);
      }
      // `NAME=${value}`
      if (ts.isTemplateExpression(node) && node.head.text.endsWith("=")) forwarded.add(node.head.text.slice(0, -1));
      // for (const name of [A, B]) { ... process.env[name] ... }: copied names
      if (ts.isForOfStatement(node) && ts.isArrayLiteralExpression(node.expression) &&
          ts.isVariableDeclarationList(node.initializer)) {
        const variable = node.initializer.declarations[0]?.name;
        let readsEnv = false;
        eachNode(node.statement, inner => {
          if (ts.isElementAccessExpression(inner) && isProcessEnv(inner.expression) &&
              ts.isIdentifier(inner.argumentExpression) && variable && ts.isIdentifier(variable) &&
              inner.argumentExpression.text === variable.text) readsEnv = true;
        });
        if (readsEnv) for (const element of node.expression.elements) {
          const name = resolve(element);
          if (name) { copied.add(name); forwarded.add(name); }
        }
      }
      // process.env.NAME / process.env[NAME] read directly: copied names
      if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression) && OMA_NAME.test(node.name.text))
        copied.add(node.name.text);
    });
  }
  return found ? { forwarded, copied } : null;
}

/** Names the consumer reads from its own environment, outside the branch that
 * only derives an endpoint for a caller that was given none. */
function consumedNames(root) {
  if (!exists(root, ENV_CONSUMER)) return null;
  const source = sourceOf(root, ENV_CONSUMER);
  const constants = stringConstants(root, ENV_CONSUMER);
  const derivation = functionBody(source, ENV_CONSUMER_DERIVATION);
  const derived = new Set();
  if (derivation) eachNode(derivation, node => derived.add(node));
  const names = new Set();
  eachNode(source, node => {
    if (derived.has(node)) return;
    if (ts.isStringLiteralLike(node) && OMA_NAME.test(node.text)) names.add(node.text);
    if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression) && OMA_NAME.test(node.name.text))
      names.add(node.name.text);
    if (ts.isElementAccessExpression(node) && isProcessEnv(node.expression)) {
      const argument = node.argumentExpression;
      if (ts.isStringLiteralLike(argument) && OMA_NAME.test(argument.text)) names.add(argument.text);
      if (ts.isIdentifier(argument) && constants.has(argument.text)) {
        const value = constants.get(argument.text);
        if (OMA_NAME.test(value)) names.add(value);
      }
    }
  });
  return names;
}

/** Names the producer puts in the session environment it hands the engine. */
function producedNames(root) {
  if (!exists(root, ENV_PRODUCER)) return null;
  const body = functionBody(sourceOf(root, ENV_PRODUCER), ENV_PRODUCER_FUNCTION);
  if (!body) return null;
  const constants = stringConstants(root, ENV_PRODUCER);
  const names = new Set();
  eachNode(body, node => {
    if (!ts.isObjectLiteralExpression(node)) return;
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = property.name;
      if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) names.add(key.text);
      else if (ts.isComputedPropertyName(key)) {
        if (ts.isStringLiteralLike(key.expression)) names.add(key.expression.text);
        if (ts.isIdentifier(key.expression) && constants.has(key.expression.text))
          names.add(constants.get(key.expression.text));
      }
    }
  });
  return names;
}

/** PR-001/TUI-004: the session environment survives every hop, and the secret
 * never enters one.
 *
 * The tools build the CLI's environment from nothing, so a name the CLI needs
 * and the tools do not put there is a silent failure; a name the tools copy
 * from the engine that the host never sets is a requirement nobody meets; and
 * a credential given an environment name is a credential any process of this
 * user can read.
 */
function principalSessionEnvRules(root, findings) {
  // Every spelling: a string, an object key, a property read. A rule that only
  // looked at strings would miss `{ OMA_PRINCIPAL_CREDENTIAL: value }`.
  for (const file of authoredFiles(root)) {
    const named = new Set();
    eachNode(sourceOf(root, file), node => {
      if ((ts.isStringLiteralLike(node) || ts.isIdentifier(node)) && SECRET_ENV_NAMES.has(node.text)) named.add(node.text);
    });
    for (const text of named)
      findings.push(finding("principal-secret-env", file,
        `names ${text}; the Principal's credential and session handle have no environment name`));
  }
  const forwarder = forwardedNames(root);
  const consumed = consumedNames(root);
  const produced = producedNames(root);
  if (forwarder === null || consumed === null || produced === null) return;
  for (const name of consumed)
    if (!forwarder.forwarded.has(name))
      findings.push(finding("principal-session-env", ENV_FORWARDERS[0].file,
        `the model-facing CLI reads ${name}, but the environment the tools build does not carry it`));
  for (const name of forwarder.copied)
    if (OMA_NAME.test(name) && !produced.has(name) && !ENGINE_ONLY_ENV.has(name))
      findings.push(finding("principal-session-env", ENV_PRODUCER,
        `${name} is copied to the CLI from the engine's environment, but the Principal's session environment never sets it`));
}

/** PR-002: the host writes a prompt only into an engine that is running
 * nothing.
 *
 * Pi's `streamingBehavior` exists to put a message into a run that is already
 * going. OMA does not: a run belongs to one owner -- a Human prompt or a mail
 * delivery -- and the trusted extension records one boundary per run, so a
 * second owner's message inside a run makes that boundary cover both. The
 * Human's prompts wait in the host instead. Naming the option in the product
 * is therefore the mistake itself, whatever the value.
 */
function principalTurnOwnerRules(root, findings) {
  for (const file of authoredFiles(root)) {
    let named = false;
    eachNode(sourceOf(root, file), node => {
      if ((ts.isStringLiteralLike(node) || ts.isIdentifier(node)) && node.text === "streamingBehavior") named = true;
    });
    if (named)
      findings.push(finding("principal-turn-owner", file,
        "names streamingBehavior; OMA writes a prompt only into an engine running nothing, so a run has one owner and one boundary"));
  }
}

/** AV31, P0V-81: the termination signals a process can catch (glibc's
 * "Termination Signals", less SIGKILL). A process of this product that has a
 * drain takes it on each of them, and they are named together in one list
 * (process/host-loss.ts), so a handler for one of them alone -- and the
 * default action on the others -- cannot be written. */
const TERMINATION_SIGNALS = Object.freeze(["SIGHUP", "SIGINT", "SIGQUIT", "SIGTERM"]);
const HOST_LOSS_OWNER = "packages/domain/src/host-signals.ts";
const LISTENER_METHODS = new Set(["on", "once", "addListener", "prependListener", "prependOnceListener"]);
/** The owners with a drain, not the birth-only router: the broker, a
 * Resident's runner, Society host, Personal child holder and pre-session chooser. */
const DRAINING_PROCESSES = Object.freeze([
  "apps/oma/src/entry/broker.ts", "apps/oma/src/entry/runner.ts", "apps/oma/src/entry/oma-society.ts",
  "apps/oma/src/runtime/personal-session.ts", "packages/tui/src/session-mode.ts",
]);
function hostLossSignalRules(root, findings) {
  for (const file of authoredFiles(root)) {
    eachNode(sourceOf(root, file), node => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      if (!LISTENER_METHODS.has(node.expression.name.text)) return;
      const first = node.arguments[0];
      if (first && ts.isStringLiteralLike(first) && TERMINATION_SIGNALS.includes(first.text))
        findings.push(finding("host-loss-signals", file,
          `handles ${first.text} alone; a process asked to end may be asked by any of HOST_LOSS_SIGNALS, and takes them together`));
    });
  }
  if (exists(root, HOST_LOSS_OWNER)) {
    let listed = null;
    eachNode(sourceOf(root, HOST_LOSS_OWNER), node => {
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== "HOST_LOSS_SIGNALS") return;
      listed = [];
      eachNode(node, inner => { if (ts.isStringLiteralLike(inner)) listed.push(inner.text); });
    });
    const sorted = listed === null ? null : [...listed].sort();
    if (sorted === null || sorted.join(",") !== TERMINATION_SIGNALS.join(","))
      findings.push(finding("host-loss-signals", HOST_LOSS_OWNER,
        `HOST_LOSS_SIGNALS is ${sorted === null ? "missing" : `[${sorted.join(", ")}]`}; it is every termination signal a process can catch: ${TERMINATION_SIGNALS.join(", ")}`));
  }
  for (const file of DRAINING_PROCESSES) {
    if (!exists(root, file)) continue;
    let takes = false;
    eachNode(sourceOf(root, file), node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "stopOnHostLoss") takes = true;
      if (ts.isForOfStatement(node) && ts.isIdentifier(node.expression) && node.expression.text === "HOST_LOSS_SIGNALS") takes = true;
    });
    if (!takes)
      findings.push(finding("host-loss-signals", file, "has a drain, and does not take it on HOST_LOSS_SIGNALS (stopOnHostLoss, or a loop over the list)"));
  }
}

/** P0V-86 (R6-09): one reading of UTF-8. A decoder is made only by the owner
 * alone; all consumers import its public API. It refuses malformed
 * bytes and keep a U+FEFF: `fatal: true, ignoreBOM: true`. */
const UTF8_OWNERS = Object.freeze(["packages/domain/src/utf8.ts"]);
function utf8DecoderRules(root, findings) {
  for (const file of authoredFiles(root)) {
    eachNode(sourceOf(root, file), node => {
      if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "TextDecoder") return;
      if (!UTF8_OWNERS.includes(file)) {
        findings.push(finding("utf8-decoder-owner", file, "makes its own TextDecoder; UTF-8 is read through @oma/domain/utf8"));
        return;
      }
      const options = node.arguments?.[1];
      const flag = name => options !== undefined && ts.isObjectLiteralExpression(options) && options.properties.some(property =>
        ts.isPropertyAssignment(property) && propertyName(property.name) === name && property.initializer.kind === ts.SyntaxKind.TrueKeyword);
      if (!flag("fatal") || !flag("ignoreBOM"))
        findings.push(finding("utf8-decoder-owner", file, "the owner's decoder must refuse malformed bytes and keep a U+FEFF (fatal: true, ignoreBOM: true)"));
    });
  }
}

/** Local exceptions use the shared domain error owner. Views render the
 * supplied text; terminal character/width handling stays in view/text.ts. */
const ENGINE_CONTENT = Object.freeze({ "packages/engine/src/principal-session.ts": "event" });
function errorWordsRules(root, findings) {
  const files = [...filesUnder(root, "packages/tui/src").filter(file => !file.startsWith(VIEW)),
    ...filesUnder(root, "apps/oma/src/application"),
    ...present(root, ["apps/oma/src/entry/oma.ts", "apps/oma/src/entry/oma-society.ts"])];
  for (const file of files) {
    const caught = new Set();
    const source = sourceOf(root, file);
    eachNode(source, node => {
      if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name))
        caught.add(node.variableDeclaration.name.text);
    });
    eachNode(source, node => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
        && ts.isIdentifier(node.right) && node.right.text === "Error")
        findings.push(finding("error-words-owner", file, "reads a thrown value's words itself (instanceof Error); use exceptionText from packages/domain/src/errors.ts"));
      if (ts.isPropertyAccessExpression(node) && node.name.text === "message"
        && !(ts.isIdentifier(node.expression) && ENGINE_CONTENT[file] === node.expression.text))
        findings.push(finding("error-words-owner", file, `reads .message of ${node.expression.getText(source)}; an error's words come from exceptionText (packages/domain/src/errors.ts)`));
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "String"
        && node.arguments.length === 1 && ts.isIdentifier(node.arguments[0]) && caught.has(node.arguments[0].text))
        findings.push(finding("error-words-owner", file, "turns a caught value into text with String(); use exceptionText from packages/domain/src/errors.ts"));
    });
  }
}

/** DR18: no spike is open in v1. What this version does not do is refused as
 * a known unsupported setting (UNSUPPORTED_PROFILE), which tells the Human
 * the setting and not a pending experiment. The code stays in the wire's
 * enum, so stored receipts that carry it are still read. Opening a spike
 * again is a design revision, not a new throw. */
function openSpikeRules(root, findings) {
  for (const file of authoredFiles(root)) {
    eachNode(sourceOf(root, file), node => {
      if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "StoreError") return;
      const first = node.arguments?.[0];
      if (first !== undefined && ts.isStringLiteralLike(first) && first.text === "SPIKE_UNRESOLVED")
        findings.push(finding("no-open-spike", file, "throws SPIKE_UNRESOLVED; no spike is open in v1 (DR18): refuse with UNSUPPORTED_PROFILE"));
    });
    eachNode(sourceOf(root, file), node => {
      if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
        && node.text.includes("OMA_ERROR=SPIKE_UNRESOLVED"))
        findings.push(finding("no-open-spike", file, "a helper script reports SPIKE_UNRESOLVED; no spike is open in v1 (DR18)"));
    });
  }
}

/** P0V-104 (F-03): a callback a socket or a stream calls with its data has
 * no caller to catch what it throws -- an exception there ends the whole
 * process, not the one stream. So a data callback makes no synchronous file
 * effect outside a try that hands the failure on (the one receiver,
 * `apps/oma/src/platform/stream-receive.ts`, is the model). The callback is the
 * function given to `.on`/`.once("data", ...)`, found inline, as a function
 * or constant of the same file, or as a member of the class it names. */
const SYNC_FILE_EFFECTS = new Set(["writeSync", "fsyncSync", "fdatasyncSync", "closeSync", "openSync", "unlinkSync", "renameSync",
  "ftruncateSync", "truncateSync", "linkSync", "symlinkSync", "mkdirSync", "rmSync", "rmdirSync", "appendFileSync", "writeFileSync", "copyFileSync"]);
function socketCallbackEffectRules(root, findings) {
  for (const file of authoredFiles(root)) {
    const source = sourceOf(root, file);
    const named = new Map();
    eachNode(source, node => {
      if (ts.isFunctionDeclaration(node) && node.name) named.set(node.name.text, node);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
        && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) named.set(node.name.text, node.initializer);
      if ((ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
        const body = ts.isPropertyDeclaration(node) ? node.initializer : node;
        if (body && (ts.isMethodDeclaration(body) || ts.isArrowFunction(body) || ts.isFunctionExpression(body))) named.set(`this.${node.name.text}`, body);
      }
    });
    eachNode(source, node => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      if (!["on", "once", "addListener", "prependListener"].includes(node.expression.name.text)) return;
      const [event, handler] = node.arguments;
      if (event === undefined || !ts.isStringLiteralLike(event) || event.text !== "data" || handler === undefined) return;
      const target = ts.isArrowFunction(handler) || ts.isFunctionExpression(handler) ? handler
        : ts.isIdentifier(handler) ? named.get(handler.text)
        : ts.isPropertyAccessExpression(handler) && handler.expression.kind === ts.SyntaxKind.ThisKeyword ? named.get(`this.${handler.name.text}`) : undefined;
      if (target === undefined) return;
      eachNode(target, inner => {
        if (!ts.isCallExpression(inner)) return;
        const callee = ts.isIdentifier(inner.expression) ? inner.expression.text : ts.isPropertyAccessExpression(inner.expression) ? inner.expression.name.text : null;
        if (callee === null || !SYNC_FILE_EFFECTS.has(callee)) return;
        for (let up = inner.parent; up && up !== target.parent; up = up.parent)
          if (ts.isBlock(up) && up.parent && ts.isTryStatement(up.parent) && up.parent.tryBlock === up) return;
        findings.push(finding("socket-callback-effects", file,
          `a data callback calls ${callee} outside a try: what it throws would end the process; hand the failure to the stream's promise (platform/stream-receive.ts)`));
      });
    });
  }
}

/** DR27: Pi owns the extension registry it loaded -- OMA wraps presentation
 * at the render lookup (getRegisteredToolDefinition), so no source may call
 * a mutating Map method on a `tools` property. A new map built locally is
 * the same violation spelled differently only if it is handed to Pi's
 * registry, and no seam exists for that either. */
function extensionRegistryRules(root, findings) {
  const mutators = new Set(["set", "delete", "clear"]);
  for (const file of authoredFiles(root)) {
    eachNode(sourceOf(root, file), node => {
      if (!ts.isCallExpression(node)) return;
      const callee = strip(node.expression);
      if (!ts.isPropertyAccessExpression(callee) || !mutators.has(callee.name.text)) return;
      const receiver = strip(callee.expression);
      if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === "tools")
        findings.push(finding("extension-registry-owner", file,
          `${receiver.getText()}.tools.${callee.name.text}(...) writes the extension registry; presentation policy wraps the render lookup, it never writes Pi's registry`));
    });
  }
}

// Public subpath APIs avoid an eager barrel that loads every UI adapter.
export const TUI_PUBLIC_SUBPATHS = Object.freeze(Object.keys(JSON.parse(
  readFileSync(new URL("../../../packages/tui/package.json", import.meta.url), "utf8"),
).exports).map(name => name.slice(2)));
const TUI_PUBLIC_APIS = new Set(TUI_PUBLIC_SUBPATHS.map(name => `packages/tui/src/${name}.ts`));
function moduleBoundaryRules(root, findings) {
  for (const file of authoredFiles(root)) {
    const extracted = extractEdges({ source: sourceOf(root, file),
      resolve: specifier => normalizeRelativeImport(file, specifier) });
    const references = [...extracted.edges, ...extracted.external.map(specifier => ({ specifier }))];
    for (const edge of references) {
      const target = normalizeRelativeImport(file, edge.specifier);
      if (file.startsWith("packages/tui/src/")) {
        if (target !== null && ["apps/oma/src/runtime/", "apps/oma/src/application/", "packages/storage/src/", "packages/config/src/", "apps/oma/src/broker/"].some(prefix => target.startsWith(prefix)) ||
            target === "packages/config/src/index.ts" || target !== null && target.startsWith("apps/oma/src/platform/") ||
            ["packages/broker/src/index.ts", "packages/storage/src/store.ts", "apps/oma/src/runner.ts", "packages/reconcile/src/index.ts", "packages/lifecycle/src/index.ts"].includes(target) ||
            ["fs", "fs/promises", "child_process", "net", "sqlite"].includes(edge.specifier.replace(/^node:/, "")))
          findings.push(finding("tui-module-boundary", file, `imports ${edge.specifier}; file, configuration and process effects belong to Application/Runtime ports`));
      } else if (target?.startsWith("packages/tui/src/") && !TUI_PUBLIC_APIS.has(target))
        findings.push(finding("tui-public-api", file, `imports private presentation module ${target}`));
      if ((file.startsWith("apps/oma/src/runtime/") || file.startsWith("packages/engine/src/")) && target !== null && ["packages/tui/src/", "apps/oma/src/application/"].some(prefix => target.startsWith(prefix)))
        findings.push(finding("runtime-module-boundary", file, `imports ${target}; Runtime receives product policy through its ports`));
      if ((file === "apps/oma/src/application/society-runtime.ts" && target?.startsWith("packages/tui/src/")) ||
          (file === "apps/oma/src/application/society-interaction.ts" && ["login", "principal-events", "principal-launch", "principal-session", "session-directories"].some(name => target === `packages/engine/src/${name}.ts`)))
        findings.push(finding("society-conversation-boundary", file, `imports ${target}; conversation commands and presentation observations use society-conversation`));
      if (["packages/platform-mac/src/", "packages/platform-linux/src/"].some(prefix => file.startsWith(prefix)) &&
          target?.startsWith("apps/oma/src/"))
        findings.push(finding("platform-adapter-boundary", file, `imports ${target}; platform adapters receive capabilities from App composition`));
      if (!file.startsWith("apps/oma/src/runtime/packages/") && target === "apps/oma/src/runtime/packages/store.ts")
        findings.push(finding("package-public-api", file, "imports the package store implementation instead of runtime/packages/index"));
    }
    if (file.startsWith("packages/tui/src/") && extracted.unresolved.some(edge => edge.reason === "nonliteral"))
      findings.push(finding("tui-module-boundary", file, "loads a computed module; presentation adapters use declared dependencies"));
  }
}

export function surfaceRuleFindings(root) {
  const findings = [];
  moduleBoundaryRules(root, findings);
  extensionRules(root, findings);
  extensionRegistryRules(root, findings);
  engineRules(root, findings);
  viewRules(root, findings);
  surfaceEffectRules(root, findings);
  closureRules(root, findings);
  vocabularyRules(root, findings);
  productCodeRules(root, findings);
  userPiRules(root, findings);
  ownerShapeRules(root, findings);
  principalSessionEnvRules(root, findings);
  principalTurnOwnerRules(root, findings);
  hostLossSignalRules(root, findings);
  utf8DecoderRules(root, findings);
  errorWordsRules(root, findings);
  openSpikeRules(root, findings);
  socketCallbackEffectRules(root, findings);
  return findings;
}
