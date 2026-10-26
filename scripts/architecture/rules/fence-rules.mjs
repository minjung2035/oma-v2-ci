/** REC-007: every boundary at which this product starts a child answers the
 * fence question.
 *
 * The society lease is a lock on an open file description, so it is held until
 * the last descriptor onto that description closes. That is what makes it true
 * where no OMA code runs -- after a SIGKILL, after a crash, after a teardown
 * that gave up waiting. But it is only as wide as the set of children that
 * actually inherit the descriptor, and a child spawned without it is a writer
 * of this society that can outlive this society's ownership. The audit found
 * exactly that: the model-facing CLI, a genuine writer of the Principal's
 * private state, could run for its whole 120-second timeout after the host,
 * the engine and the broker had all been killed, and the next `oma` could take
 * the society while it was still writing.
 *
 * A review cannot be the thing that catches the next one. So each place that
 * starts a child must either pass the fence or be named here with the reason
 * it does not, and an exemption that stops being true -- because the call now
 * passes a fence, or because the call is gone -- fails this check rather than
 * sitting in the file as a stale permission.
 */
import ts from "typescript";
import { fenceExemptSpawnOwners, DEFAULT_POLICY } from "../../architecture-owners.mjs";
import { authoredFiles, eachNode, filesUnder, finding, sourceOf, strip } from "./shared.mjs";

/** The raw mechanisms. Only a spawn owner may call these at all; that is the
 * subprocess-owner rule's job, and this one asks what they pass. */
const RAW_SPAWNS = new Set(["spawn", "spawnSync"]);
/** This product's own spawn helpers, which take the fence as their last
 * argument. A caller that omits it is making the same decision as a raw spawn
 * without a fence, and answers here in the same way. */
const FENCED_HELPERS = new Set(["spawnOwnedRpc", "spawnSupervisedService", "spawnSandboxed", "spawnWithPrivateInputs"]);
const codeOnly = ts.createPrinter({ removeComments: true });

const calleeName = node => {
  const callee = strip(node.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
};

/** The nearest named thing a call sits inside, so an exemption names a place a
 * reader can find rather than a line number that moves. */
function enclosingName(node) {
  for (let current = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name)
      return current.name.getText();
    const fn = value => value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value));
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name) && fn(current.initializer))
      return current.name.text;
    if (ts.isPropertyAssignment(current) && current.name && fn(current.initializer))
      return current.name.getText();
  }
  return "<top level>";
}

export function fenceRuleFindings(root) {
  const findings = [];
  const owners = new Set(DEFAULT_POLICY.subprocessOwners);
  const claimed = new Set();
  for (const file of authoredFiles(root)) {
    const source = sourceOf(root, file);
    eachNode(source, node => {
      if (!ts.isCallExpression(node)) return;
      const name = calleeName(node);
      if (name === null) return;
      const raw = RAW_SPAWNS.has(name) && owners.has(file);
      if (!raw && !FENCED_HELPERS.has(name)) return;
      // A re-export names the helper without starting anything.
      if (ts.isExportDeclaration(node.parent)) return;
      const site = `${file}#${enclosingName(node)}`;
      // Comments cannot establish descriptor propagation (MODE-006's private
      // handoff pipe mentions the fence precisely because it carries no lease).
      const passes = /fence/i.test(codeOnly.printNode(ts.EmitHint.Expression, node, source));
      const exemption = fenceExemptSpawnOwners[site];
      if (exemption !== undefined) claimed.add(site);
      if (passes && exemption !== undefined)
        findings.push(finding("fence-exemption-stale", file, `${site} passes a fence and no longer needs its exemption`));
      if (!passes && exemption === undefined)
        findings.push(finding("fence-propagation", file, `${site} starts a child without the society lease; pass the fence or state in fenceExemptSpawnOwners why this child may outlive the society's ownership`));
    });
  }
  for (const site of Object.keys(fenceExemptSpawnOwners))
    if (!claimed.has(site))
      findings.push(finding("fence-exemption-stale", site.split("#")[0], `${site} is exempted from the fence but no such spawn exists`));
  return findings;
}
