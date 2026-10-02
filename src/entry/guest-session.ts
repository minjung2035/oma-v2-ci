/** A society session holder (macos-platform §4.6): runs one program on a
 * pseudo-terminal and serves attaches on a unix socket until the program
 * ends. guesthost starts one per open society, each in its own user unit, so
 * a restart of guesthost leaves the societies running.
 *
 * usage: guest-session.js --socket <path> --cwd <dir> -- <executable> [args...]
 */
import { createServer } from "node:net";
import { chmodSync } from "node:fs";
import { clearSocketName } from "../storage/socket-name.js";
import { peerCred, socketDescriptor } from "../leaf.js";
import { TerminalSession } from "../platform/guest/session.js";
import { HOST_LOSS_SIGNALS } from "../runtime/broker-lifetime.js";
import { PRODUCT_TEXT_ENV } from "../tui/words.js";
import { HOST_SESSION_HANDOFF_ENV, HOST_SESSION_HANDOFF_FD } from "../runtime/session-handoff.js";

function fail(message: string): never {
  process.stderr.write(`guest-session: ${message}\n`);
  process.exit(2);
}
const argv = process.argv.slice(2);
const split = argv.indexOf("--");
if (split < 0 || split === argv.length - 1) fail("usage: --socket <path> --cwd <dir> -- <executable> [args...]");
const flag = (name: string): string => {
  const at = argv.indexOf(name);
  if (at < 0 || at > split || argv[at + 1] === undefined) fail(`${name} is required`);
  return argv[at + 1]!;
};
const socketPath = flag("--socket");
const cwd = flag("--cwd");
const [executable, ...args] = argv.slice(split + 1);
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
env.TERM ??= "xterm-256color";
// DR18 (D-1): the program's screen is shown on a Mac; it speaks product text.
env[PRODUCT_TEXT_ENV] = "1";
env[HOST_SESSION_HANDOFF_ENV] = String(HOST_SESSION_HANDOFF_FD);

let session: TerminalSession;
try { session = TerminalSession.start({ executable: executable!, argv: args, cwd, env }, { columns: 80, rows: 24, backlogBytes: 4 * 1024 * 1024 }); }
catch (error) { fail(error instanceof Error ? error.message : String(error)); }

clearSocketName(socketPath);
const uid = process.getuid!();
const server = createServer({ allowHalfOpen: false }, socket => {
  // guesthost runs as this user; within one uid the socket's mode is no
  // boundary (FS-005), and nothing more is claimed for it.
  const fd = socketDescriptor(socket);
  if (fd === null || peerCred(fd)?.uid !== uid) { socket.destroy(); return; }
  session.accept(socket);
});
server.listen(socketPath, () => { chmodSync(socketPath, 0o600); });
server.on("error", error => { session.terminate(); fail(error.message); });

// AV31, P0V-81: asked to end in any way, the holder asks its program to end
// and ends with it. A holder killed outright would hang its program up with no
// exit reported to the screen.
for (const signal of HOST_LOSS_SIGNALS) process.on(signal, () => { session.terminate(); });
session.onEnd(end => {
  // The server's own close removes its name (P0V-114).
  server.close();
  process.exitCode = end.code ?? (end.signal === null ? 1 : 128);
  setTimeout(() => process.exit(), 200).unref();
});
