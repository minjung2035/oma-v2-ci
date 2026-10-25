// A stand-in for oma-vmhelper speaking its channel protocol on descriptor 3.
// "Guest ports" are local unix sockets named by FAKE_GUEST_PORT_<n>; each
// connection to <socketDir>/port-<n>.sock is relayed to one, as vsock would
// be. The "Keychain" is a JSON file (FAKE_KEYCHAIN); FAKE_KEYCHAIN_LOCKED
// makes it unreadable. SIGUSR1: the guest powers off. SIGUSR2: a wake.
import { Socket, connect, createServer } from "node:net";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const channel = new Socket({ fd: 3, readable: true, writable: true });
const say = message => channel.write(`${JSON.stringify(message)}\n`);
let servers = [];
const stopAll = () => { for (const server of servers) server.close(); servers = []; };
const keychain = () => existsSync(process.env.FAKE_KEYCHAIN) ? JSON.parse(readFileSync(process.env.FAKE_KEYCHAIN, "utf8")) : {};
let pending = "";
channel.setEncoding("utf8");
channel.on("data", chunk => {
  pending += chunk;
  for (let at = pending.indexOf("\n"); at >= 0; at = pending.indexOf("\n")) {
    const request = JSON.parse(pending.slice(0, at)); pending = pending.slice(at + 1);
    const { op, id } = request;
    if (op === "start") {
      for (const port of request.config.ports) {
        const path = join(request.config.socketDir, `port-${port}.sock`);
        if (existsSync(path)) unlinkSync(path);
        const server = createServer(client => {
          const guest = connect(process.env[`FAKE_GUEST_PORT_${port}`]);
          client.pipe(guest); guest.pipe(client);
          client.on("error", () => guest.destroy()); guest.on("error", () => client.destroy());
        });
        server.listen(path);
        servers.push(server);
      }
      say({ id, ok: true });
    } else if (op === "forceStop") {
      stopAll(); say({ id, ok: true }); say({ event: "stopped", cause: "error" });
    } else if (op === "keychain.get") {
      // FAKE_KEYCHAIN_WEDGED: the helper holds the request and answers
      // nothing -- the channel stays open, the request just never ends.
      if (process.env.FAKE_KEYCHAIN_WEDGED) continue;
      if (process.env.FAKE_KEYCHAIN_LOCKED) say({ id, ok: false, error: "the keychain is locked" });
      else { const value = keychain()[request.account]; say(value === undefined ? { id, ok: true } : { id, ok: true, value }); }
    } else if (op === "keychain.put") {
      const items = keychain(); items[request.account] = request.value;
      writeFileSync(process.env.FAKE_KEYCHAIN, JSON.stringify(items)); say({ id, ok: true });
    } else say({ id, ok: false, error: "unknown op" });
  }
});
// The parent's end closed: the VM goes with the helper.
channel.on("close", () => { stopAll(); process.exit(0); });
process.on("SIGUSR1", () => { stopAll(); say({ event: "stopped", cause: "guest" }); });
process.on("SIGUSR2", () => { say({ event: "wake" }); });
