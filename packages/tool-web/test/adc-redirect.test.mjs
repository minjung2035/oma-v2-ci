import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("001. ADC token exchanges never forward refresh secrets or signed assertions to redirect targets", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-adc-redirect-"));
  const originalFetch = globalThis.fetch;
  const saved = new Map(["PI_CODING_AGENT_DIR", "GOOGLE_APPLICATION_CREDENTIALS"].map(name => [name, process.env[name]]));
  process.env.PI_CODING_AGENT_DIR = root;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = join(root, "adc.json");
  let status = 307;
  let targetRequests = 0;
  let sourceRequests = 0;
  const target = createServer((request, response) => {
    targetRequests++;
    request.resume();
    response.end(JSON.stringify({ access_token: "redirected-token", expires_in: 3600 }));
  });
  const source = createServer((request, response) => {
    sourceRequests++;
    request.resume();
    response.writeHead(status, { location: `http://127.0.0.1:${target.address().port}/token` }).end();
  });
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of saved)
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    await Promise.all([source, target].map(server => new Promise(resolve => {
      server.closeAllConnections(); server.close(resolve);
    })));
    rmSync(root, { recursive: true, force: true });
  });
  await Promise.all([source, target].map(server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve))));
  globalThis.fetch = (input, init) => originalFetch(new URL(input).hostname === "oauth2.googleapis.com"
    ? `http://127.0.0.1:${source.address().port}/token` : input, init);
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const { getAdcAccessToken, clearAdcTokenCache } = await import("../dist/vendor/pi-web-access/runtime/gemini-adc.js");
  for (const type of ["authorized_user", "service_account"]) {
    for (const redirectStatus of [307, 308]) await t.test(`${type}: HTTP ${redirectStatus}`, async () => {
      status = redirectStatus; targetRequests = 0; sourceRequests = 0;
      writeFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, JSON.stringify(type === "authorized_user"
        ? { type, client_id: "test-client", client_secret: "test-secret", refresh_token: "test-refresh" }
        : { type, client_email: "test@example.com", private_key: privateKey, token_uri: `http://127.0.0.1:${source.address().port}/token` }));
      clearAdcTokenCache();
      await assert.rejects(getAdcAccessToken(), /fetch|redirect/i);
      assert.equal(sourceRequests, 1);
      assert.equal(targetRequests, 0, "the credential-bearing POST reached the redirect target");
    });
  }
});
