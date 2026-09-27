// Structure rules for the product surface, the trusted extension and the seams
// around them. They replace tests that read source files and matched text:
// a regex over source cannot tell an import from a comment, so those tests
// passed or failed on prose. Every rule here reads the syntax tree.
import ts from "typescript";
import { eachNode, exists, filesUnder, finding, normalizeRelativeImport, propertyName, sourceOf, strip } from "./shared.mjs";

const EXTENSION_ENTRY = "src/pi-extension.ts";
const EXTENSION_EXTERNALS = new Set(["@earendil-works/pi-coding-agent", "typebox"]);
// TUI-020: each engine primitive has one owner, and only these names are borrowed.
const ENGINE_PRIMITIVE_OWNERS = Object.freeze({
  "src/tui/view/text.ts": Object.freeze(["visibleWidth"]),
  "src/tui/keys.ts": Object.freeze(["parseKey"]),
});
const VIEW = "src/tui/view/";
const VIEW_SEAM = "src/tui/view/index.ts";
const VIEW_CALLER = "src/tui/app.ts";
const VIEW_MAY_IMPORT = [VIEW, "src/tui/model.ts", "src/tui/limits.ts", "src/domain/", "implementation/contracts"];
// TUI-006: the two declared owners of product-surface writes.
const TUI_WRITE_OWNERS = new Set(["src/tui/sources/settings.ts", "src/tui/sources/extensions.ts"]);
const WRITE_CALLS = new Set([
  "writeFileSync", "appendFileSync", "renameSync", "unlinkSync", "rmSync", "mkdirSync", "copyFileSync",
  "symlinkSync", "writeSync", "truncateSync", "replaceDerivedFile", "writeExclusiveFsyncedFile", "moveToCur",
]);
const LEDGER_MODULES = new Set(["node:sqlite", "better-sqlite3"]);
// The deployment layout names the product surface in order to hide it from
// Residents (TUI-003); that is the one legitimate mention on the Resident side.
const PRODUCT_SURFACE_DECLARATION = "src/domain/deployment.ts";
const TUI_FORBIDDEN_CLOSURE = ["src/store.ts", "src/storage/transaction.ts", "src/storage/rows.ts", "src/durable.ts"];
const PRODUCT_DECLARATIONS = new Set(["src/tui/limits.ts", "src/tui/view/layout.ts", "src/domain/tool-surface.ts", "src/config/defaults.ts"]);
// Arch §23: closed unions whose switch must end in assertNever, so a new case
// cannot fall through unnoticed.
const CLOSED_SWITCHES = Object.freeze([
  { file: "src/tui/app.ts", discriminant: "effect.kind", subject: "effect" },
  { file: "src/tui/view/notice.ts", discriminant: "notice.kind", subject: "notice" },
  { file: "src/broker/public-dispatcher.ts", discriminant: "method", subject: "method" },
  { file: "src/broker/internal-dispatcher.ts", discriminant: "dispatchMethod", subject: "dispatchMethod" },
]);
// P11/P12: dispatchers reach modules through ports, never directly.
const DISPATCHER_FORBIDDEN = Object.freeze({
  "src/broker/public-dispatcher.ts": ["src/store.ts", "src/mail.ts", "src/units.ts", "src/views.ts", "src/lifecycle.ts", "src/git.ts", "src/reconcile.ts"],
  "src/broker/internal-dispatcher.ts": ["src/store.ts", "src/mail.ts", "src/reconcile.ts"],
});
// The model-facing CLI parses only mail headers; it never loads the mail module.
const CLI_MAIL_FORBIDDEN = Object.freeze({
  "src/cli.ts": ["src/mail.ts"],
  "src/cli/effects/mail.ts": ["src/mail.ts"],
});

