/** P9 persisted-state corpus. Authored source corpus, not a measured discovery. */
import { ALL_CAPS, makeValidResolvedSpec } from "../fixtures/spec.js";

const OP = "op-00000000-0000-4000-8000-0000000000e1";
const MESSAGE = "m-00000000-0000-4000-8000-0000000000e1-0";
const OID = "1".repeat(40);
const SHA = "a".repeat(64);

export const PLAN_API = { operationId: OP, actor: "a", stateRoot: "/state", repositoryIdentity: { society: "demo" } } as const;

export const PLAN_VALID = [
  { kind: "route.follow", topic: "dev", agent: "a" },
  { kind: "route.unfollow", topic: "dev", agent: "a" },
  { kind: "mail.ack", recipient: "a", message: MESSAGE },
  {
    kind: "mail.send",
    message: { id: MESSAGE, objectPath: `mail/objects/${MESSAGE}.eml`, sha256: SHA, bytes: 1, dateMs: 1,
      to: ["commons"], recipients: ["a"], kind: "message", contextRevision: null,
      replyHeaders: { replyTo: ["commons"], inReplyTo: null, references: [] } },
  },
  { kind: "agent.start", agent: "a", previousIncarnation: 0, desired: "enabled", remainingOperations: [] },
] as const;

/** Shapes a decoder must reject as a closed failure, never repair. */
export const PLAN_INVALID: readonly unknown[] = [
  null, 1, "plan", [], {},
  { kind: "unknown.kind" },
  { kind: "route.follow", topic: "dev" },
  { kind: "route.follow", topic: "DEV", agent: "a" },
  { kind: "route.follow", topic: "dev", agent: "a", extra: true },
  { kind: "mail.send", message: { id: MESSAGE } },
  { kind: "mail.send", message: null },
  { kind: "agent.start", agent: "a", previousIncarnation: -1, desired: "enabled", remainingOperations: [] },
  { kind: "agent.start", agent: "a", previousIncarnation: 0, desired: "stopped", remainingOperations: [] },
  {policyIdentity: "02c010d0ad2a2e60c59a05b83368e8699b97567828b4f75ffa160dfd35b1bb70", noopRef: null,  kind: "git.integrate", repo: "project", target: "refs/heads/main", base: OID, candidate: OID, policyRevision: "", checkProfileDigest: SHA },
  {noopRef: null,  kind: "context.publish", base: null, candidate: OID, target: "refs/heads/main", entries: [], stagingPath: "", message: null },
  { kind: "route.follow", topic: "dev", agent: "a", version: "v2" },
  JSON.parse('{"kind":"route.follow","topic":"dev","agent":"a","__proto__":{"polluted":true}}') as unknown,
];

export const RESULT_VALID = [
  { kind: "route.follow", topic: "dev", subscribed: true },
  { kind: "route.unfollow", topic: "dev", subscribed: false },
  { kind: "mail.ack", message: MESSAGE, acknowledged: true },
  { kind: "agent.start", agent: "a", desired: "enabled" },
] as const;

export const RESULT_INVALID: readonly unknown[] = [
  null, 0, "result", [], {},
  { kind: "route.follow", topic: "dev" },
  { kind: "route.follow", topic: "DEV", subscribed: true },
  { kind: "route.follow", topic: "dev", subscribed: true, extra: 1 },
  { kind: "mail.ack", message: MESSAGE, acknowledged: false },
  { kind: "unknown.kind" },
];

export const SPEC_VALID = makeValidResolvedSpec("a", "p", ALL_CAPS);

export const SPEC_INVALID: readonly unknown[] = [
  null, 0, "spec", [], {},
  { ...SPEC_VALID, name: "A" },
  { ...SPEC_VALID, modelProfile: "" },
  { ...SPEC_VALID, capabilities: ["not.a.capability"] },
  { ...SPEC_VALID, from: "not-an-oid" },
  { ...SPEC_VALID, extra: true },
  { ...SPEC_VALID, profile: 7 },
];

export const MANIFEST_VALID = [
  { path: "GOAL.md", bytes: 1, sha256: SHA },
  { path: "decisions/a.md", bytes: 2, sha256: "b".repeat(64) },
] as const;

export const MANIFEST_INVALID: readonly unknown[] = [
  null, [], [{}],
  [{ path: "GOAL.md", bytes: 0, sha256: SHA }],
  [{ path: "GOAL.md", bytes: 1, sha256: SHA }, { path: "GOAL.md", bytes: 1, sha256: SHA }],
  [{ path: "../escape", bytes: 1, sha256: SHA }],
  [{ path: "/abs", bytes: 1, sha256: SHA }],
  [{ path: "decisions", bytes: 1, sha256: SHA }],
  [{ path: "GOAL.md", bytes: -1, sha256: SHA }],
  [{ path: "GOAL.md", bytes: 1, sha256: SHA.toUpperCase() }],
  [{ path: "GOAL.md", bytes: 1, sha256: SHA, extra: true }],
];
