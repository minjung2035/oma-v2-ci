// Runs under a real pseudo-terminal and reports what the terminal owner did.
// Never imported by production; it exists so the raw-mode branch is exercised
// by an actual TTY rather than by a stubbed stream.
import { decodeKeys } from "../../src/tui/keys.js";
import { openTerminal } from "../../src/tui/screen.js";

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

const terminal = openTerminal({ input, output });
const columns = terminal.columns;
const rows = terminal.rows;

// Feed the bytes a terminal would deliver for Ctrl+X, Right, Escape and confirm
// they reach the panel's vocabulary through the same decoder the app uses.
const ESC = String.fromCharCode(27);
const keys = decodeKeys(Buffer.from(String.fromCharCode(24) + ESC + "[C" + ESC))
  .map(key => key.kind);

terminal.restore();
// Written after restore so the report is not swallowed by the alternate screen.
process.stdout.write(`OMA_TTY_REPORT ${JSON.stringify({ isTTY, rawEnabled, rawRestored, columns, rows, keys })}\n`);
process.exit(0);
