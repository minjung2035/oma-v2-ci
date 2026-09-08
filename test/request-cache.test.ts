import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { RequestCache } from "../src/request-cache.js";

test("RequestCache atomically round-trips frozen JSON and body bytes", () => {
  const home = mkdtempSync(join(tmpdir(), "oma-cache-"));
  const cache = new RequestCache(home);
  const key = "cache-1";
  cache.write({
    key,
    method: "mail.send",
    params: { to: ["b"], subject: "s", kind: "message", body: "exact" },
    digest: { bytes: 3, sha256: "a".repeat(64) },
    createdAtMs: 1,
    lastReceipt: null,
  });
  cache.persistBody(key, Buffer.from([0, 1, 255]));
  assert.deepEqual(cache.read(key)?.params, {
    to: ["b"],
    subject: "s",
    kind: "message",
    body: "exact",
  });
  assert.deepEqual([...cache.readBody(key)!], [0, 1, 255]);
  assert.equal(
    statSync(join(home, ".local/state/oma/requests/cache-1.json")).mode & 0o777,
    0o600,
  );
  assert.equal(
    statSync(join(home, ".local/state/oma/requests/cache-1.body")).mode & 0o777,
    0o600,
  );
  assert.deepEqual(
    readdirSync(join(home, ".local/state/oma/requests")).sort(),
    ["cache-1.body", "cache-1.json"],
  );
});

test("RequestCache rejects malformed or extended cache JSON", () => {
  const home = mkdtempSync(join(tmpdir(), "oma-cache-"));
  const cache = new RequestCache(home);
  const dir = join(home, ".local/state/oma/requests");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "bad.json");
  writeFileSync(
    path,
    JSON.stringify({
      key: "bad",
      method: "mail.send",
      params: {},
      createdAtMs: 1,
      lastReceipt: null,
      extra: true,
    }),
  );
  assert.equal(cache.read("bad"), null);
  writeFileSync(
    path,
    JSON.stringify({
      key: "bad",
      method: "mail.send",
      params: {},
      createdAtMs: 1,
      lastReceipt: null,
      digest: { bytes: -1, sha256: "x" },
    }),
  );
  assert.equal(cache.read("bad"), null);
  assert.equal(cache.read("../bad"), null);
  assert.throws(
    () => cache.persistBody("../bad", Buffer.from("x")),
    /invalid request key/,
  );
  assert.equal(readFileSync(path, "utf8").includes("extra"), false);
});
