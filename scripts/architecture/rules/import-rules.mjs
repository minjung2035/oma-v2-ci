import { filesUnder, finding, importSpecifiers, sourceOf } from "./shared.mjs";

const FORBIDDEN_COMMAND_IMPORTS = new Set([
  "node:fs",
  "fs",
  "node:fs/promises",
  "fs/promises",
  "node:child_process",
  "child_process",
  "node:net",
  "net",
  "node:os",
]);

/** Command modules may orchestrate helpers/transport, but do not own raw I/O primitives. */
export function importRuleFindings(root) {
  const findings = [];
  for (const file of filesUnder(root, "apps/oma/src/cli/commands")) {
    const source = sourceOf(root, file);
    for (const { specifier } of importSpecifiers(source)) {
      const lowLevel = FORBIDDEN_COMMAND_IMPORTS.has(specifier) ||
        specifier.includes("/process/") ||
        specifier.endsWith("/request-cache.js") ||
        specifier.endsWith("/protocol/channel.js");
      if (lowLevel)
        findings.push(finding("cli-command-import", file,
          `CLI command orchestration must use an owned helper instead of ${specifier}`));
    }
  }
  return findings;
}
