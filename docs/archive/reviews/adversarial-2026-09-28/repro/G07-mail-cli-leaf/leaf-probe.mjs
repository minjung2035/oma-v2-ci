// Exercise leaf.ts native wrappers with adversarial/edge inputs.
import * as leaf from "../../../../dist/src/leaf.js";

console.log("hasNativeLeaf:", leaf.hasNativeLeaf());
// peerCred on non-socket fd (stdin=0) and invalid fd
console.log("peerCred(0):", JSON.stringify(leaf.peerCred(0)));
console.log("peerCred(-1):", JSON.stringify(leaf.peerCred(-1)));
console.log("peerCred(999999):", JSON.stringify(leaf.peerCred(999999)));
console.log("peerCred(2.5):", JSON.stringify(leaf.peerCred(2.5)));
// peerPidFd on non-socket
console.log("peerPidFd(0):", JSON.stringify(leaf.peerPidFd(0)));
// pidfdLiveness on garbage fd
console.log("pidfdLiveness(-1):", JSON.stringify(leaf.pidfdLiveness(-1)));
console.log("pidfdLiveness(0):", JSON.stringify(leaf.pidfdLiveness(0)));
console.log("pidfdLiveness(999999):", JSON.stringify(leaf.pidfdLiveness(999999)));
// livenessFromPoll classification (pure)
console.log("live result=0:", JSON.stringify(leaf.livenessFromPoll(() => ({ result: 0, errno: 0, revents: 0 }))));
console.log("live POLLNVAL:", JSON.stringify(leaf.livenessFromPoll(() => ({ result: 1, errno: 0, revents: 0x20 }))));
console.log("live POLLIN:", JSON.stringify(leaf.livenessFromPoll(() => ({ result: 1, errno: 0, revents: 0x1 }))));
console.log("live revents=0 result>0:", JSON.stringify(leaf.livenessFromPoll(() => ({ result: 1, errno: 0, revents: 0 }))));
let calls = 0;
console.log("live EINTR-forever:", JSON.stringify(leaf.livenessFromPoll(() => { calls++; return { result: -1, errno: 4, revents: 0 }; })), "calls=", calls);
// flock on stdin (a tty/pipe) - three-answer
console.log("lockFileDescriptor(0):", JSON.stringify(leaf.lockFileDescriptor(0)));
console.log("lockFileDescriptor(-1):", JSON.stringify(leaf.lockFileDescriptor(-1)));
// sdNotifyReady with NUL / oversize / abstract
console.log("sdNotify emptypath:", leaf.sdNotifyReady(""));
console.log("sdNotify NUL-mid:", leaf.sdNotifyReady("/a\0b"));
console.log("sdNotify oversize:", leaf.sdNotifyReady("/" + "a".repeat(200)));
console.log("sdNotify nonexistent:", leaf.sdNotifyReady("/tmp/oma-adv-nonexistent-socket-xyz"));
// abstract name hold + double-open + holder query + read-back
const name = "\0oma-adv-G07-" + process.pid;
const h1 = leaf.holdAbstractName(name);
console.log("hold1:", JSON.stringify(h1));
const h2 = leaf.holdAbstractName(name);
console.log("hold2 (should be taken):", JSON.stringify(h2));
console.log("holder:", JSON.stringify(leaf.abstractNameHolder(name)));
if (h1.kind === "held") {
  console.log("nameHeld(fd):", JSON.stringify(leaf.abstractNameHeld(h1.fd)));
}
console.log("nameHeld(0):", JSON.stringify(leaf.abstractNameHeld(0)));
console.log("holdAbstractName(bad no-NUL):", JSON.stringify(leaf.holdAbstractName("nonul")));
console.log("holdAbstractName(oversize):", JSON.stringify(leaf.holdAbstractName("\0" + "a".repeat(200))));
import { closeSync } from "node:fs";
if (h1.kind === "held") closeSync(h1.fd);
