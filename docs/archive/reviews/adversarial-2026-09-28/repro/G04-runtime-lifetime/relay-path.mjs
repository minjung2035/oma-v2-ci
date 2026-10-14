// Exercises InferenceRelay against a fake upstream to see what paths/headers
// actually reach the "provider" and whether the secret can be smuggled or the
// declared endpoint escaped. dist import; no network beyond loopback.
import { InferenceRelay } from "../../../../dist/src/runtime/inference-relay.js";
import { createServer as httpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { generateKeyPairSync, createSign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "oma-adv-G04-relay-"));
// Self-signed cert for a loopback https "provider".
const key = join(dir, "k.pem"), crt = join(dir, "c.pem");
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${key} -out ${crt} -days 1 -subj /CN=localhost 2>/dev/null`);
const fs = await import("node:fs");

const seen = [];
const upstream = httpsServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, (req, res) => {
  seen.push({ url: req.url, auth: req.headers["authorization"], xapi: req.headers["x-api-key"] });
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
});
await new Promise(r => upstream.listen(0, "127.0.0.1", r));
const port = upstream.address().port;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const SECRET = "sk-verysecretkey-000111222333";
const PLACEHOLDER = "sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const sock = join(dir, "relay.sock");
const relay = await InferenceRelay.open(sock,
  { origin: `https://127.0.0.1:${port}/v1`, headers: {}, substitute: { placeholder: PLACEHOLDER, secret: SECRET } },
  { concurrent: 4, timeoutMs: 5000 });

function call(path, headers) {
  return new Promise((resolve) => {
    const req = httpRequest({ socketPath: sock, path, method: "POST", headers }, res => {
      let body = ""; res.on("data", c => body += c); res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", e => resolve({ error: String(e) }));
    req.end("x");
  });
}

// 1. Placeholder in Authorization slot -> secret should reach upstream.
console.log("auth-slot:", await call("/v1/chat", { authorization: `Bearer ${PLACEHOLDER}` }));
// 2. dot-segment escape attempts
console.log("dotdot:", await call("/v1/../admin", {}));
console.log("enc-dotdot:", await call("/v1/%2e%2e/admin", {}));
console.log("outside:", await call("/other", {}));
console.log("key-query:", await call(`/v1/x?key=${PLACEHOLDER}`, {}));
console.log("key-other-query:", await call(`/v1/x?foo=${PLACEHOLDER}`, {}));
// 3. placeholder in a non-credential header
console.log("smuggle-header:", await call("/v1/x", { "x-custom": PLACEHOLDER }));

await new Promise(r => setTimeout(r, 100));
console.log("UPSTREAM SAW:", JSON.stringify(seen, null, 0));
await relay.close();
upstream.close();
rmSync(dir, { recursive: true, force: true });
