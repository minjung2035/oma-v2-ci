/** Test-only reference values. Production must supply validated HostConfig limits. */
export const TEST_VIEW_LIMITS = Object.freeze({ frameBytes: 256 * 1024, batchMaxMessages: 24 });

/** Complete, finite HostConfig limits for loader fixtures, not just view shapes. */
export const TEST_PROTOCOL_LIMITS = Object.freeze({
  frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64,
  replyReferences: 64, contextFiles: 256, contextBytes: 8388608,
  bundleBytes: 268435456, logBytes: 1048576, batchMaxMessages: 24,
  idleStreamSeconds: 60, receiptWaitSeconds: 60,
});
