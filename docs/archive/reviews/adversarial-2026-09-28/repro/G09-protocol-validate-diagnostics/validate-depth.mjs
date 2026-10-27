// G09 repro: does checkObject (validate.ts) reject deep nesting WITHOUT itself
// overflowing, so the broker never reaches canonicalRequestParams on deep input?
import { mailParamsCheck } from "../../../../dist/src/validate.js";
import { decodePublicParams } from "../../../../dist/src/protocol/methods.js";
import { parseJsonObject } from "../../../../dist/src/frame.js";

const deepObject = (n) => '{"a":'.repeat(n) + "1" + "}".repeat(n);
const deepArray = (n) => "[".repeat(n) + "]".repeat(n);

const limits = {
  frameBytes: 256*1024, mailBodyBytes: 256*1024, subjectBytes: 4096, addresses: 64,
  replyReferences: 64, contextFiles: 1024, contextBytes: 1024*1024, bundleBytes: 1024*1024,
  logBytes: 1024, batchMaxMessages: 24, idleStreamSeconds: 30, receiptWaitSeconds: 30,
};

try {
  const v = JSON.parse(deepObject(100000));
  const err = mailParamsCheck(limits)(v);
  console.log(`mailParamsCheck(deep-object-root): err=${String(err).slice(0,40)}`);
} catch (e) { console.log(`mailParamsCheck(deep-object-root): THREW ${e.constructor.name}`); }

try {
  const v = { to: [], subject: "", kind: "message", body: "",
    refs: [{ repo: "project", oid: JSON.parse(deepArray(100000)) }] };
  const err = mailParamsCheck(limits)(v);
  console.log(`mailParamsCheck(deep-in-oid): err=${String(err).slice(0,40)}`);
} catch (e) { console.log(`mailParamsCheck(deep-in-oid): THREW ${e.constructor.name}`); }

try {
  const v = JSON.parse(deepObject(100000));
  const r = decodePublicParams("mail.ack", v, { actorNames: new Set(), limits });
  console.log(`decodePublicParams(mail.ack, deep): result=${r === null ? "null(rejected)" : "accepted"}`);
} catch (e) { console.log(`decodePublicParams(mail.ack, deep): THREW ${e.constructor.name} (RangeError=${e instanceof RangeError})`); }

try {
  const frameText = `{"v":1,"id":"x","method":"mail.ack","params":${deepObject(100000)},"request":"k"}`;
  parseJsonObject(Buffer.from(frameText, "utf8"));
  console.log(`parseJsonObject(deep-params-envelope): parsed OK, deep params reaches validation`);
} catch (e) { console.log(`parseJsonObject(deep-params-envelope): ${e.constructor.name}: ${String(e.message).slice(0,40)}`); }
