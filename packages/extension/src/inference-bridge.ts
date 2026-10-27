import { isAbsolute } from "node:path";
import { connect, createServer } from "node:net";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { integerEnv } from "@oma/tool-runtime/shared";

/** INF-006: the sandbox end of the provider relay.
 *
 * The engine's HTTP provider uses a loopback listener that forwards its
 * bytes, unread, to the bind-mounted Unix relay socket. Host network access
 * remains available under DR37; the relay protects the provider credential. Nothing here parses HTTP or holds a credential: the engine keeps its
 * codec and the host end attaches the real authorization.
 *
 * The engine awaits its extension factory before committing provider changes
 * and resolving models. While binding, the provider names no reachable port;
 * only a successful listener supplies its final address (P0V-120, G10-04).
 * If the planned port was taken, the kernel chooses another loopback port.
 * It is never unregistered: that would restore the engine's own provider,
 * which would go around the relay.
 */
const UNREACHABLE = "http://127.0.0.1:0";
export async function startInferenceBridge(pi: ExtensionAPI): Promise<void> {
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
  // What this load opened ends with it: an interactive engine loads its
  // extensions again for each new session and would otherwise keep listening.
  pi.on("session_shutdown", () => { server.close(); });
  const register = (baseUrl: string): void => { pi.registerProvider(provider, { baseUrl, apiKey: placeholder }); };
  register(UNREACHABLE);
  await new Promise<void>(resolve => {
    let planned = true;
    server.on("listening", () => {
      const address = server.address();
      // 'listening' is the same synchronous emit boundary as 'error' below:
      // a registerProvider refusal escaping it kills the engine. The
      // unreachable provider the pre-listen register already installed is
      // the safe state, so a refused re-register keeps it -- the relay
      // listens unused rather than the engine bypassing it -- and the
      // journal is best-effort for the same reason the error listener's is.
      if (typeof address === "object" && address !== null) {
        try { register(`http://127.0.0.1:${address.port}`); }
        catch (registerError) {
          try { process.stderr.write(`oma inference bridge provider registration refused: ${registerError instanceof Error ? registerError.message : String(registerError)}\n`); }
          catch { /* nowhere left to say it */ }
        }
      }
      server.unref();
      resolve();
    });
    // Keep the override even if neither bind succeeds; unregistering or throwing
    // from the factory would restore the provider that bypasses the relay.
    server.on("error", error => {
      // Nothing in this listener may throw: 'error' is emitted
      // synchronously, and a throw here escapes the emit as the engine's
      // death -- the same death the listener exists to absorb. The journal
      // is best-effort (a dead or failing stderr, EPIPE included), the
      // re-register is idempotent (the unreachable name was already
      // registered before the first bind, so a refusal means the safe
      // state already holds), and a retry listen that throws leaves the
      // unreachable override standing.
      try { process.stderr.write(`oma inference bridge unavailable: ${error instanceof Error ? error.message : String(error)}\n`); }
      catch { /* nowhere left to say it */ }
      try { register(UNREACHABLE); } catch { /* already the provider the first bind left behind */ }
      try { if (planned) { planned = false; server.listen(0, "127.0.0.1"); } else resolve(); }
      catch { resolve(); }
    });
    server.listen(port, "127.0.0.1");
  });
}
