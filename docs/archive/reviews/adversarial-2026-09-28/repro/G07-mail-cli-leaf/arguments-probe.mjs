import { parseArguments } from "../../../../dist/src/cli/arguments.js";
// override process.exit to observe fail() codes without dying
const realExit = process.exit;
function run(name, args, spec) {
  let exited = null;
  process.exit = (c) => { exited = c; throw new Error(`__exit_${c}`); };
  try {
    const p = parseArguments(args, spec);
    console.log(`${name}: positional=${JSON.stringify(p.positional)} sub=${JSON.stringify(p.value("--subject"))}`);
  } catch (e) {
    if (String(e.message).startsWith("__exit_")) console.log(`${name}: FAIL exit=${exited}`);
    else console.log(`${name}: THREW ${e.message}`);
  } finally { process.exit = realExit; }
}
const SEND = { options: { "--subject": "value", "--file": "value", "--to": "values" }, positional: { min: 0, max: 100 } };
run("value-looks-like-option-in-slot", ["--subject", "--file"], SEND); // --file becomes subject value verbatim
run("dashdash-positional", ["--", "--subject", "x"], SEND);
run("dup-single-option", ["--subject", "a", "--subject", "b"], SEND);
run("dup-repeatable", ["--to", "a", "--to", "b"], SEND);
run("unknown-option", ["--bogus", "x"], SEND);
run("option-missing-value", ["--subject"], SEND);
run("nul-in-value", ["--subject", "a\x00b"], SEND); // NUL passes through as value
run("very-long-value", ["--subject", "z".repeat(500000)], SEND);
run("bare-dash-positional", ["-"], SEND); // single '-' is positional (length 1)
run("neg-number-positional", ["-5"], SEND); // optionLike true -> unknown option
process.exit = realExit;
