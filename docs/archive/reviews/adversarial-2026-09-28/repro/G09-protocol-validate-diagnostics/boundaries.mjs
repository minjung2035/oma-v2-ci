import { decodeRunLease } from "../../../../dist/src/protocol/run-lease.js";
import { findDuplicateKey, parseJsonObject } from "../../../../dist/src/frame.js";
import { decodeReceipt } from "../../../../dist/src/protocol/receipt-codec.js";
import { checkInt, checkString } from "../../../../dist/src/validate.js";

const show = (l, v) => console.log(`${l}: ${v}`);

// Duplicate key detection including escaped spelling.
show("dup plain", findDuplicateKey('{"a":1,"a":2}'));
show("dup escaped", findDuplicateKey('{"a":1,"\\u0061":2}'));
show("dup nested none", findDuplicateKey('{"a":{"b":1},"c":{"b":2}}'));
// parseJsonObject rejects duplicate
try { parseJsonObject(Buffer.from('{"a":1,"a":2}')); show("parse dup", "accepted(bug)"); }
catch (e) { show("parse dup", `rejected ${e.code}`); }

// run-lease with a 4th key hidden? Object.keys length check.
try {
  decodeRunLease(JSON.parse('{"actor":"alice","incarnation":5,"socketHostPath":"/x","__proto__":{"y":1}}'),
    { actor: "alice", runRoot: "/run/oma" });
  show("runLease 4keys(proto)", "ACCEPTED");
} catch (e) { show("runLease 4keys(proto)", `rejected ${e.code}`); }

// receipt notFound: non-empty operation with REQUEST_NOT_FOUND — should NOT be notFound.
const r = decodeReceipt({operation:"", state:"failed", error:{code:"INVALID_REQUEST",message:"m",retry:"never"}}, {allowNotFound:true});
show("receipt empty-op non-NOTFOUND-code", `ok=${r.ok} reason=${r.ok?'-':r.reason}`);
// incarnation = 0 in run-lease (min is 1)
try { decodeRunLease({actor:"alice",incarnation:0,socketHostPath:"/x"},{actor:"alice",runRoot:"/run/oma"}); show("runLease inc=0","ACCEPTED"); }
catch(e){ show("runLease inc=0", `rejected ${e.code}`); }

// boundary values on validate primitives
show("checkInt MAX_SAFE+1", checkInt()(Number.MAX_SAFE_INTEGER + 1));
show("checkInt NaN", checkInt()(NaN));
show("checkInt -0", checkInt({min:0})(-0));
show("checkInt Infinity", checkInt()(Infinity));
show("checkString surrogate", checkString()("\uD800"));
show("checkString normal", checkString()("hello"));

// ReDoS check on validate regexes: none use nested quantifiers; time a long input.
const t0 = Date.now();
checkString({re:/^[0-9a-f]{64}$/})("f".repeat(100000) + "!");
show("checkString long re time ms", Date.now() - t0);
