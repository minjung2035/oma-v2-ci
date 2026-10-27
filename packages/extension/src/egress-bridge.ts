import { isAbsolute } from "node:path";
import { connect, createServer, type Socket } from "node:net";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { integerEnv } from "@oma/tool-runtime/shared";

/** The delivery's loopback HTTP/CONNECT bridge. The kernel chooses a unique
 * port on the shared network, published before adapters capture proxy settings.
 * The bridge forwards bytes without reading credentials and owns both socket
 * halves until close/shutdown. */
export async function startEgressBridge(pi: ExtensionAPI): Promise<void> {
  const socket = process.env.OMA_EGRESS_PROXY_SOCKET;
  const port = integerEnv("OMA_EGRESS_PROXY_PORT");
  if (!socket || port === null || !isAbsolute(socket)) return;
  const clients = new Set<Socket>();
  const server = createServer(client => {
    clients.add(client);
    const upstream = connect(socket);
    const drop = (): void => { client.destroy(); upstream.destroy(); };
    client.once("close", () => { clients.delete(client); upstream.destroy(); });
    upstream.once("close", () => client.destroy());
    client.on("error", drop);
    upstream.on("error", drop);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  pi.on("session_shutdown", () => { for (const client of clients) client.destroy(); server.close(); });
  await new Promise<void>((resolve, reject) => {
    server.on("listening", () => {
      const address = server.address();
      if (address === null || typeof address === "string") { reject(new Error("egress bridge has no TCP port")); return; }
      process.env.OMA_EGRESS_PROXY_PORT = String(address.port);
      const proxy = `http://127.0.0.1:${address.port}`;
      for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"])
        process.env[key] = proxy;
      server.unref();
      resolve();
    });
    // The proxy variables still name the planned port; a bind failure means
    // the port is another owner's and they will refuse, which is honest --
    // starting nothing would only look like "no egress configured".
    server.on("error", error => {
      // The bridge's own journal is best-effort inside this emit: a dead
      // or failing stderr (a closed descriptor, EPIPE) would let the
      // write's throw escape the error event -- the same process death
      // this listener exists to absorb.
      try { process.stderr.write(`oma egress bridge unavailable: ${error instanceof Error ? error.message : String(error)}\n`); }
      catch { /* nowhere left to say it */ }
      reject(error);
    });
    server.listen(0, "127.0.0.1");
  });
}
