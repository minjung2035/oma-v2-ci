/** CFG-003's reference values. Stated here rather than inferred so the written
 * configuration shows the operator exactly what is in force.
 */
export const REFERENCE_PROTOCOL_LIMITS = Object.freeze({
  frameBytes: 256 * 1024,
  mailBodyBytes: 256 * 1024,
  subjectBytes: 512,
  addresses: 64,
  replyReferences: 64,
  contextFiles: 256,
  contextBytes: 8 * 1024 * 1024,
  bundleBytes: 256 * 1024 * 1024,
  logBytes: 1024 * 1024,
  batchMaxMessages: 24,
  idleStreamSeconds: 30,
  receiptWaitSeconds: 30,
});

