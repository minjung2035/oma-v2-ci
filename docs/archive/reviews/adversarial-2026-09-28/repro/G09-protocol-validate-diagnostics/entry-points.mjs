// G09 repro: which PUBLIC entry points reach the unbounded recursion?
import { decodeMutationPayload } from "../../../../dist/src/protocol/request-codec.js";
import { decodeReceipt, decodeFailure, decodeOperationResultShape } from "../../../../dist/src/protocol/receipt-codec.js";
import { canonicalRequestParams } from "../../../../dist/src/domain/request-identity.js";

const deepArray = (n) => "[".repeat(n) + "]".repeat(n);
const deepObject = (n) => '{"a":'.repeat(n) + "1" + "}".repeat(n);

// (A) request-codec.decodeMutationPayload calls snapshotJson(value) BEFORE
//     decodePublicParams. So a deeply nested value overflows in snapshotJson.
//     Its declared throw type is TypeError; a RangeError is a different escape.
for (const depth of [100000]) {
  const v = JSON.parse(deepArray(depth));
  try {
    decodeMutationPayload("mail.ack", v);
    console.log(`decodeMutationPayload(deep): returned (no throw)`);
  } catch (e) {
    console.log(`decodeMutationPayload(deep): ${e.constructor.name} (RangeError=${e instanceof RangeError}, TypeError=${e instanceof TypeError})`);
  }
}

// (B) A deeply nested value under a *valid* field of mail.ack? mail.ack only
//     accepts {message:string}. So checkObject rejects deep nesting. But snapshotJson
//     ran first in (A) and already overflowed. Confirm mail.ack rejects deep object as field:
try {
  const v = { message: JSON.parse(deepArray(100000)) };
  decodeMutationPayload("mail.ack", v);
  console.log("mail.ack deep-message-field: returned");
} catch (e) {
  console.log(`mail.ack deep-message-field: ${e.constructor.name} (RangeError=${e instanceof RangeError})`);
}

// (C) decodeReceipt calls snapshot()->snapshotJson inside try/catch; RangeError
//     is NOT an Error subtype? It is. Does its try/catch catch RangeError and
//     convert to {ok:false}? snapshot() catches `error instanceof Error`.
for (const depth of [100000]) {
  const v = JSON.parse(deepObject(depth));
  const r = decodeReceipt(v);
  console.log(`decodeReceipt(deep): ok=${r.ok} reason=${r.ok ? "-" : String(r.reason).slice(0,40)}`);
}
try {
  const v = JSON.parse(deepArray(100000));
  const r = decodeFailure(v);
  console.log(`decodeFailure(deep): ok=${r.ok}`);
} catch (e) {
  console.log(`decodeFailure(deep): THREW ${e.constructor.name}`);
}

// (D) canonicalRequestParams for a set-field method (mail.send has 'to' set).
//     Deep nesting under 'to'? 'to' must be string array. But snapshotJson runs
//     over the WHOLE params first.
for (const depth of [100000]) {
  const v = JSON.parse(deepObject(depth));
  try {
    canonicalRequestParams("mail.send", v);
    console.log("canonicalRequestParams(deep): returned");
  } catch (e) {
    console.log(`canonicalRequestParams(deep): ${e.constructor.name} (RangeError=${e instanceof RangeError})`);
  }
}
