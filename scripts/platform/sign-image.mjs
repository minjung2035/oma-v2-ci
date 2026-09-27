#!/usr/bin/env node
// Release tooling, not runtime: signs a guest image's manifest (MAC-601).
// usage: sign-image.mjs <image dir> <Ed25519 private key PEM>
// Writes <image dir>/manifest.json.sig: base64 of the Ed25519 signature over
// manifest.json's exact bytes. The app carries the public half.
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [dir, keyPath] = process.argv.slice(2);
if (!dir || !keyPath) { console.error("usage: sign-image.mjs <image dir> <private key PEM>"); process.exit(2); }
const key = createPrivateKey(readFileSync(keyPath));
if (key.asymmetricKeyType !== "ed25519") { console.error("the release key must be Ed25519"); process.exit(2); }
const signature = sign(null, readFileSync(join(dir, "manifest.json")), key);
writeFileSync(join(dir, "manifest.json.sig"), `${signature.toString("base64")}\n`);
