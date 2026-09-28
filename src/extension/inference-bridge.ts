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
 *
 * P0V-120 (G10-04): the provider names only a port this bridge holds. A
 * port that could not be listened on is held by someone else -- the
 * Principal's is chosen free on the host and can be taken before this listens
 * -- and whoever holds it must not receive the engine's requests. So the
 * provider is pointed at no one, then at a port the kernel gives this bridge.
 * It is never unregistered: that would restore the engine's own provider,
 * which would go around the relay.
 */
const UNREACHABLE = "http://127.0.0.1:0";
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
  // The key is a placeholder shaped like the real one; the host relay swaps it
  // back on the way out, so nothing inside ever holds the credential.
  const register = (baseUrl: string): void => { pi.registerProvider(provider, { baseUrl, apiKey: placeholder }); };
  let planned = true;
  server.on("listening", () => {
    const address = server.address();
    if (!planned && typeof address === "object" && address !== null) register(`http://127.0.0.1:${address.port}`);
  });
  // A bridge that cannot listen must not look like a working one. stderr is the
  // runner's operational channel; the RPC stream is stdout and must stay clean.
  server.on("error", error => {
    process.stderr.write(`oma inference bridge unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
    register(UNREACHABLE);
    if (planned) { planned = false; server.listen(0, "127.0.0.1"); }
  });
  server.unref();
  server.listen(port, "127.0.0.1");
  register(`http://127.0.0.1:${port}`);
}