const present = (root, files) => files.filter(file => exists(root, file));
const productFiles = root => [...filesUnder(root, "src/tui"), ...present(root, ["src/domain/tool-surface.ts", "src/config/defaults.ts"])];
const extensionFiles = root => [...present(root, [EXTENSION_ENTRY]), ...filesUnder(root, "src/extension")];

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

/** Files reachable from `entry` through runtime relative imports. */
function runtimeClosure(root, entry) {
  const seen = new Set();
  const walk = file => {
    if (seen.has(file) || !exists(root, file)) return;
    seen.add(file);
    for (const edge of edges(sourceOf(root, file))) {
      if (edge.typeOnly) continue;
      const target = normalizeRelativeImport(file, edge.specifier);
      if (target) walk(target);
    }
  };
  walk(entry);
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
  if (!exists(root, "src/protocol/methods.ts")) return new Set();
  const names = new Set();
  const source = sourceOf(root, "src/protocol/methods.ts");
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
  for (const file of files) {
    const source = sourceOf(root, file);
    // PI-001: the extension runs on the host and inside the sandbox from the
    // same files, so it may import nothing of OMA's runtime.
    for (const edge of edges(source)) {
      const target = normalizeRelativeImport(file, edge.specifier);
      if (target === null) {
        if (!edge.specifier.startsWith("node:") && !EXTENSION_EXTERNALS.has(edge.specifier))
          findings.push(finding("extension-closure", file, `imports ${edge.specifier}; the extension may use only Node built-ins, the engine's extension API and typebox`));
      } else if (!target.startsWith("src/extension/")) {
        findings.push(finding("extension-closure", file, `imports ${target}; the extension imports no OMA runtime module`));
      }
    }
    eachNode(source, node => {
      if (!ts.isCallExpression(node)) return;
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || ["require", "createRequire"].includes(calleeName(node)))
        findings.push(finding("extension-dynamic-load", file, "the trusted extension loads no code at run time"));
      // TSP-006: opening a group activates tools; Pi's own pipeline runs them.
      const callee = strip(node.expression);
      const executes = ts.isPropertyAccessExpression(callee) && (callee.name.text === "execute" ||
        (["call", "apply"].includes(callee.name.text) && ts.isPropertyAccessExpression(strip(callee.expression)) &&
          strip(callee.expression).name.text === "execute"));
      if (executes) findings.push(finding("extension-execute", file, "the extension never invokes a tool handler itself"));
    });
  }
  for (const file of filesUnder(root, "src")) {
    if (members.has(file)) continue;
    for (const edge of edges(sourceOf(root, file))) {
      const target = normalizeRelativeImport(file, edge.specifier);
      if (target?.startsWith("src/extension/"))
        findings.push(finding("extension-closure", file, `imports ${target}; only ${EXTENSION_ENTRY} composes the extension`));
    }
  }
}

function engineRules(root, findings) {
  for (const file of filesUnder(root, "src")) {
    for (const edge of edges(sourceOf(root, file))) {
      if (!edge.specifier.startsWith("@earendil-works/")) continue;
      const owned = ENGINE_PRIMITIVE_OWNERS[file];
      if (edge.specifier === "@earendil-works/pi-tui") {
        if (!owned) findings.push(finding("engine-primitive-owner", file, "imports the engine's terminal library without being its declared owner"));
        else for (const name of edge.names)
          if (!owned.includes(name)) findings.push(finding("engine-primitive-owner", file, `borrows ${name}; only ${owned.join(", ")} is owned here, and layout is not borrowed`));
      } else if (file.startsWith("src/tui/")) {
        findings.push(finding("engine-primitive-owner", file, `imports ${edge.specifier}; the product surface borrows only declared primitives`));
      }
    }
  }
}

