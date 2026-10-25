/** V31B (WP31): the lockfile installs what package.json declares. A runtime
 * dependency the lockfile files under devDependencies -- or marks dev -- is left
 * out of a production install (`npm ci --omit=dev`), and the engine OMA ships was
 * exactly that: package.json moved it to dependencies, the lockfile never
 * followed. Every declared dependency must sit in the lockfile's root with the
 * same kind, and every production closure entry must not be marked dev.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
interface LockEntry { version?: string; dev?: boolean; link?: boolean; resolved?: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }

test("V31B: every declared dependency is locked as the same kind, and its production closure is not marked dev", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as { packages: Record<string, LockEntry & { devDependencies?: Record<string, string> }> };
  const top = lock.packages[""]!;
  assert.deepEqual(Object.keys(top.dependencies ?? {}).sort(), Object.keys(manifest.dependencies).sort(), "runtime dependencies differ between package.json and the lockfile");
  assert.deepEqual(Object.keys(top.devDependencies ?? {}).sort(), Object.keys(manifest.devDependencies).sort(), "development dependencies differ between package.json and the lockfile");
  // Walk the production closure the way npm places it and require no dev flag.
  const seen = new Set<string>();
  const place = (name: string, from: string): string | null => {
    for (let base = from; ; base = base.slice(0, base.lastIndexOf("/node_modules/"))) {
      const key = `${base === "" ? "" : `${base}/`}node_modules/${name}`;
      if (lock.packages[key]) return key;
      if (base === "" || !base.includes("/node_modules/")) { const top = `node_modules/${name}`; return lock.packages[top] ? top : null; }
    }
  };
  const visit = (key: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    const entry = lock.packages[key]!;
    assert.notEqual(entry.dev, true, `${key} is in the production closure but locked as dev`);
    // A workspace link owns no dependency list; follow its actual locked target.
    if (entry.link) {
      assert.ok(entry.resolved && lock.packages[entry.resolved], `${key} has no locked workspace target`);
      visit(entry.resolved);
      return;
    }
    for (const name of Object.keys(entry.dependencies ?? {})) {
      const placed = place(name, key);
      assert.ok(placed, `${key} depends on ${name}, which the lockfile does not place`);
      visit(placed!);
    }
  };
  for (const name of Object.keys(manifest.dependencies)) visit(`node_modules/${name}`);
  assert.ok(seen.has("node_modules/@earendil-works/pi-coding-agent"));
});
