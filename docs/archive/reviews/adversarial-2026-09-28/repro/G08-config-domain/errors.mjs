// errors: unobserved() answered-vs-unanswered classification per the brief's errno list.
import { unobserved, classifyError, ERROR_METADATA, errorExit } from "../../../../dist/src/domain/errors.js";

const errnos = ["EINTR","EAGAIN","ENOMEM","EMFILE","ENFILE","ENOSPC","EROFS","ESTALE","ELOOP","ENAMETOOLONG","ENOTDIR","ENOENT","EISDIR","EACCES","EIO"];
for (const code of errnos) {
  const e = Object.assign(new Error(code), { code });
  const r = unobserved(e, "the file");
  console.log(`${code.padEnd(13)} -> ${r ? r.code + " (unanswered)" : "null (answered/fact)"}`);
}

// P0-5: does an accepted-phase unknown-observation get promoted to "failed"?
console.log("\nclassifyError accepted-phase:");
for (const [code, obs, eff] of [
  ["BROKER_UNAVAILABLE","unavailable","none"],
  ["INTERNAL_ERROR","unavailable","none"],
  ["PROVIDER_OUTCOME_UNKNOWN","unavailable","possible"],
  ["INVALID_REQUEST","rejected","none"],
  ["DEADLINE_EXCEEDED","unavailable","possible"],
]) {
  const p = classifyError({ code, phase: "accepted", effectKnowledge: eff, observationKind: obs });
  console.log(`${code.padEnd(24)} obs=${obs} eff=${eff} -> terminal=${p.terminal} reconcile=${p.reconcile} exit=${errorExit(code, p.reconcile!=="none"?"same-key":"never")}`);
}
