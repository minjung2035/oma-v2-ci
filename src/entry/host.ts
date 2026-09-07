// MUST [PR-002]/[REC-002]/[UNIT-TPL-003]: host entrypoint — calls the existing
// broker's host channel and exits; it is not another daemon and never starts a
// model.
import { join } from "node:path";
import { connect } from "node:net";
import { FrameParser, encodeFrame } from "../frame.js";

function usage(): never {
  console.error("usage: host.js <principal-relay|reconcile> --society <name>");
  process.exit(4);
}

const args = process.argv.slice(2);
const mode = args[0];
const societyIdx = args.indexOf("--society");
if ((mode !== "principal-relay" && mode !== "reconcile") || societyIdx < 0 || args[societyIdx + 1] === undefined) usage();
const society = args[societyIdx + 1]!;
const runRoot = join(process.env.XDG_RUNTIME_DIR ?? "/tmp", "oma", society);

const parser = new FrameParser(256 * 1024);
let buf = Buffer.alloc(0);
let settled = false;

const sock = connect(join(runRoot, "admin.sock"), () => {
  sock.write(encodeFrame({ v: 1, id: "host-1", method: mode === "principal-relay" ? "host.principalRelay" : "host.reconcile", params: {} }));
});
sock.on("data", (d) => {
  buf = Buffer.concat([buf, Buffer.from(d)]);
  try {
    for (const f of parser.feed(buf)) {
      buf = buf.subarray(0, 0);
      const raw = f.raw as { ok?: boolean; result?: { moved?: number; pending?: number; examined?: number; repaired?: number; remaining?: number }; error?: { code?: string; message?: string } };
      if (raw.ok === true) {
        console.log(JSON.stringify(raw.result ?? {}));
      } else {
        console.error(`host ${mode} failed: ${raw.error?.code ?? "ERROR"} ${raw.error?.message ?? ""}`);
        process.exitCode = 2;
      }
      finish();
    }
  } catch {
    /* incomplete frame */
  }
});
sock.on("error", (e) => {
  console.error(`host ${mode}: broker unreachable: ${e.message}`);
  process.exitCode = 3;
  finish();
});

function finish(): void {
  if (settled) return;
  settled = true;
  sock.destroy();
  process.exit();
}
setTimeout(finish, 30000); // oneshot bound; never spin