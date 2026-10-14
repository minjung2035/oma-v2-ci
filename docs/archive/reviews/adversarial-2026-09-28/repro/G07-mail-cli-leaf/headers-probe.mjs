// Probe the pure eml header parser with adversarial inputs.
import { parseEmlHeaders, displaySubject, decodeSubject } from "../../../../dist/src/mail/headers.js";

function attempt(name, text, extra) {
  try {
    const h = parseEmlHeaders(text, extra);
    console.log(`ACCEPTED ${name}:`, JSON.stringify({ from: h.from, to: h.to, subject: h.subject, messageId: h.messageId, references: h.references, inReplyTo: h.inReplyTo, dateMs: h.dateMs, omaKind: h.omaKind }));
  } catch (e) {
    console.log(`REJECTED ${name}: ${e.code ?? ""} ${e.message}`);
  }
}

// 1. CRLF injection inside a folded header continuation
attempt("bare-CR-in-value", "From: a@x.oma.invalid\r\nSubject: hi\rInjected: yes\r\n\r\n");
// 2. Folding that smuggles a second logical header via continuation
attempt("fold-continuation", "From: a@x.oma.invalid\nSubject: line1\n more\n\n");
// 3. Long line just over 998 bytes
attempt("998+line", "Subject: " + "a".repeat(1000) + "\n\n");
// 4. Homoglyph in From local part (Cyrillic 'а' U+0430)
attempt("homoglyph-from", "From: \u0430dmin@x.oma.invalid\nMessage-ID: <m-0000000000000000-0@x.oma.invalid>\n\n");
// 5. From with +tag and mixed case
attempt("plus-tag-from", "From: Admin+boss@x.oma.invalid\n\n");
// 6. duplicate References ancestors ordering
attempt("references-order", "References: <m-a-0@x.oma.invalid> <m-b-0@x.oma.invalid> <m-a-0@x.oma.invalid>\n\n");
// 7. Date reverse / arbitrary
attempt("arbitrary-date", "Date: Mon, 01 Jan 2001 00:00:00 +0900\n\n");
// 8. multiple From
attempt("multi-from", "From: a@x.oma.invalid, b@x.oma.invalid\n\n");
// 9. 8-bit / non-UTF8 bytes in header (Uint8Array path)
attempt("8bit-latin1", new Uint8Array([0x53,0x75,0x62,0x6a,0x65,0x63,0x74,0x3a,0x20,0xff,0xfe,0x0a,0x0a]));
// 10. RFC2047 encoded word bypass in subject
attempt("enc-word-subject", "Subject: =?UTF-8?B?7ZWc6riA?=\n\n");
attempt("enc-word-adjacent-smuggle", "Subject: =?UTF-8?B?QQ==?= =?UTF-8?Q?=0A=0AInjected?=\n\n");
// 11. NUL in header
attempt("nul-in-header", "Subject: a\x00b\n\n");
// 12. displaySubject fallthrough
console.log("displaySubject broken enc:", JSON.stringify(displaySubject("=?UTF-8?B?bad?=")));