function viewRules(root, findings) {
  for (const file of filesUnder(root, "src")) {
    const inView = file.startsWith(VIEW);
    for (const edge of edges(sourceOf(root, file))) {
      const target = normalizeRelativeImport(file, edge.specifier);
      if (inView) {
        // Presentation only: no I/O, and nothing but the data it is handed.
        if (target === null && edge.specifier !== "@earendil-works/pi-tui")
          findings.push(finding("tui-view-boundary", file, `imports ${edge.specifier}; the view performs no I/O`));
        if (target !== null && !VIEW_MAY_IMPORT.some(prefix => target.startsWith(prefix)))
          findings.push(finding("tui-view-boundary", file, `imports ${target}; the view sees only the model's data`));
      } else if (target?.startsWith(VIEW) && !(file === VIEW_CALLER && target === VIEW_SEAM)) {
        findings.push(finding("tui-view-boundary", file, `imports ${target}; only ${VIEW_CALLER} draws, through ${VIEW_SEAM}`));
      }
    }
  }
}

function surfaceEffectRules(root, findings) {
  const internal = internalMethodNames(root);
  for (const file of filesUnder(root, "src/tui")) {
    const source = sourceOf(root, file);
    eachNode(source, node => {
      if (ts.isCallExpression(node) && WRITE_CALLS.has(calleeName(node)) && !TUI_WRITE_OWNERS.has(file))
        findings.push(finding("tui-write-owner", file, `${calleeName(node)} writes; only the settings and extensions sources write`));
    });
    for (const edge of edges(source)) {
      const target = normalizeRelativeImport(file, edge.specifier);
      if (LEDGER_MODULES.has(edge.specifier) || target === "src/store.ts")
        findings.push(finding("tui-ledger", file, "the product surface owns no durable store"));
      if (target === "src/protocol/channel.ts" && !(file === "src/tui/transport.ts" && edge.typeOnly))
        findings.push(finding("tui-transport-owner", file, "the product surface reaches the broker only through its transport owner"));
    }
    for (const { text } of literalTexts(source))
      if (internal.has(text)) findings.push(finding("tui-internal-method", file, `names internal method ${text}; the Dashboard only observes`));
  }
}

function closureRules(root, findings) {
  if (exists(root, "src/entry/oma.ts")) {
    const product = runtimeClosure(root, "src/entry/oma.ts");
    for (const file of product) {
      if (file === "src/cli.ts" || file.startsWith("src/cli/commands/") || file === "src/cli/arguments.ts" || file === "src/cli/exit.ts")
        findings.push(finding("product-cli-separation", file, "the host product reaches the model-facing command surface"));
      if (TUI_FORBIDDEN_CLOSURE.includes(file))
        findings.push(finding("tui-ledger", file, "the host product reaches the durable store owner"));
    }
  }
  if (exists(root, "src/cli.ts"))
    for (const file of runtimeClosure(root, "src/cli.ts"))
      if (file.startsWith("src/tui/") || file === "src/entry/oma.ts")
        findings.push(finding("product-cli-separation", file, "the model-facing CLI reaches the host product"));
  // TUI-003: nothing a Resident runs can reach or name the product entrypoint.
  const resident = new Set([...runtimeClosure(root, "src/entry/runner.ts"), ...runtimeClosure(root, EXTENSION_ENTRY)]);
  for (const file of resident) {
    if (file.startsWith("src/tui/") || file === "src/entry/oma.ts") {
      findings.push(finding("resident-product-surface", file, "the Resident closure reaches the host product"));
      continue;
    }
    if (file === PRODUCT_SURFACE_DECLARATION) continue;
    for (const { text } of literalTexts(sourceOf(root, file)))
      if (/\/tui\/|entry\/oma/.test(text))
        findings.push(finding("resident-product-surface", file, `names the host product (${text})`));
  }
}

