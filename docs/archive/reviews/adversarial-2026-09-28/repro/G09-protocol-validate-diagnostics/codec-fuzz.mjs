// G09 repro: codec fuzz — __proto__, type confusion, boundaries, receipt order.
import { decodeReceipt, decodeFailure, receiptSupersession } from "../../../../dist/src/protocol/receipt-codec.js";
import { decodeRunLease } from "../../../../dist/src/protocol/run-lease.js";
import { decodeHostMessage } from "../../../../dist/src/protocol/host-channel.js";
import { requestProblem, responseProblem, helloParamsProblem } from "../../../../dist/src/protocol/host-guest.js";
import { credentialMatches } from "../../../../dist/src/protocol/principal-credential.js";

function show(label, v) { console.log(`${label}: ${v}`); }

// __proto__ injection via JSON text into decodeReceipt (snapshotJson uses defineProperty).
const protoText = '{"operation":"","state":"failed","error":{"code":"REQUEST_NOT_FOUND","message":"x","retry":"same-key"},"__proto__":{"polluted":true}}';
const r1 = decodeReceipt(JSON.parse(protoText), { allowNotFound: true });
show("decodeReceipt(__proto__)", `ok=${r1.ok} reason=${r1.ok?'-':r1.reason}`);
show("Object.prototype.polluted after", ({}).polluted);

// receiptSupersession: unknown is never terminal (P0-5), contradiction detection.
show("succeeded->pending", receiptSupersession({operation:"o",state:"succeeded"},{operation:"o",state:"pending"})); // stale
show("succeeded->failed", receiptSupersession({operation:"o",state:"succeeded"},{operation:"o",state:"failed"})); // contradiction
show("failed->unknown", receiptSupersession({operation:"o",state:"failed"},{operation:"o",state:"unknown"})); // stale
show("pending->unknown", receiptSupersession({operation:"o",state:"pending"},{operation:"o",state:"unknown"})); // supersedes
show("null->unknown", receiptSupersession(null,{operation:"o",state:"unknown"})); // supersedes

// Type confusion: numeric string for incarnation in run-lease.
try {
  decodeRunLease({ actor: "alice", incarnation: "5", socketHostPath: "/x" }, { actor: "alice", runRoot: "/run/oma" });
  show("runLease incarnation='5'", "ACCEPTED (bug)");
} catch (e) { show("runLease incarnation='5'", `rejected ${e.code}`); }

// host-channel: pid boundaries, leading zeros.
show("session pid=0", JSON.stringify(decodeHostMessage("session " + "a".repeat(32) + " 0")));
show("session pid huge", JSON.stringify(decodeHostMessage("session " + "a".repeat(32) + " 99999999999")));

// host-guest requestProblem: extra field, __proto__ key.
show("requestProblem __proto__", requestProblem(JSON.parse('{"v":1,"id":"x","method":"a.b","params":{},"__proto__":{"x":1}}')));
show("requestProblem extra", requestProblem({v:1,id:"x",method:"a.b",params:{},extra:1}));

// credentialMatches: wrong length, non-string, all same.
show("cred match short", credentialMatches("abc", "a".repeat(64)));
show("cred match equal", credentialMatches("a".repeat(64), "a".repeat(64)));
show("cred match number", credentialMatches(123, "a".repeat(64)));

// decodeFailure: extra field, missing retry, wrong code type.
show("failure extra field", JSON.stringify(decodeFailure({code:"INVALID_REQUEST",message:"m",retry:"never",extra:1})));
show("failure bad retry", JSON.stringify(decodeFailure({code:"INVALID_REQUEST",message:"m",retry:"maybe"})));
