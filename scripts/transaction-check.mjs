import ts from 'typescript';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArchitectureProgram } from './dependency-graph.mjs';
import { authoredFiles } from './architecture/rules/shared.mjs';

const EFFECTS = new Set(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync',
  'fsyncSync', 'fdatasyncSync', 'readFileSync', 'writeFileSync', 'appendFileSync', 'renameSync',
  'unlinkSync', 'mkdirSync', 'rmSync', 'openSync', 'fetch']);

export function inspectTransactions(program, root = process.cwd()) {
  const checker = program.getTypeChecker();
  const findings = [];
  const authored = new Set(authoredFiles(root));
  const report = (source, node, message) => {
    const at = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({ file: relative(root, source.fileName).split(sep).join('/'), line: at.line + 1, column: at.character + 1, message });
  };
  const isThenable = type => {
    if (type.isUnionOrIntersection()) return type.types.some(isThenable);
    const then = checker.getPropertyOfType(type, 'then');
    if (!then) return false;
    const at = then.valueDeclaration ?? then.declarations?.[0];
    return at !== undefined && checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(then, at), ts.SignatureKind.Call).length > 0;
  };
  const nameOf = node => {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
    return '';
  };
  for (const source of program.getSourceFiles()) {
    const local = relative(root, source.fileName).split(sep).join('/');
    if (source.isDeclarationFile || !authored.has(local)) continue;
    const visit = node => {
      if (ts.isCallExpression(node) && nameOf(node.expression) === 'transaction') {
        const callback = node.arguments[0];
        if (callback) {
          const signatures = checker.getSignaturesOfType(checker.getTypeAtLocation(callback), ts.SignatureKind.Call);
          if (signatures.some(signature => isThenable(checker.getReturnTypeOfSignature(signature))))
            report(source, callback, 'M-004: transaction callback has a Promise/thenable return type');
          const inspectBody = child => {
            if (ts.isAwaitExpression(child) || (ts.canHaveModifiers(child) && ts.getModifiers(child)?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)))
              report(source, child, 'M-004: async/await is forbidden inside transaction callbacks');
            if (ts.isCallExpression(child) && EFFECTS.has(nameOf(child.expression)))
              report(source, child, 'M-004: filesystem, subprocess or network effects belong outside the transaction');
            ts.forEachChild(child, inspectBody);
          };
          if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) inspectBody(callback);
          else {
            let symbol = checker.getSymbolAtLocation(callback);
            if (symbol && (symbol.flags & ts.SymbolFlags.Alias)) symbol = checker.getAliasedSymbol(symbol);
            for (const declaration of symbol?.declarations ?? []) {
              if (ts.isFunctionDeclaration(declaration) && declaration.body) inspectBody(declaration);
              if (ts.isVariableDeclaration(declaration) && declaration.initializer) inspectBody(declaration.initializer);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}

export function main(root = process.cwd()) {
  const program = createArchitectureProgram(root);
  const findings = inspectTransactions(program, root);
  for (const finding of findings) console.error(`${finding.file}:${finding.line}:${finding.column}: ${finding.message}`);
  if (findings.length) process.exitCode = 1;
  return findings;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
