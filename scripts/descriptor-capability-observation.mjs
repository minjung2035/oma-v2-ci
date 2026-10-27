/** Parse test evidence, without turning its values into filesystem support.
 * A successful open or exit cannot supply an unobserved inode/cursor/image. */
function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)))
    throw new Error("descriptor observation fields are missing or extra");
}
const integer = value => Number.isSafeInteger(value) && value >= 0;
function duplicate(value) {
  const facts = ["sameInode", "closeOnExec", "accessMode", "sourceBefore", "sourceAfter", "duplicateBefore", "duplicateAfter"];
  record(value, ["attempted", "openReturn", "openErrno", ...facts]);
  if (typeof value.attempted !== "boolean") throw new Error("descriptor attempt is not explicit");
  if (!value.attempted) {
    if (["openReturn", "openErrno", ...facts].some(key => value[key] !== null))
      throw new Error("unattempted descriptor operation contains invented observations");
    return;
  }
  if (!Number.isSafeInteger(value.openReturn) || value.openReturn < -1 || !integer(value.openErrno))
    throw new Error("descriptor return or errno is malformed");
  if (value.openReturn === -1) {
    if (value.openErrno === 0 || facts.some(key => value[key] !== null))
      throw new Error("failed descriptor open contains success facts");
    return;
  }
  if (typeof value.sameInode !== "boolean" || typeof value.closeOnExec !== "boolean" ||
      ![0, 1, 2].includes(value.accessMode) ||
      ["sourceBefore", "sourceAfter", "duplicateBefore", "duplicateAfter"].some(key => !integer(value[key])))
    throw new Error("successful descriptor open lacks its actual identity/flags/cursor observations");
}
function execution(value) {
  record(value, ["execErrno", "exitCode", "signal", "reply"]);
  if (!(value.execErrno === null || integer(value.execErrno) && value.execErrno > 0) ||
      !(value.exitCode === null || integer(value.exitCode) && value.exitCode <= 255) ||
      !(value.signal === null || integer(value.signal) && value.signal > 0) ||
      (value.exitCode === null) === (value.signal === null) ||
      !["original", "replacement", "exec-error", "none", "unknown"].includes(value.reply))
    throw new Error("descriptor exec result is malformed");
  if ((value.execErrno !== null) !== (value.reply === "exec-error") ||
      value.execErrno !== null && (value.exitCode !== 125 || value.signal !== null))
    throw new Error("exec errno does not match the child's actual error reply and exit");
}
export function validateDescriptorCapabilityObservation(value) {
  record(value, ["platform", "devFd", "fileport", "namespace", "exec"]);
  if (!["darwin", "linux", "other"].includes(value.platform)) throw new Error("descriptor platform is malformed");
  duplicate(value.devFd);
  if (!value.devFd.attempted) throw new Error("descriptor reopen was not attempted");
  record(value.fileport, ["available", "makeportReturn", "makeportErrno", "duplicate"]);
  const port = value.fileport;
  if (typeof port.available !== "boolean") throw new Error("fileport SDK availability is not explicit");
  if (port.available) {
    if (![0, -1].includes(port.makeportReturn) || !integer(port.makeportErrno) ||
        port.makeportReturn === -1 && port.makeportErrno === 0 ||
        port.duplicate?.attempted !== (port.makeportReturn === 0))
      throw new Error("fileport creation and descriptor attempt disagree");
  } else if (port.makeportReturn !== null || port.makeportErrno !== null || port.duplicate?.attempted !== false)
    throw new Error("unavailable fileport contains invented API observations");
  duplicate(port.duplicate);
  record(value.namespace, ["heldAfterSwap", "namedIsReplacement", "heldAfterUnlink"]);
  if (Object.values(value.namespace).some(fact => typeof fact !== "boolean"))
    throw new Error("descriptor namespace observations are malformed");
  record(value.exec, ["direct", "fdBeforeSwap", "namedAfterSwap", "fdAfterSwap", "fdAfterUnlink"]);
  for (const result of Object.values(value.exec)) execution(result);
  const successful = (row, reply) => row.execErrno === null && row.exitCode === 0 && row.signal === null && row.reply === reply;
  if (!successful(value.exec.direct, "original") || !successful(value.exec.namedAfterSwap, "replacement"))
    throw new Error("descriptor exec controls did not distinguish the original image from its replacement");
}
