// A stand-in for the product's TUI on a terminal: it sets the modes the real
// one sets, draws only when something changed (a start, a resize, Ctrl-L),
// echoes what it is sent, and restores the modes when it quits on "q".
import { spawn } from "node:child_process";
import { requestHostNewSession } from "#oma-test/app/runtime/session-handoff";
process.stdin.setRawMode(true);
let frame = 0, requestedNew = false, exitCode = 0;
const out = text => process.stdout.write(text);
out("\u001b[?1049h\u001b[?25l\u001b[?2004h");
const draw = () => { frame += 1; out(`\u001b[H\u001b[2Jframe ${frame} ${process.stdout.columns}x${process.stdout.rows} pid ${process.pid}`); };
draw();
process.stdout.on("resize", draw);
process.stdin.on("data", data => {
  for (const byte of data) {
    if (byte === 0x0c) draw();
    else if (byte === 0x71) { out("\u001b[?2004l\u001b[?25h\u001b[?1049l"); process.exit(exitCode); }
    // N queues the private request but stays alive; only q ends this writer.
    else if (byte === 0x4e && !requestedNew) { requestedNew = true; requestHostNewSession(); out("host-new-requested"); }
    else if (byte === 0x50 && !requestedNew) { requestedNew = true; requestHostNewSession("personal"); out("host-personal-requested"); }
    else if (byte === 0x46) exitCode = 7;
    // "Q": a last burst larger than the terminal's buffer, then the end.
    else if (byte === 0x51) { out(`${"x".repeat(512 * 1024)}END\u001b[?1049l`); process.exit(0); }
    // "D": the end comes first, and a descendant still holding the terminal
    // writes after it -- output the holder must not cut off at the exit.
    else if (byte === 0x44) {
      // A late-writing descendant in its own session (detached): it is never
      // in the terminal's foreground group, so this program's exit cannot HUP
      // it, and it holds the terminal slave open while it writes late -- what
      // the drained end must not cut off. Direct argv: the lane forbids a
      // shell, and a `trap '' HUP` installed before exec is exactly what the
      // detached session expresses.
      spawn(process.execPath,
        ["-e", "setTimeout(() => process.stdout.write('LATE'), 300)"],
        { stdio: "inherit", detached: true });
      process.exit(0);
    }
    else out(`typed:${String.fromCharCode(byte)}`);
  }
});
process.on("SIGTERM", () => { out("bye"); process.exit(7); });
