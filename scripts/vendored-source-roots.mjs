/** Byte-pinned bundled-extension snapshots are upstream data, not authored
 * code or project documentation. Keep discovery usable before npm ci. */
export const VENDORED_EXTENSION_DIRS = Object.freeze(
  ["tool-lsp", "tool-hashline", "tool-web", "tool-mcp"].map(name => `packages/${name}/src/vendor`),
);
