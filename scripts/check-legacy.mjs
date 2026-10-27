#!/usr/bin/env node
/** Completed removal decisions, not a ban on historical facts or recovery. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { authoredFiles } from "./architecture/rules/shared.mjs";

const REMOVED_PATHS = Object.freeze([
  // DR49: no native path may fall back to the retired VM runtime.
  "apps/oma/src/platform/host", "apps/oma/src/platform/guest",
  "apps/oma/src/entry/oma-mac.ts", "apps/oma/src/entry/omahostd.ts",
  "packages/platform-mac/src/vmhelper", "packages/platform-mac/src/vz-driver.ts",
  "packages/platform-linux/src/guest", "packages/platform-linux/src/guest-system.ts",
  "packages/tool-runtime/src/contained-files.ts",
  "packages/tui/src/words.ts", "packages/domain/src/product-text.ts",
  "src",
  "apps/oma/src/engine/proper-lockfile.d.ts",
  "src/platform/host/files.ts",
  "src/platform/host/bundle.ts",
  "src/platform/host/bookmark.ts",
  "src/platform/host/archive-crypto.ts",
  "src/platform/host/image.ts",
  "src/platform/host/record.ts",
  "src/platform/host/native-channel.ts",
  "src/platform/host/keychain-client.ts",
  "src/platform/host/vz-driver.ts",
  "src/runtime/process-writer.ts",
  "src/platform/host/keychain.ts",
  "packages/storage/src/project-preparation.ts",
  "platform/host",

  "packages/domain/src/resources.ts", "packages/domain/src/tier-snapshot.ts", "packages/domain/src/tier-evaluation.ts",
  "src/attestation.ts", "src/git/approval.ts", "src/git/tiered-authority.ts", "src/git/attestation-snapshot.ts",
  "src/authority.ts", "packages/storage/src/receipt-projector.ts",
  "src/pi-extension.ts", "src/extension", "tsconfig.extension.json",
  "src/extension/vendor", "src/extension/mcp-sdk-env.ts",
  "src/extension/hashline-tools.ts", "src/extension/vendor/pi-hashline-edit-pro",
  "src/extension/web-tools.ts", "src/extension/vendor/pi-web-access",
  "src/extension/mcp-tools.ts", "src/extension/vendor/pi-mcp-adapter",
  "src/extension/lsp-tools.ts", "src/extension/lsp-call-scope.ts", "src/extension/vendor/pi-lsp",
  "src/extension/batch-view.ts", "src/extension/child-env.ts", "src/extension/contained-files.ts", "src/extension/contained-search.ts", "src/extension/contained-tools.ts", "src/extension/provenance.ts", "src/extension/shared.ts", "src/extension/tool-surface.ts", "src/extension/vendor-bundle.ts", "src/extension/workspace-guard.ts", "src/extension/utf8.ts",
  "scripts/probe-entry-qualification.mjs", "src/module-ports.ts", "implementation/contracts", "implementation/contracts.ts", "tsconfig.tui.json",
  "src/domain", "src/protocol", "src/client", "src/tui", "src/process", "src/leaf.ts",
  "packages/domain/src/request-hash.ts",
  "packages/tui/src/open-tui-brand.ts",
  "packages/platform-linux/src/units.ts", "packages/platform-linux/src/units", "packages/platform-linux/src/systemd",
  "packages/native/src/cgroup.ts", "apps/oma/src/entry/host.ts",
  "src/units.ts",
  "src/units/execute.ts",
  "src/units/observe.ts",
  "src/units/render.ts",
  "src/sandbox.ts",
  "src/runtime/sandbox-seccomp.ts",
  "src/runtime/resident-rootfs.ts",
  "src/platform/guest/linux-system.ts",
  "src/platform/guest/systemd-launcher.ts",
  "src/ports/platform-lifecycle.ts",
  "implementation/systemd",
  "platform/guest",
  "src/runtime/pi-adapter.ts",
  "src/runtime/pi-rpc.ts",
  "src/runtime/pi-runtime.ts",
  "src/runtime/pi-spawn-plan.ts",
  "src/runtime/pi-presentation.ts",
  "src/runtime/oma-theme.ts",
  "src/runtime/interactive-channel.ts",
  "src/runtime/interactive-display.ts",
  "src/runtime/extension-modules.ts",
  "src/runtime/engine-auth.ts",
  "src/runtime/host-history-channel.ts",
  "src/runtime/engine/login.ts",
  "src/runtime/engine/personal-ports.ts",
  "src/runtime/engine/ports.ts",
  "src/runtime/engine/presentation.ts",
  "src/runtime/engine/principal-events.ts",
  "src/runtime/engine/principal-launch.ts",
  "src/runtime/engine/principal-session.ts",
  "src/runtime/engine/session-directories.ts",
  "src/pi-compat/commands.ts",
  "src/pi-compat/env.ts",
  "src/pi-compat/interactive-editor.ts",
  "src/pi-compat/interactive-mode.ts",
  "src/pi-compat/interactive-tool-setup.ts",
  "src/pi-compat/interactive-tools.ts",
  "src/pi-compat/interactive-ui.ts",
  "src/pi-compat/pi-private.d.ts",
  "src/pi-compat/prompt-editor.ts",
  "src/pi-compat/session.ts",
  "src/pi-compat/settings-files.ts",
  "src/pi-compat/settings-object.ts",
  "src/pi-compat/settings.ts",
  "src/pi-compat/wire.ts",
  "src/entry/pi-interactive-host.ts",
  "src/broker.ts",
  "src/broker/connection.ts",
  "src/broker/internal-dispatcher.ts",
  "src/broker/listeners.ts",
  "src/broker/logs.ts",
  "src/broker/peer-authenticator.ts",
  "src/broker/peer-pin.ts",
  "src/broker/principal-endpoint.ts",
  "src/broker/process-ancestry.ts",
  "src/broker/public-dispatcher.ts",
  "src/broker/replies.ts",
  "src/broker/ports.ts",
  "src/runtime/run-registry.ts",
  "src/runtime/broker-lifetime.ts",
  "src/runtime/process-lock.ts",
  "src/views/status-refresh.ts",
  "src/broker/transport-spool.ts",
  "src/reconcile.ts", "src/reconcile",
  "src/lifecycle.ts", "src/lifecycle",
  "src/git.ts", "src/git", "src/review.ts", "src/review", "src/views/review-status.ts",
  "src/ports/git-observation.ts", "src/ports/review-authority.ts",
  "src/mail.ts", "src/mail",
  "src/config.ts", "src/config", "src/resident-paths.ts", "src/mail/review-bounds.ts", "src/ids.ts", "src/store.ts", "src/storage", "src/storage/contained-fs.ts", "src/platform/guest/pty.ts", "src/platform/host/peer.ts",
]);
const REMOVED_DECLARATIONS = new Set(["chooseSociety", "renderSocietyChoice", "connectHostProblem", "collectPackageGenerations", "pinPackageGeneration", "PACKAGE_GENERATIONS", "PACKAGE_READER_MARKER", "installedPackageSource", "localPackageSource", "PRODUCT_TEXT_ENV", "productSurface", "surfaceWords", "humanStream", "productText", "detachedConnections", "requireRunnerUnit", "PRINCIPAL_CHANNEL_ENV", "PRINCIPAL_CHANNEL_FD", "WebToolsOptions", "ResourceLimits", "RESOURCE_FIELDS", "resourceLimitsCheck", "canonicalResourceLimits", "parseCanonicalResourceLimits", "LegacyAttestationInput", "legacyReviewRequestNameFor", "TieredAuthority", "TieredAcceptance", "workspaceUsage", "EXCLUDED_USAGE_TREES", "WORKER_LIMIT", "QUARANTINE_RESOURCES", "quarantineResources", "quarantineTmpBytes", "HostConfigV1", "HostEgressConfig", "EgressPolicy", "egressPolicyFor", "societyFromDirectory", "AgentQuota", "assertCreateCapacity", "enforceQuota", "assertSeedCount", "StorageAdmission", "ResourceGate", "ResourceCategory", "resourceCategoryOf", "assertStorageQuotaAdmission", "assertStorageQuotaSupported"]);
export function legacyFindings(root = process.cwd()) {
  const findings = REMOVED_PATHS.filter(path => existsSync(resolve(root, path))).map(path => `${path}: removed compatibility surface reintroduced`);
  for (const file of authoredFiles(root)) {
    const source = ts.createSourceFile(file, readFileSync(resolve(root, file), "utf8"), ts.ScriptTarget.Latest, true);
    const visit = node => {
      if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isVariableDeclaration(node) ||
          ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) ||
          ts.isMethodDeclaration(node) || ts.isImportSpecifier(node) || ts.isBindingElement(node)) && node.name && REMOVED_DECLARATIONS.has(node.name.text))
        findings.push(`${file}: removed declaration ${node.name.text}`);
      if (/^packages\/tool-(?:lsp|hashline|web|mcp)\/src\//.test(file) &&
          ts.isPropertySignature(node) && node.name?.text === "bundleDir")
        findings.push(`${file}: removed vendor location override reintroduced`);
      if (ts.isStringLiteralLike(node) && ["OMA_PRODUCT_TEXT", "INVOCATION_ID"].includes(node.text) ||
          ts.isPropertyAccessExpression(node) && node.name.text === "INVOCATION_ID")
        findings.push(`${file}: retired VM/service-manager environment channel reintroduced`);
      if (file === "apps/oma/src/runtime/inference-relay.ts" &&
          (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) && ["detached", "accept"].includes(node.name?.text))
        findings.push(`${file}: retired relay handoff API reintroduced`);
      ts.forEachChild(node, visit);
    }; visit(source);
  }
  return findings;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const findings = legacyFindings();
  findings.forEach(finding => console.error(finding));
  console.log(`Completed legacy removals: ${findings.length ? "FAIL" : "PASS"}; ${findings.length} findings`);
  process.exitCode = findings.length ? 1 : 0;
}
