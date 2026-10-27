import { buildEml } from "../../../../dist/src/mail/serialize.js";
import { parseEmlHeaders } from "../../../../dist/src/mail/headers.js";
import { randomUUID } from "node:crypto";

const mid = `m-${randomUUID()}-0`;
const base = { from: "a@x.oma.invalid", to: ["b@x.oma.invalid"], replyTo: [], kind: "message",
  contextRevision: null, inReplyTo: null, references: [], messageId: `${mid}@x.oma.invalid`, body: "hi", dateMs: 1700000000000 };

async function eml(name, p) {
  try {
    const e = await buildEml(p);
    const h = parseEmlHeaders(e.text, { maxHeaderBytes: e.bytes });
    console.log(`buildEml ${name} OK bytes=${e.bytes} subjRaw=${JSON.stringify(h.subject)?.slice(0,60)}`);
  } catch (err) { console.log(`buildEml ${name} REJECTED: ${err.code ?? ""} ${err.message}`); }
}
await eml("normal", { ...base, subject: "hello" });
await eml("long-korean", { ...base, subject: "가".repeat(400) });
await eml("long-ascii", { ...base, subject: "A".repeat(1200) });
// Message-ID/References forgery: put attacker-chosen references
await eml("forged-references", { ...base, references: [`m-${randomUUID()}-0`, `m-${randomUUID()}-0`] });
