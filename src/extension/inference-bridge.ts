import { isAbsolute } from "node:path";
import { connect, createServer } from "node:net";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { integerEnv } from "./shared.js";

/** INF-006: the sandbox end of the provider relay.
 *
 * The confined engine has no network, so it cannot reach the host's relay
 * socket on its own. This opens a loopback listener inside the sandbox's own
 * network namespace and forwards those bytes, unread, to the bind-mounted
 * socket. Nothing here parses HTTP or holds a credential: the engine keeps its
 * codec and the host end attaches the real authorization.
 *
 * The provider is redirected at load, not after the listener is ready, because
 * the engine resolves models during startup and the first request cannot arrive
 * before a turn begins. Registering only `baseUrl` preserves the provider's
 * existing models and streaming behaviour.
 */
export function startInferenceBridge(pi: ExtensionAPI): void {
  const socket = process.env.OMA_INFERENCE_SOCKET;
  const provider = process.env.OMA_INFERENCE_PROVIDER;
  const placeholder = process.env.OMA_INFERENCE_KEY;
  const port = integerEnv("OMA_INFERENCE_PORT");
  if (!socket || !provider || !placeholder || port === null || !isAbsolute(socket)) return;
  const server = createServer(client => {
    const upstream = connect(socket);
    const drop = (): void => { client.destroy(); upstream.destroy(); };
    client.on("error", drop);
    upstream.on("error", drop);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  // A bridge that cannot listen must not look like a working one. stderr is the
  // runner's operational channel; the RPC stream is stdout and must stay clean.
  server.on("error", error => {
    process.stderr.write(`oma inference bridge unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
  });
  server.unref();
  server.listen(port, "127.0.0.1");
  // The key is a placeholder shaped like the real one; the host relay swaps it
  // back on the way out, so nothing inside ever holds the credential.
  pi.registerProvider(provider, { baseUrl: `http://127.0.0.1:${port}`, apiKey: placeholder });
}
