/** Mutations locate named syntax owners, then splice only that node. Formatting
 * and comments around a declaration do not become replacement anchors. */
import assert from "node:assert/strict";
import ts from "typescript";
import { eachNode, propertyName, strip } from "../../scripts/architecture/rules/shared.mjs";

function mutate(text, select, edit) {
  const source = ts.createSourceFile("fixture.ts", text, ts.ScriptTarget.Latest, true);
  assert.deepEqual(source.parseDiagnostics, [], "mutation input must parse");
  const matches = [];
  eachNode(source, node => { if (select(node)) matches.push(node); });
  assert.equal(matches.length, 1, "mutation must select exactly one syntax owner");
  const { start, end = start, value } = edit(matches[0], source);
  return text.slice(0, start) + value + text.slice(end);
}
const namedInterface = name => node => ts.isInterfaceDeclaration(node) && node.name.text === name;
const memberOf = (node, member) => {
  const found = node.members.filter(item => propertyName(item.name) === member);
  assert.equal(found.length, 1, `missing or ambiguous member ${member}`);
  return found[0];
};
export function addInterfaceMember(text, name, member) {
  return mutate(text, namedInterface(name), node => ({ start: node.members.pos, value: `\n${member}\n` }));
}
export function removeInterfaceMember(text, name, member) {
  return mutate(text, namedInterface(name), (node, source) => {
    const found = memberOf(node, member);
    return { start: found.getStart(source), end: found.end, value: "" };
  });
}
export function setMemberResult(text, name, member, type) {
  return mutate(text, namedInterface(name), (node, source) => {
    const found = memberOf(node, member);
    assert.ok(ts.isMethodSignature(found) && found.type);
    return { start: found.type.getStart(source), end: found.type.end, value: type };
  });
}
export function setMemberParameter(text, name, member, parameter, type) {
  return mutate(text, namedInterface(name), (node, source) => {
    const found = memberOf(node, member);
    assert.ok(ts.isPropertySignature(found) && ts.isFunctionTypeNode(found.type));
    const params = found.type.parameters.filter(param => propertyName(param.name) === parameter);
    assert.equal(params.length, 1);
    const target = params[0].type;
    return { start: target.getStart(source), end: target.end, value: type };
  });
}
export function prependType(text, name, type) {
  return mutate(text, node => ts.isTypeAliasDeclaration(node) && node.name.text === name, (node, source) => ({
    start: node.type.getStart(source), end: node.type.end,
    value: `${type} | ${node.type.getText(source).replace(/^\|\s*/, "")}`,
  }));
}
export function addRegistryProperty(text, name, property) {
  return mutate(text, node => ts.isVariableDeclaration(node) && propertyName(node.name) === name, node => {
    const object = strip(node.initializer);
    assert.ok(ts.isObjectLiteralExpression(object));
    return { start: object.properties.pos, value: `\n${property}\n` };
  });
}
export function replaceRegistryProperty(text, name, key, property) {
  return mutate(text, node => ts.isVariableDeclaration(node) && propertyName(node.name) === name, (node, source) => {
    const object = strip(node.initializer);
    assert.ok(ts.isObjectLiteralExpression(object));
    const found = object.properties.filter(item => propertyName(item.name) === key);
    assert.equal(found.length, 1);
    return { start: found[0].getStart(source), end: found[0].end, value: property };
  });
}
export function addSwitchCase(text, owner, clause) {
  return mutate(text, node => (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && propertyName(node.name) === owner, node => {
    const switches = [];
    eachNode(node.body, child => { if (ts.isSwitchStatement(child)) switches.push(child); });
    assert.equal(switches.length, 1, `ambiguous switch in ${owner}`);
    return { start: switches[0].caseBlock.clauses.pos, value: `\n${clause}\n` };
  });
}
