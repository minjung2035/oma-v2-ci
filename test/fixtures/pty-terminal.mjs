// V28B driver: the production terminal owner and key decoder inside a real pty.
// argv: <dist root> <side file> <mode>. Decoded keys and sizes go to the side
// file; the terminal itself only sees what the product writes.
import { appendFileSync } from "node:fs";
const [root, side, mode] = process.argv.slice(2);
const { openTerminal } = await import("@oma/tui/screen");
const { KeyDecoder } = await import("@oma/tui/keys");
const note = value => appendFileSync(side, `${JSON.stringify(value)}\n`);
const terminal = openTerminal({ input: process.stdin, output: process.stdout });
note({ opened: true, columns: terminal.columns, rows: terminal.rows });
terminal.draw(["V28B ready"]);
const decoder = new KeyDecoder();
terminal.onResize(() => note({ resized: true, columns: terminal.columns, rows: terminal.rows }));
terminal.onKeys(chunk => {
  for (const key of decoder.push(chunk)) {
    note({ key });
    if (key.kind === "char" && key.value === "q") {
      if (mode === "exit-without-restore") process.exit(3);
      if (mode === "reject") { void Promise.reject(new Error("failure after the terminal opened")); return; }
      terminal.restore(); process.exit(0);
    }
  }
});
