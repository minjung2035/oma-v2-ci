/** A society session holder (macos-platform §4.6): runs one program on a
 * pseudo-terminal and serves attaches on a unix socket until the program
 * ends. guesthost starts one per open society, each in its own user unit, so
 * a restart of guesthost leaves the societies running.
 *
 * usage: guest-session.js --socket <path> --cwd <dir> -- <executable> [args...]
 */
import { createServer } from "node:net";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { peerCred, socketDescriptor } from "../leaf.js";
import { TerminalSession } from "../platform/guest/session.js";

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

let session: TerminalSession;
try { session = TerminalSession.start({ executable: executable!, argv: args, cwd, env }, { columns: 80, rows: 24, backlogBytes: 4 * 1024 * 1024 }); }
catch (error) { fail(error instanceof Error ? error.message : String(error)); }

if (existsSync(socketPath)) unlinkSync(socketPath);
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

process.on("SIGTERM", () => { session.terminate(); });
process.on("SIGHUP", () => { /* no terminal of its own to lose */ });
session.onEnd(end => {
  server.close();
  try { unlinkSync(socketPath); } catch { /* already gone */ }
  process.exitCode = end.code ?? (end.signal === null ? 1 : 128);
  setTimeout(() => process.exit(), 200).unref();
});
