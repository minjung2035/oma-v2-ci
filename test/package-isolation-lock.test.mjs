import test from "node:test";
import assert from "node:assert/strict";
import { isolatedLock } from "../scripts/package-isolation-lock.mjs";

const fixture = () => ({
  manifest: { name: "isolated", dependencies: { "@oma/tool": "file:/packed/tool.tgz" } },
  closure: new Set(["@oma/tool"]),
  archives: new Map([["@oma/tool", { path: "/packed/tool.tgz", integrity: "sha512-packed" }]]),
  byName: new Map([["@oma/tool", { manifest: { version: "0.1.0", dependencies: { engine: "1.0.1" } } }]]),
  productLock: { packages: {
    "node_modules/engine": { version: "1.0.1", integrity: "sha512-engine", dependencies: { codec: "^1" } },
    "node_modules/engine/node_modules/codec": { version: "1.0.3", integrity: "sha512-nested" },
    "node_modules/codec": { version: "2.0.0", integrity: "sha512-unrelated" },
    "node_modules/unrelated": { version: "3.0.0" },
  } },
});
test("isolation retains the locked nested dependency and excludes unrelated root packages", () => {
  const result = isolatedLock(fixture());
  assert.deepEqual(Object.keys(result.packages).sort(), ["", "node_modules/@oma/tool", "node_modules/engine", "node_modules/engine/node_modules/codec"]);
  assert.equal(result.packages["node_modules/engine/node_modules/codec"].version, "1.0.3");
  assert.equal(result.packages["node_modules/engine/node_modules/codec"].integrity, "sha512-nested");
});
test("a missing mandatory dependency is refused even below an optional dependency", () => {
  const input = fixture();
  input.productLock.packages["node_modules/engine"].optionalDependencies = { optional: "1" };
  input.productLock.packages["node_modules/optional"] = { version: "1", dependencies: { missing: "1" } };
  assert.throws(() => isolatedLock(input), /missing.*absent from the product lock/);
});
test("an absent optional peer adds no root dependency", () => {
  const input = fixture();
  Object.assign(input.productLock.packages["node_modules/engine"], {
    peerDependencies: { absent: "1" }, peerDependenciesMeta: { absent: { optional: true } },
  });
  assert.equal(Object.hasOwn(isolatedLock(input).packages, "node_modules/absent"), false);
});
