#!/usr/bin/env node
// Release tooling, not runtime: signs a guest image's manifest (MAC-601).
// usage: sign-image.mjs <image dir> <Ed25519 private key PEM>
// Writes <image dir>/manifest.json.sig: base64 of the Ed25519 signature over
// manifest.json's exact bytes. The app carries the public half.
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [dir, keyPath] = process.argv.slice(2);
if (!dir || !keyPath) { console.error("usage: sign-image.mjs <image dir> <private key PEM>"); process.exit(2); }
const key = createPrivateKey(readFileSync(keyPath));
if (key.asymmetricKeyType !== "ed25519") { console.error("the release key must be Ed25519"); process.exit(2); }
const signature = sign(null, readFileSync(join(dir, "manifest.json")), key);
const target = join(dir, "manifest.json.sig");
const temporary = join(dir, `.manifest.json.sig-${randomUUID()}`);
let fd;
let staged = false;
try {
  fd = openSync(temporary, "wx", 0o644);
  staged = true;
  writeFileSync(fd, `${signature.toString("base64")}\n`);
  fsyncSync(fd);
  closeSync(fd);
  fd = undefined;
  renameSync(temporary, target);
  staged = false;
  fd = openSync(dir, "r");
  fsyncSync(fd);
} finally {
  try { if (fd !== undefined) closeSync(fd); }
  finally { if (staged) unlinkSync(temporary); }
}
