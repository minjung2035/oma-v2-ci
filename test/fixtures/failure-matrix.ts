/** Independent test specification: literals, never production planner output.
 * after-durable means the observed fsync syscall returned; NOT power-loss proof. */
export const DERIVED_FAILURE_CASES = [
 {
  point: "pre-effect",
  phase: "before-file-effect",
  pointer: "old",
  temporaries: 0,
  sameInode: true,
 },
 {
  point: "temporary-created",
  phase: "owned-temporary-before-write",
  pointer: "old",
  temporaries: 1,
  sameInode: true,
 },
 {
  point: "after-visible",
  phase: "rename-before-parent-fsync",
  pointer: "new",
  temporaries: 0,
  sameInode: false,
 },
 {
  point: "after-durable",
  phase: "parent-fsync-returned",
  pointer: "new",
  temporaries: 0,
  sameInode: false,
 },
] as const;

export const MAIL_ACCEPTANCE_EXPECTED = {
 point: "accepted",
 phase: "sql-commit-before-materialization-and-response",
 operationCount: 1,
 state: "pending",
 actor: "a",
 requestKey: "crash-send",
 recipients: ["a", "b", "c"],
 incarnations: [1, 1, 1],
 objectCount: 1,
 archiveCount: 0,
 batchCount: 0,
} as const;

export const GIT_PUBLICATION_EXPECTED = {
 point: "submit-ref",
 phase: "published-ref-cas-before-result-mail-and-response",
 operationCount: 1,
 publishedRefCount: 1,
 archiveCount: 0,
} as const;
