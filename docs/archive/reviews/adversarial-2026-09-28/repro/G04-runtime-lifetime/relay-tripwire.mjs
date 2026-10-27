// Does the relay actually cut a response that echoes the secret, including when
// the secret is split across two TCP chunks?
import { InferenceRelay } from "../../../../dist/src/runtime/inference-relay.js";
import { createServer as httpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import * as fs from "node:fs";

const dir = mkdtempSync(join(tmpdir(), "oma-adv-G04-tw-"));
const key = join(dir, "k.pem"), crt = join(dir, "c.pem");
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${key} -out ${crt} -days 1 -subj /CN=localhost 2>/dev/null`);
const SECRET = "sk-verysecretkey-000111222333";
const PLACEHOLDER = "sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

const upstream = httpsServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, (req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  // Split the secret across two writes.
  const half = Math.floor(SECRET.length / 2);
  res.write("prefix-" + SECRET.slice(0, half));
  setTimeout(() => { res.write(SECRET.slice(half) + "-suffix"); res.end(); }, 30);
});
await new Promise(r => upstream.listen(0, "127.0.0.1", r));
const port = upstream.address().port;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const sock = join(dir, "relay.sock");
const relay = await InferenceRelay.open(sock,
  { origin: `https://127.0.0.1:${port}/`, headers: {}, substitute: { placeholder: PLACEHOLDER, secret: SECRET } },
  { concurrent: 4, timeoutMs: 5000 });

const got = await new Promise((resolve) => {
  const req = httpRequest({ socketPath: sock, path: "/x", method: "POST" }, res => {
    let body = ""; res.on("data", c => body += c);
    res.on("end", () => resolve({ status: res.statusCode, body, contains: body.includes(SECRET) }));
    res.on("error", () => resolve({ aborted: true, body }));
  });
  req.on("error", e => resolve({ error: String(e) }));
  req.end("x");
});
console.log("split-secret response:", JSON.stringify(got));
console.log("SECRET LEAKED?", got.contains === true);
await relay.close();
upstream.close();
rmSync(dir, { recursive: true, force: true });
