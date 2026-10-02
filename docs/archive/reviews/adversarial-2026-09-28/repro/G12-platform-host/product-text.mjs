// Repro for src/platform/product-text.ts productText(): the host must reject
// strings that leak guest paths, unit names, errno, machinery words, control
// chars, or over-length (MAC-231, MAC-022). Also probe for bypasses.
import { productText } from "../../../../dist/src/platform/product-text.js";
let pass = 0, fail = 0;
const rejects = (s) => { const r = !productText(s); if (r) pass++; else fail++; console.log(r ? "REJECT" : "LEAK!!", JSON.stringify(s.slice(0, 40))); };
const accepts = (s) => { const a = productText(s); if (a) pass++; else fail++; console.log(a ? "ACCEPT" : "reject?", JSON.stringify(s.slice(0, 40))); };

rejects("failed at /var/lib/oma/state");
rejects("see /etc/passwd");
rejects("systemd unit failed");
rejects("journalctl shows errors");
rejects("the ext4 volume is full");
rejects("oma-broker.service crashed");
rejects("error ENOSPC writing");
rejects("bwrap could not start");
rejects("cgroup limit hit");
rejects("vsock disconnected");
rejects("bad\u0000null");
rejects("bell\u0007char");
rejects("x".repeat(1025));
// Bypass probes: path not at a known top-level dir, obscure phrasing.
accepts("the engine could not start");
accepts("please try again later");
// A path under /Users (mac) is not in LINUX_PATH list -> accepted (host side).
accepts("saved to /Users/me/thing");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
