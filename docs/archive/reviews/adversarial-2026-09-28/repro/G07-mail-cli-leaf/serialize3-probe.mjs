import { buildEml } from "../../../../dist/src/mail/serialize.js";
import { randomUUID } from "node:crypto";
const mid = `m-${randomUUID()}-0`;
const base = { from: "a@x.oma.invalid", to: ["b@x.oma.invalid"], replyTo: [], kind: "message",
  contextRevision: null, inReplyTo: null, references: [], messageId: `${mid}@x.oma.invalid`, body: "hi", dateMs: 1700000000000 };
async function t(name, p) {
  try { const e = await buildEml(p); console.log(`${name} OK ${e.bytes}`); }
  catch (err) { console.log(`${name} THREW ${err.constructor.name} code=${err.code} : ${err.message}`); if (err.stack) console.log(err.stack.split("\n").slice(0,4).join("\n")); }
}
await t("one-ref", { ...base, references: ["m-aaaa-0"] });
await t("two-ref", { ...base, references: ["m-aaaa-0", "m-bbbb-0"] });
await t("inReplyTo-set", { ...base, inReplyTo: "m-aaaa-0" });
await t("approval-undefined-policy", { ...base, kind: "approval_required", approvalFor: { repo:"project", targetRef:"refs/heads/main", candidate:"a".repeat(40), expectedBase:"b".repeat(40), policyRevision: undefined } });
