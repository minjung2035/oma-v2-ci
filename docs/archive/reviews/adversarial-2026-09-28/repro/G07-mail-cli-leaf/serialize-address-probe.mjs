import { buildEml } from "../../../../dist/src/mail/serialize.js";
import { parseDisplayedAddress, actorAddress } from "../../../../dist/src/mail/addresses.js";
import { selectBatch } from "../../../../dist/src/mail/batch-policy.js";
import { defaultLogicalReplyTo } from "../../../../dist/src/mail/facts.js";

// 1. address parsing: homoglyph + plus-tag against a known actor set
const known = new Set(["alice", "bob"]);
for (const v of ["alice", "Alice", "alice+tag", "\u0430lice", "alice@x.oma.invalid", "ALICE@x.oma.invalid", "alice@x.oma.invalid ", "bob@other.oma.invalid", "topic/foo", "commons"]) {
  console.log(`parseDisplayedAddress(${JSON.stringify(v)}) =>`, JSON.stringify(parseDisplayedAddress(v, "x", known)));
}

// 2. batch-policy boundaries
for (const m of [0, -1, 1, 2, Number.MAX_SAFE_INTEGER, NaN, 1.5]) {
  try {
    const r = selectBatch([{ value: "d1", publicList: false }, { value: "p1", publicList: true }, { value: "d2", publicList: false }], m);
    console.log(`selectBatch max=${m} =>`, JSON.stringify(r));
  } catch (e) { console.log(`selectBatch max=${m} REJECTED: ${e.code ?? e.message}`); }
}
// direct-only with max 1
console.log("directOnly max1:", JSON.stringify(selectBatch([{value:"d1",publicList:false},{value:"d2",publicList:false}], 1)));

// 3. defaultLogicalReplyTo self-follow / dedup
console.log("replyTo self:", JSON.stringify(defaultLogicalReplyTo("alice", ["alice"])));
console.log("replyTo lists dedup:", JSON.stringify(defaultLogicalReplyTo("alice", ["commons","commons","topic/x"])));

// 4. buildEml: adversarial subject with CRLF, long subject forcing encoded-word
async function eml(name, p) {
  try { const e = await buildEml(p); console.log(`buildEml ${name} OK bytes=${e.bytes}`); }
  catch (err) { console.log(`buildEml ${name} REJECTED: ${err.code ?? ""} ${err.message}`); }
}
const base = { from: "a@x.oma.invalid", to: ["b@x.oma.invalid"], replyTo: [], kind: "message",
  contextRevision: null, inReplyTo: null, references: [], messageId: "m-0000000000000000-0@x.oma.invalid", body: "hi", dateMs: 1700000000000 };
await eml("crlf-subject", { ...base, subject: "a\r\nInjected: yes" });
await eml("long-subject", { ...base, subject: "가".repeat(400) });
await eml("normal", { ...base, subject: "hello" });
await eml("crlf-in-to", { ...base, subject: "s", to: ["b@x.oma.invalid\r\nBcc: evil@x"] });
