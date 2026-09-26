// Test-only stand-in for a provider: a real HTTPS server with a throwaway
// self-signed certificate. It records what a provider would have received so a
// test can check what crossed the relay, including a WebSocket upgrade.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SeenRequest {
  readonly method: string | undefined;
  readonly path: string | undefined;
  readonly headers: IncomingHttpHeaders;
  body: string;
  readonly upgrade: boolean;
  /** The provider's side of this request was closed before it had finished
   * answering (a request), or at all (a tunnel): someone upstream cut it. */
  cut?: boolean;
}

export interface TlsProvider {
  readonly origin: string;
  readonly seen: SeenRequest[];
  /** `gapMs` spaces the chunks out, so a reader can tell streaming from buffering. */
  reply: { status: number; chunks: string[]; delayMs: number; gapMs?: number; headers?: Record<string, string> };
  close(): Promise<void>;
}

export async function tlsProvider(): Promise<TlsProvider> {
  const dir = mkdtempSync(join(tmpdir(), "oma-tls-provider-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  execFileSync("openssl", ["req", "-new", "-x509", "-key", keyPath, "-out", certPath, "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
  const seen: SeenRequest[] = [];
  const state: { reply: TlsProvider["reply"] } = { reply: { status: 200, chunks: ["a", "b"], delayMs: 0 } };
  const server = createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (request, response) => {
    const record: SeenRequest = { method: request.method, path: request.url, headers: request.headers, body: "", upgrade: false };
    seen.push(record);
    request.setEncoding("utf8");
    request.on("data", chunk => { record.body += chunk; });
    response.once("close", () => { if (!response.writableFinished) record.cut = true; });
    request.on("end", () => {
      const send = (): void => {
        const body = state.reply.chunks.join("");
        response.writeHead(state.reply.status, { "content-type": "text/event-stream", "content-length": Buffer.byteLength(body), ...state.reply.headers });
        const gap = state.reply.gapMs ?? 0;
        const pieces = [...state.reply.chunks];
        const next = (): void => {
          const piece = pieces.shift();
          if (piece === undefined) { response.end(); return; }
          response.write(piece);
          if (gap > 0) setTimeout(next, gap).unref(); else next();
        };
        next();
      };
      if (state.reply.delayMs > 0) setTimeout(send, state.reply.delayMs).unref();
      else send();
    });
  });
  // An upgrade is answered with 101 and then echoes whatever arrives, so a
  // test can see bytes travel both ways through the tunnel.
  server.on("upgrade", (request, socket) => {
    const record: SeenRequest = { method: request.method, path: request.url, headers: request.headers, body: "", upgrade: true };
    seen.push(record);
    socket.once("close", () => { record.cut = true; });
    socket.write("HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n");
    socket.on("data", chunk => { socket.write(Buffer.concat([Buffer.from("echo:"), chunk])); });
    socket.on("error", () => {});
  });
  await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", () => { resolve(); }); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    origin: `https://localhost:${port}`,
    seen,
    get reply() { return state.reply; },
    set reply(value) { state.reply = value; },
    close: () => new Promise<void>(resolve => {
      server.closeAllConnections();
      server.close(() => { rmSync(dir, { recursive: true, force: true }); resolve(); });
    }),
  };
}
