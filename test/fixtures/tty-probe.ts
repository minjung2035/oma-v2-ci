// Runs under a real pseudo-terminal and reports what the terminal owner did.
// Never imported by production; it exists so the raw-mode branch is exercised
// by an actual TTY rather than by a stubbed stream.
import { KeyDecoder } from "@oma/tui/keys";
import { openTerminal } from "@oma/tui/screen";

const input = process.stdin;
const output = process.stdout;
const isTTY = input.isTTY === true;

let rawEnabled = false;
let rawRestored = false;
const setRawMode = input.setRawMode?.bind(input);
if (setRawMode) {
  input.setRawMode = ((value: boolean) => {
    if (value) rawEnabled = true;
    else if (rawEnabled) rawRestored = true;
    return setRawMode(value);
  }) as typeof input.setRawMode;
}

// What the owner writes to the real terminal, so the modes it claims to take
// are observed at the device rather than inferred from the source.
const sent: string[] = [];
const write = output.write.bind(output);
output.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
  sent.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
  return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
}) as typeof output.write;

const terminal = openTerminal({ input, output });
const columns = terminal.columns;
const rows = terminal.rows;
const pasteOn = sent.join("").includes(`${String.fromCharCode(27)}[?2004h`);

// Feed the bytes a terminal would deliver for Ctrl+X, Right, a paste and
// Escape, and confirm they reach the panel's vocabulary through the same
// decoder the app uses. Two reads, because that is what a terminal does: what
// follows a paste's end marker inside one read is that paste's content, so a
// key pressed after the paste is a key only when it arrives as one.
const ESC = String.fromCharCode(27);
const decoder = new KeyDecoder();
const decoded = [
  ...decoder.push(Buffer.from(String.fromCharCode(24) + ESC + "[C" + ESC + "[200~a\nb" + ESC + "[201~")),
  ...decoder.push(Buffer.from(ESC)),
  ...decoder.finish(),
];
const keys = decoded.map(key => key.kind);
const pasted = decoded.flatMap(key => (key.kind === "paste" ? [key.value] : []));

terminal.restore();
const pasteOff = sent.join("").includes(`${ESC}[?2004l`);
// Written after restore so the report is not swallowed by the alternate screen.
process.stdout.write(`OMA_TTY_REPORT ${JSON.stringify({
  isTTY, rawEnabled, rawRestored, columns, rows, keys, pasted, pasteOn, pasteOff,
})}\n`);
process.exit(0);