function vocabularyRules(root, findings) {
  // TUI-014: Pi is an engine, never a path the product offers.
  for (const file of [...filesUnder(root, "src/tui"), ...present(root, ["src/entry/oma.ts"])])
    for (const { text } of literalTexts(sourceOf(root, file)))
      if (/\bpi (?:config|install|update)\b/.test(text))
        findings.push(finding("product-pi-command", file, `offers a Pi command (${text})`));
  // TUI-003: the model-facing surfaces do not advertise the Human's panel.
  for (const file of [...filesUnder(root, "src/cli"), ...present(root, ["src/cli.ts", "src/views.ts"])])
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
  for (const file of filesUnder(root, "src")) {
    const source = sourceOf(root, file);
    for (const edge of edges(source))
      if ((edge.specifier === "node:os" || edge.specifier === "os") && edge.names.includes("homedir"))
        findings.push(finding("user-pi-state", file, "reads the user's home directory"));
    eachNode(source, node => {
      if (ts.isCallExpression(node) && calleeName(node) === "homedir")
        findings.push(finding("user-pi-state", file, "reads the user's home directory"));
    });
    for (const { text } of literalTexts(source))
      if (/(^|\/)\.pi(\/|$)/.test(text)) findings.push(finding("user-pi-state", file, `names the user's Pi state (${text})`));
  }
}

function ownerShapeRules(root, findings) {
  const settings = "src/tui/sources/settings.ts";
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
const ENV_PRODUCER = "src/tui/session.ts";
const ENV_PRODUCER_FUNCTION = "principalEnvironment";
// Everything the tools put in the CLI's environment: the list copied from the
// engine's own environment, and what the process owner adds itself.
const ENV_FORWARDERS = Object.freeze([
  { file: "src/extension/mail-tools.ts", fn: "cliEnvironment" },
  { file: "src/extension/cli-process.ts", fn: "runCliProcess" },
]);
const ENV_CONSUMER = "src/cli/transport.ts";
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
const isProcessEnv = value =>
  ts.isPropertyAccessExpression(value) && value.name.text === "env" &&
  ts.isIdentifier(value.expression) && value.expression.text === "process";

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
  for (const file of filesUnder(root, "src")) {
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
    if (OMA_NAME.test(name) && !produced.has(name))
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
  for (const file of filesUnder(root, "src")) {
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
 * (runtime/broker-lifetime.ts), so a handler for one of them alone -- and the
 * default action on the others -- cannot be written. */
const TERMINATION_SIGNALS = Object.freeze(["SIGHUP", "SIGINT", "SIGQUIT", "SIGTERM"]);
const HOST_LOSS_OWNER = "src/runtime/broker-lifetime.ts";
const LISTENER_METHODS = new Set(["on", "once", "addListener", "prependListener", "prependOnceListener"]);
/** The processes with a drain: the broker, a Resident's runner, the `oma`
 * TUI, the Mac service and its attach client, a guest's session holder, and
 * guestctl (whose drain is the thaw of a freeze it holds, MAC-620). */
const DRAINING_PROCESSES = Object.freeze([
  "src/entry/broker.ts", "src/entry/runner.ts", "src/entry/oma.ts", "src/entry/omahostd.ts",
  "src/entry/guest-session.ts", "src/entry/guestctl.ts", "src/platform/host/attach-client.ts",
]);
function hostLossSignalRules(root, findings) {
  for (const file of filesUnder(root, "src")) {
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
 * and by the extension's mirror of it (PI-001), and both refuse malformed
 * bytes and keep a U+FEFF: `fatal: true, ignoreBOM: true`. */
const UTF8_OWNERS = Object.freeze(["src/domain/utf8.ts", "src/extension/utf8.ts"]);
function utf8DecoderRules(root, findings) {
  for (const file of filesUnder(root, "src")) {
    eachNode(sourceOf(root, file), node => {
      if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "TextDecoder") return;
      if (!UTF8_OWNERS.includes(file)) {
        findings.push(finding("utf8-decoder-owner", file, "makes its own TextDecoder; UTF-8 is read through src/domain/utf8.ts (the extension: src/extension/utf8.ts)"));
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

export function surfaceRuleFindings(root) {
  const findings = [];
  extensionRules(root, findings);
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
  return findings;
}
