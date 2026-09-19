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

// The three places the Principal's session environment passes through. They
// broke apart once already: the host produced the credential, the CLI required
// it, and the tools in between rebuilt the environment from a list that never
// mentioned it, so every OMA tool failed authentication while every test passed.
const ENV_PRODUCER = "src/tui/session.ts";
const ENV_PRODUCER_FUNCTION = "principalEnvironment";
const ENV_FORWARDER = "src/extension/mail-tools.ts";
const ENV_FORWARDER_FUNCTION = "cliEnvironment";
const ENV_CONSUMER = "src/cli/transport.ts";
// `socketPath` reads names only to derive an endpoint when none was given; a
// caller that was given one never reaches them, so they are not requirements.
const ENV_CONSUMER_DERIVATION = "socketPath";

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

/** Names the forwarder writes into the environment it builds, whether spelled
 * as an assignment template or held in a constant. */
function forwardedNames(root) {
  if (!exists(root, ENV_FORWARDER)) return null;
  const body = functionBody(sourceOf(root, ENV_FORWARDER), ENV_FORWARDER_FUNCTION);
  if (!body) return null;
  const constants = stringConstants(root, ENV_FORWARDER);
  const names = new Set();
  eachNode(body, node => {
    if (ts.isTemplateExpression(node)) {
      const head = node.head.text;
      if (head.endsWith("=")) names.add(head.slice(0, -1));
    }
    if (ts.isStringLiteralLike(node)) {
      const equals = node.text.indexOf("=");
      if (equals > 0) names.add(node.text.slice(0, equals));
      else if (OMA_NAME.test(node.text)) names.add(node.text);
    }
    if (ts.isIdentifier(node) && constants.has(node.text)) {
      const value = constants.get(node.text);
      if (OMA_NAME.test(value)) names.add(value);
    }
  });
  return names;
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
    const isEnv = value =>
      ts.isPropertyAccessExpression(value) && value.name.text === "env" &&
      ts.isIdentifier(value.expression) && value.expression.text === "process";
    if (ts.isPropertyAccessExpression(node) && isEnv(node.expression) && OMA_NAME.test(node.name.text))
      names.add(node.name.text);
    if (ts.isElementAccessExpression(node) && isEnv(node.expression)) {
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

/** PR-001/TUI-004: the session environment survives every hop.
 *
 * `env -i` means the tools' command carries exactly what they list, so a name
 * the CLI needs and the tools do not forward is a silent authentication
 * failure, and a name the tools forward that the host never sets is a
 * requirement nobody meets. Both are checked here rather than left to whoever
 * remembers to change three files together.
 */
function principalSessionEnvRules(root, findings) {
  const forwarded = forwardedNames(root);
  const consumed = consumedNames(root);
  const produced = producedNames(root);
  if (forwarded === null || consumed === null || produced === null) return;
  for (const name of consumed)
    if (!forwarded.has(name))
      findings.push(finding("principal-session-env", ENV_FORWARDER,
        `the model-facing CLI reads ${name}, but the command the tools build does not carry it`));
  for (const name of forwarded)
    if (OMA_NAME.test(name) && !produced.has(name))
      findings.push(finding("principal-session-env", ENV_PRODUCER,
        `${name} is forwarded to the CLI, but the Principal's session environment never sets it`));
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
  return findings;
}
