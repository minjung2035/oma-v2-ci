import { isAbsolute } from "node:path";
import { connect, createServer } from "node:net";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { integerEnv } from "./shared.js";

/** UX-08/DR34: the sandbox end of the CONNECT egress proxy.
 *
 * The confined Resident's tools are told HTTP_PROXY/HTTPS_PROXY/ALL_PROXY
 * pointing at a loopback port. They cannot reach the runner's proxy socket
 * (a bind-mounted unix socket) on their own, so this listener forwards their
 * connections to it, bytes unread. Nothing here knows an allowlist or sees a
 * credential: the proxy end on the socket decides what may be dialed, and
 * the TLS that follows is the tool's own end to end with the target.
 *
 * Without `OMA_EGRESS_PROXY_SOCKET`/`OMA_EGRESS_PROXY_PORT` -- the Human
 * configured no egress for this role -- this starts nothing, and the
 * environment carries no proxy variables for tools to find.
 */
export async function startEgressBridge(pi: ExtensionAPI): Promise<void> {
  const socket = process.env.OMA_EGRESS_PROXY_SOCKET;
  const port = integerEnv("OMA_EGRESS_PROXY_PORT");
  if (!socket || port === null || !isAbsolute(socket)) return;
  const server = createServer(client => {
    const upstream = connect(socket);
    const drop = (): void => { client.destroy(); upstream.destroy(); };
    client.on("error", drop);
    upstream.on("error", drop);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  pi.on("session_shutdown", () => { server.close(); });
  await new Promise<void>(resolve => {
    server.on("listening", () => {
      server.unref();
      resolve();
    });
    // The proxy variables still name the planned port; a bind failure means
    // the port is another owner's and they will refuse, which is honest --
    // starting nothing would only look like "no egress configured".
    server.on("error", error => {
      process.stderr.write(`oma egress bridge unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
      resolve();
    });
    server.listen(port, "127.0.0.1");
  });
}
