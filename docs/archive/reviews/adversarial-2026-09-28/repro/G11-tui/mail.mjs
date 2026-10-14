// G11-tui: mail parse hostile headers/body + does the view sanitize them.
import { parseMessage } from "../../../../dist/src/tui/sources/mail.js";
import { displayable } from "../../../../dist/src/tui/view/text.js";

function hex(s){return [...Buffer.from(s,"utf8")].map(b=>b.toString(16).padStart(2,"0")).join(" ");}
function hasESC(s){return [...Buffer.from(s,"utf8")].includes(0x1b);}

// Hostile subject with ESC + RLO, hostile from with CSI
const raw =
  "From: \x1b[31mAttacker\x1b[0m <a@evil>\r\n" +
  "Subject: important\x1b]52;c;cGduZWQ=\x07 \u202Etxt.exe\r\n" +
  "X-Oma-Kind: message\r\n" +
  "\r\n" +
  "Body \x1b[2J cleared\n\u202Ereversed body";
const p = parseMessage(raw);
console.log("subject_raw_ESC:", hasESC(p.headers.subject), "subject:", JSON.stringify(p.headers.subject));
console.log("from_raw_ESC:", hasESC(p.headers.from), "from:", JSON.stringify(p.headers.from));
console.log("body_raw_ESC:", hasESC(p.body), "body:", JSON.stringify(p.body));
// The screen path: what render() ultimately runs through pad()->fit()->displayable()
console.log("subject_display_ESC:", hasESC(displayable(p.headers.subject)), "->", JSON.stringify(displayable(p.headers.subject)));
console.log("body_display_ESC:", hasESC(displayable(p.body)), "-> hex:", hex(displayable(p.body)));
