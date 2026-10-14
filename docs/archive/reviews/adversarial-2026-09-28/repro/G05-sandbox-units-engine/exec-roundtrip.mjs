import { renderUnit } from "../../../../dist/src/units/render.js";
import { renderedExecArgv, effectiveExecArgv } from "../../../../dist/src/units.js";

const base = { node:"/opt/node", libdir:"/opt/oma", state:"/s", society:"demo", agent:"worker" };

// Real resident.service.in ExecStart shape with validated values (no $ possible),
// but test the round-trip logic of renderedExecArgv vs what systemd would report.
const tpl = "ExecStart=@NODE@ @LIBDIR@/dist/src/entry/runner.js --society @SOCIETY@ --agent @AGENT@ --state-root @STATE_ARG@";
const rendered = renderUnit(tpl, { ...base, config:"/c", run:"/r" });
console.log("rendered ExecStart line:", JSON.stringify(rendered));
const words = renderedExecArgv(rendered);
console.log("renderedExecArgv:", JSON.stringify(words));

// Now simulate: does renderedExecArgv reverse %% and \xNN? Craft libdir with a space.
const tpl2 = "ExecStart=@NODE@ @LIBDIR@/x";
const rendered2 = renderUnit(tpl2, { ...base, libdir:"/opt/o a" }); // space -> \x20
console.log("\nrendered2:", JSON.stringify(rendered2));
console.log("renderedExecArgv2:", JSON.stringify(renderedExecArgv(rendered2)));
// systemd would report argv words with the space intact; the parser reverses \x20 -> space
