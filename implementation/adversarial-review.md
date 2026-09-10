# Whole-scope adversarial audit ledger

**Release verdict: FAIL.** Scope classification is not executable proof. No requirement is promoted here.

Inventory: 258 labelled MUST/MUST NOT/SHOULD/OPTIONAL clauses across 8 documents. Unlabelled prose, tables and code contracts remain covered by whole-file pins, not silently counted as individually proven.

## Production dependency closure

- No literal relative runtime import outside the manifest or into tests was found.
- Non-entry-reachable TS files: implementation/contracts.ts, src/inference.ts, src/rpc-client.ts, src/sandbox.ts. Type-only contracts and host-loaded extensions need separate treatment; non-reachability alone is not proof of dead code.
- External imports: koffi, node:child_process, node:crypto, node:fs, node:net, node:os, node:path, node:sqlite, node:url, node:util, nodemailer, nodemailer/lib/mime-funcs.
- This static scan does not prove SDK callbacks, resource enforcement or reflective loading safe.

## Requirement-by-requirement disposition

| Source | Requirement | Scope | Status | Missing full proof |
|---|---|---|---|---|
| implementation-spec.md | N-001 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | N-006 | document | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | N-002 | document | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | N-003 | document | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | N-004 | document | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | N-005 | document | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | A-001; arch §§1–2,8,21 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | A-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | A-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | A-004 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | A-005 | optional | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | A-006 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | A-007 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | A-008 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | A-009 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | M-001 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | M-002 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | M-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | M-004 | runtime | unverified | fresh bound evidence |
| implementation-spec.md | ID-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | ID-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | ID-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | CFG-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | CFG-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | CFG-005 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | CFG-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | CFG-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | AUTH-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | AUTH-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | AUTH-003 | runtime | unverified | fresh bound evidence |
| implementation-spec.md | FS-001; arch §4 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | FS-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | FS-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | FS-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | FS-005 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | FS-006 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | FS-007 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | DB-001; arch §14 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | DB-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | DB-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | DB-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | DB-005 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | DB-009 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | DB-006 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | DB-007 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | DB-008 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | IPC-001; arch §13 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | IPC-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | IPC-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | IPC-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | IPC-005 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | IPC-006 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | IPC-007 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | IPC-008 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | IPC-009 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | IPC-011 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | IPC-012 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | IPC-010 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | MAIL-001; arch §§3,5 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | MAIL-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | MAIL-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | MAIL-011 | runtime | unverified | fresh bound evidence |
| implementation-spec.md | MAIL-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | MAIL-005 | runtime | unverified | fresh bound evidence |
| implementation-spec.md | MAIL-006 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | MAIL-010 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | MAIL-007 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | MAIL-008 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | MAIL-009 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | BATCH-001; arch §§7,18 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | BATCH-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | BATCH-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | BATCH-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | BATCH-006 | runtime | unverified | fresh bound evidence |
| implementation-spec.md | BATCH-005 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | PI-001; arch §§7–8 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | PI-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | PI-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | RUN-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | RUN-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | RUN-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | PR-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | PR-002 | runtime | unverified | fresh bound evidence |
| implementation-spec.md | PR-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | PR-005 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | PR-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | GIT-001; arch §§10–12 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | GIT-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | GIT-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | GIT-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | GIT-005 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | GIT-006 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | GIT-007 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | GIT-008 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | GIT-009 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | INT-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | INT-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | INT-007 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | INT-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | INT-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | INT-005 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | INT-006 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | APP-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | CTX-001; arch §8.3 | runtime | unverified | fresh bound evidence |
| implementation-spec.md | CTX-002 | runtime | unverified | fresh bound evidence |
| implementation-spec.md | CTX-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | CTX-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | CTX-005 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | CTX-006 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | UNIT-001; arch §§6,15 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | UNIT-002 | runtime | unverified | fresh bound evidence |
| implementation-spec.md | UNIT-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | UNIT-007 | runtime | unverified | fresh bound evidence |
| implementation-spec.md | UNIT-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | UNIT-005 | runtime | unverified | fresh bound evidence |
| implementation-spec.md | UNIT-006 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | CREATE-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | CREATE-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | CREATE-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | LIFE-008 | runtime | unverified | fresh bound evidence |
| implementation-spec.md | LIFE-009 | runtime | unverified | fresh bound evidence |
| implementation-spec.md | LIFE-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | LIFE-007 | runtime | unverified | fresh bound evidence |
| implementation-spec.md | LIFE-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | LIFE-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | LIFE-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | LIFE-005 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | LIFE-006 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | SB-001; arch §16 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | SB-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | SB-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | SB-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | SB-005 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | SB-006 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | INF-001; arch §13.3 | runtime | unverified | entrypoint, fresh bound evidence |
| implementation-spec.md | INF-002 | runtime | unverified | entrypoint, fresh bound evidence |
| implementation-spec.md | INF-003 | runtime | unverified | entrypoint, fresh bound evidence |
| implementation-spec.md | INF-004 | runtime | unverified | entrypoint, fresh bound evidence |
| implementation-spec.md | INF-005 | runtime | unverified | entrypoint, fresh bound evidence |
| implementation-spec.md | INF-006 | runtime | unverified | entrypoint, fresh bound evidence |
| implementation-spec.md | INF-007 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | CLI-001; arch §§9,14 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | CLI-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | CLI-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | VIEW-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | VIEW-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | VIEW-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | OPT-INDEX | optional | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | ERR-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | ERR-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | REC-001; arch §§17–19 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | REC-007 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | REC-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | REC-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | REC-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | REC-005 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | REC-006 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | ORDER-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | ORDER-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | ORDER-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | ORDER-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | TRACE-002 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | TRACE-003 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | REC-008 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | TRACE-001 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | NEG-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | NEG-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | NEG-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | NEG-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation-spec.md | NEG-005 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | POL-001 | document | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | POL-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | POL-003 | document | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | POL-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | TIER-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | TIER-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | TIER-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | TIER-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | TIER-005 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | TIER-006 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | TIER-007 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | TIER-008 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | TIER-009 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | PUB-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | PUB-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | CHAL-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | CHAL-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | CHAL-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | CHAL-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | CHAL-005 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | CHAL-006 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | SEM-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | SEM-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | SEM-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | PACK-001 | document | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | PACK-002 | document | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | PACK-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | PACK-004 | document | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | VERIFY-001 | optional | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | VERIFY-002 | optional | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | VERIFY-003 | optional | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | POL-005 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | POL-006 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | POL-007 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | POL-008 | document | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/integration-policy.md | POL-009 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/physical-ordering.md | SEQ-001 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/physical-ordering.md | SEQ-002 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/physical-ordering.md | SEQ-003 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/physical-ordering.md | SEQ-004 | runtime | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/compliance.md | COMP-001 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/compliance.md | COMP-002 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/compliance.md | COMP-003 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/compliance.md | COMP-004 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/compliance.md | COMP-005 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/compliance.md | COMP-006 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/compliance.md | COMP-007 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/compliance.md | COMP-008 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/loc-budget.md | LOC-001 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/loc-budget.md | LOC-002 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/loc-budget.md | LOC-003 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/loc-budget.md | LOC-004 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/loc-budget.md | LOC-005 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/loc-budget.md | LOC-006 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/loc-budget.md | LOC-007 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/loc-budget.md | LOC-008 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/test-matrix.md | TEST-001 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/test-matrix.md | TEST-002 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/test-matrix.md | TEST-006 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/test-matrix.md | TEST-007 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/test-matrix.md | TEST-003 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/test-matrix.md | TEST-004 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/test-matrix.md | TEST-005 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-001 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-002 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-003 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-01-T | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-01-A | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-02-T | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-02-A | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-03-T | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-03-A | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-03-D | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-04-T | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-04-A | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-05-T | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-05-A | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-06-T | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-06-A | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-07-A | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-08-A | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-09-T | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/spikes.md | SP-09-A | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/validation.md | VAL-001 | document | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/validation.md | VAL-002 | document | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/validation.md | VAL-003 | document | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/validation.md | VAL-004 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |
| implementation/validation.md | VAL-005 | build | unverified | reviewed final owner, entrypoint, negative oracle, fresh bound evidence |

## All 77 acceptance rows

A passing similarly named test is only a candidate link, not full oracle coverage. The complete contract is retained below.

| ID | Disposition | Required oracle |
|---|---|---|
| T01 / N,A | Existing runtime/regression suite executed; full row oracle not certified | pinned source와 신규 구현 → baseline hash/import/schema/method inventory 검사 → architecture unchanged, native-v2 domain import 0, 허용 여섯 tables만 존재 |
| T02 / DB | Existing runtime/regression suite executed; full row oracle not certified | 새 DB → schema 적용, FK 확인, 재적용/잘못된 version → 최초 정상; 무단 재초기화/중복 migration 거절 |
| T03 / DB | Existing runtime/regression suite executed; full row oracle not certified | prepared/completed/delivery fixture → invalid enum/negative units/FK/잘못된 flag insert → constraint 또는 store invariant 거절 |
| T04 / IPC | Existing runtime/regression suite executed; full row oracle not certified | 유효 frame → byte별 쪼개기/여러 TCP-like chunk/UTF-8 split → 정확히 한 request 복원 |
| T05 / IPC | Existing runtime/regression suite executed; full row oracle not certified | malicious input → unknown fields/method/version/duplicate key/oversize length/invalid UTF-8/integer overflow, mutation request 누락, read/wait의 top-level request → preaccept 오류, bounded memory, effect 0 |
| T06 / IPC | Existing runtime/regression suite executed; full row oracle not certified | bundle/context stream → short/long/hash mismatch/timeout → 접수 없음; 같은 key 정확한 재전송 성공 |
| T07 / IPC | Existing runtime/regression suite executed; full row oracle not certified | 동일 actor/key/payload 동시 20개 → send → operation/message 하나, recipient당 한 delivery, 모든 receipt 동일 |
| T08 / IPC | Existing runtime/regression suite executed; full row oracle not certified | 같은 key 다른 body/C/to → 재호출 → REQUEST_KEY_REUSED, 최초 결과 불변; create accepted 뒤 host default 변경·same-key 재시도는 저장된 resolved spec 유지 |
| T09 / IPC | Existing runtime/regression suite executed; full row oracle not certified | accepted 뒤 response socket kill → CLI recovery → 동일 key 조회, duplicate effect 없음 |
| T10 / IPC | Existing runtime/regression suite executed; full row oracle not certified | 동일 자연어/commit이나 다른 key/to → submit/send → 별도 정당한 operation/mail; semantic dedup 없음 |
| T11 / AUTH | Existing runtime/regression suite executed; full row oracle not certified | 동일 host UID의 a/b/host process → a socket 경로 접근/연결 → 올바른 cgroup a만 허용 |
| T12 / AUTH | Existing runtime/regression suite executed; full row oracle not certified | old incarnation 연결 유지 → stop/restart/new run → old request/complete 거절, 기존 accepted fanout은 완료 |
| T13 / AUTH | Existing runtime/regression suite executed; full row oracle not certified | create 가능한 a → wire profile/capabilities 삽입(동일 default 포함)/sibling stop/principal impersonation → 거절; 정상 name/from/brief는 host childProfile과 위임 교집합으로만 확정, null childProfile 거절 |
| T14 / MAIL | Existing runtime/regression suite executed; full row oracle not certified | a,b stopped,c retired,d provisioning,Principal → commons → a,b만 저장; b inference 0; Principal/C/D 제외 |
| T15 / MAIL | Existing runtime/regression suite executed; full row oracle not certified | follow 없는 topic → 첫 post → archive 성공, recipientCount=0, topics view 존재 |
| T16 / MAIL | Existing runtime/regression suite executed; full row oracle not certified | topic follow/unfollow 및 다중 주소 → acceptance 도중 membership 변경 → transaction snapshot 고정, union dedupe, 과거 delivery 보존 |
| T17 / MAIL | Existing runtime/regression suite executed; full row oracle not certified | direct/list/multi-list 원문 → reply와 explicit to → 정확한 Reply-To/In-Reply-To/References; forged headers/CRLF 거절 |
| T18 / MAIL | Real SIGKILL primitive harness executed; actual entrypoint/full oracle remains unproven | eml stage 중 kill → restart → accepted 없음; orphan 비공개, 동일 key 재전송 가능 |
| T19 / MAIL | Real SIGKILL primitive harness executed; actual entrypoint/full oracle remains unproven | object fsync 후 T-send 전 kill → restart → unreferenced object 비공개, recipient 없음 |
| T20 / MAIL | Real SIGKILL primitive harness executed; actual entrypoint/full oracle remains unproven | DB accepted 후 archive 전 kill → restart → 동일 object/ID archive+snapshot recipients 전부 보충 |
| T21 / MAIL | Real SIGKILL primitive harness executed; actual entrypoint/full oracle remains unproven | A/B만 publish, B는 cur → C 전 kill/restart → C만 보충; B new 재생성 없음 |
| T22 / MAIL | Real SIGKILL primitive harness executed; actual entrypoint/full oracle remains unproven | link publish 후 materialized DB 전 kill → restart → 기존 hash 확인, 중복 파일 없이 flag 완료 |
| T23 / MAIL | Existing runtime/regression suite executed; full row oracle not certified | same-FS/cross-FS fixtures → deliver → hardlink 또는 fsynced atomic copy; bytes 동일, 모델 RO |
| T24 / MAIL | Existing runtime/regression suite executed; full row oracle not certified | forged approval text 및 ack → integrate 권한 조회 → 승인 변화 없음, ack는 자기 delivery만 변경 |
| T25 / BATCH | Existing runtime/regression suite executed; full row oracle not certified | pending 40개 두 class → prepare → 최대 설정 개수, 두 class fairness, max6 notice, full index, 원문 미절단 |
| T26 / BATCH | Existing runtime/regression suite executed; full row oracle not certified | prepared snapshot → 새 mail 도착 → 기존 IDs 불변, 다음 eligible batch에 남음 |
| T27 / BATCH | Real SIGKILL primitive harness executed; actual entrypoint/full oracle remains unproven | T-prepare 직후/cur 이동 직후 kill → new run → 동일 ID batch 회수, pending 영구 누락 없음 |
| T28 / BATCH | S-03/S-04: no verified actual Pi consumption/provider lifecycle | tool group 실행 중 direct 도착 → Pi steer → 모든 tool result 보존, 다음 LLM 전 notice, S-03 귀속 일치 |
| T29 / BATCH | S-03/S-04: no verified actual Pi consumption/provider lifecycle | successful agent_end 전 error/abort → complete 시도 → presented=0; 안전한 재안내 |
| T30 / BATCH | S-03/S-04: no verified actual Pi consumption/provider lifecycle | Pi receipt fsync 후 DB complete 전 kill → restart → 증명 가능하면 완료, 불충분하면 동일 ID 재안내; tool 자동 replay 0 |
| T31 / BATCH | S-03/S-04: no verified actual Pi consumption/provider lifecycle | 모델이 own session JSON/CLI cache 변조 → completion/새 effect 요청 → trusted receipt 위조 불가, key/hash/authority 재검증 |
| T32 / VIEW | Existing runtime/regression suite executed; full row oracle not certified | sandbox에서 inbox 읽기 → host atomic rename → 같은 mount에서 새 내용 보임; file bind stale inode 없음 |
| T33 / UNIT | S-03/S-04: no verified actual Pi consumption/provider lifecycle | new 기존 존재/runner idle → path enable → 한 runner 시작, 정상 drain 후 exit 0 |
| T34 / UNIT | S-03/S-04: no verified actual Pi consumption/provider lifecycle | runner busy 및 마지막 idle 검사 직후 mail → hint 유실 → boundary/path/timer 중 하나로 재발견, model polling 0 |
| T35 / UNIT | S-03/S-04: no verified actual Pi consumption/provider lifecycle | slot 모두 점유 → 새 runner → wait 유지, new 때문에 tight restart 없음, 취소 가능 |
| T36 / UNIT | Existing runtime/regression suite executed; full row oracle not certified | repeated failure → start-limit → reconcile 10회 → reset-failed 0; 명시 start 때만 reset |
| T37 / LIFE | Existing runtime/regression suite executed; full row oracle not certified | stop 처리 각 단계에 mail 도착 → stop 완료 → new 저장, cgroup 후손 0, 자동 inference 0 |
| T38 / LIFE | Existing runtime/regression suite executed; full row oracle not certified | cgroup 종료 확인 실패 → start → RUN_TERMINATION_UNKNOWN, incarnation 증가 없음 |
| T39 / LIFE | Existing runtime/regression suite executed; full row oracle not certified | create 각 durable 경계에서 kill → 동일 name/spec 재호출 → 한 clone/identity/unit/initial mail; 준비 전 broadcast 제외 |
| T40 / LIFE | Existing runtime/regression suite executed; full row oracle not certified | existing name/spec → 다른 key로 다른 resolved spec create(변경된 host default 포함) → AGENT_CONFLICT, 기존 workspace 보존 |
| T41 / LIFE | S-03/S-04: no verified actual Pi consumption/provider lifecycle | GOAL 없음 → bootstrap/create/reboot → resource 준비만, provider 호출 0; 최초 publish 뒤 활성화 |
| T42 / PR | Existing runtime/regression suite executed; full row oracle not certified | Principal offline + pending question → 새 mail 연속 도착 → relay new 전부 cur, 재시작 폭주 없음, Astra 호출 0 |
| T43 / PR | S-02: no isolated existing Human Pi attach/security acceptance | commons 100 + principal question1 → 기존 UI attach → commons 자동 주입0, 질문 동일 session 전달 |
| T44 / PR | S-02: no isolated existing Human Pi attach/security acceptance | attached session → second attach/reconnect → 중복 거절, authenticated reconnect 정상, Human history 보존 |
| T45 / SB | S-01: full real Pi/FD/PID-reuse/storage-cap profile not verified | actor sandbox → host home/DB/bus/other workspace/endpoint/credential/symlink 접근 → 모두 거절; own workspace만 RW |
| T46 / SB | S-01: full real Pi/FD/PID-reuse/storage-cap profile not verified | shell grandchild 생성/FD 탐색/network 접속 → stop/각 escape → 후손 종료, 불허 FD/network 없음 |
| T47 / SB | S-02: no isolated existing Human Pi attach/security acceptance | Principal 모든 tool entry/동적 extension → private session/host file 읽기 → model 경로에서 불가; 우회 발견 시 profile fail |
| T48 / INF | S-04: production provider codec/inference wiring not established | society/ancestor quota 경계 동시 requests → reserve → 상한 초과 예약 없음, 자식 quota 우회 없음 |
| T49 / INF | S-04: production provider codec/inference wiring not established | Resident slots/budget 포화 → Principal request → reserved capacity 사용, starvation 없음 |
| T50 / INF | S-04: production provider codec/inference wiring not established | provider stream 성공/429/전송전실패/전송후timeout/cancel → settle → 확정 비용만 정산, 불명확 unknown, auto replay0 |
| T51 / INF | S-04: production provider codec/inference wiring not established | provider 요청 직후 broker kill → restart/동일 ID → unknown 비용 보존, provider 재호출0 |
| T52 / INF,VIEW | S-02: no isolated existing Human Pi attach/security acceptance | private Human prompt에 sentinel secret → 정상/실패/로그 조회 → mail/journal/DB 공개 필드에 sentinel 없음 |
| T53 / GIT | Existing runtime/regression suite executed; full row oracle not certified | independent clones A/B → A refs/index/config 변경 → B·canonical 불변; process restart 뒤 A clone 유지 |
| T54 / GIT | Existing runtime/regression suite executed; full row oracle not certified | 큰 shared base+작은 C → submit → prerequisite bundle, 정확한 peer C/path fetch; 결과 크기 기록 |
| T55 / GIT | Existing runtime/regression suite executed; full row oracle not certified | C freeze 뒤 HEAD 이동/dirty tree → retry submit → 최초 C만 게시, dirty 자동 commit 없음 |
| T56 / GIT | Existing runtime/regression suite executed; full row oracle not certified | malformed bundle/additional main ref/missing prerequisite/host config injection → submit → canonical refs 불변, 제한 sandbox 실패 |
| T57 / GIT | Existing runtime/regression suite executed; full row oracle not certified | durable bundle 접수 뒤 kill → restart → 동일 published ref/C/result message로 완료 |
| T58 / GIT | Existing runtime/regression suite executed; full row oracle not certified | published ref 후 mail 전/response 전 kill → restart → result mail 하나, 같은 receipt |
| T59 / GIT | Existing runtime/regression suite executed; full row oracle not certified | published ref에 다른 OID → reconcile → conflict, 자동 overwrite 없음 |
| T60 / INT | Existing runtime/regression suite executed; full row oracle not certified | B에서 분기한 두 published C → 동시 integrate → CAS 하나만 성공, 다른 요청 STALE_BASE+actual |
| T61 / INT | Existing runtime/regression suite executed; full row oracle not certified | published 아닌 C/not descendant/protected path/check fail → integrate → main 불변, 정확한 error |
| T62 / INT | Existing runtime/regression suite executed; full row oracle not certified | check 동안 policy/main 변경 → CAS 시도 → 재검사로 거절, 이전 검사로 승인하지 않음 |
| T63 / INT | Existing runtime/regression suite executed; full row oracle not certified | CAS 직전/직후/DB done 전 kill → restart → base면 재검사, C면 완료, 제3 OID면 unknown+main write block |
| T64 / INT,LIFE | Existing runtime/regression suite executed; full row oracle not certified | accepted integrate 후 stop, CAS 전/후 각각 → reconcile → 전이면 취소, 후이면 성공 대조; rollback 없음 |
| T65 / CTX | Existing runtime/regression suite executed; full row oracle not certified | context stream에 ../·symlink·missing GOAL·hash mismatch → publish → 접수/파일 escape 없음 |
| T66 / CTX | Existing runtime/regression suite executed; full row oracle not certified | context CAS 후 snapshot/link/mail 전 각 kill → restart → 같은 revision/view/notification 복구, source raw Human 미복사 |
| T67 / CTX | Existing runtime/regression suite executed; full row oracle not certified | 동시 publish 같은 expected → 결과 → 하나 성공, 다른 CONTEXT_CONFLICT; docs는 fixed revision으로 일관 |
| T68 / REC | Existing runtime/regression suite executed; full row oracle not certified | accepted states 전체 fixture → broker 재시작 → READY 전 old cgroup 정리/효과 대조, duplicate dispatch 없음 |
| T69 / REC | Existing runtime/regression suite executed; full row oracle not certified | 원문 삭제/hash 손상/SQLite 손상 → startup → STORE_CORRUPT, 빈 DB 초기화/false success 없음 |
| T70 / REC | Existing runtime/regression suite executed; full row oracle not certified | ENOSPC를 각 write/fsync 전후 주입 → receipt → preaccept false success 없음; accepted는 pending 복구 |
| T71 / REC | Existing runtime/regression suite executed; full row oracle not certified | quiescent backup → clean restore → accepted mail/Git/DB/session 연결 일치, view/index 재생성 |
| T72 / REC | S-06: no isolated VM, hypervisor tools or /dev/kvm available; host power-off is not authorized | 별도 VM의 accepted 직후 power cut → restart → S-06 지원 profile의 내구성 oracle 충족; SIGKILL과 분리 보고 |
| T73 / CLI | Existing runtime/regression suite executed; full row oracle not certified | 일상 send/reply/submit/조회 → 모델 실행 → 본문 Linux commands로 접근, UUID 수동 조합/DB 관리 불필요 |
| T74 / NEG | Existing runtime/regression suite executed; full row oracle not certified | command/schema/source inventory → architecture audit → 금지 entity/service/workflow/command0, 생산 LOC 계산 일치 |
| T75 / OPT-INDEX | Existing runtime/regression suite executed; full row oracle not certified | optional index 없거나 손상 → search/delivery → rg 동작, mail delivery 지속, index 재생성 |
| T76 / OPT-APPROVAL | S-08/S-10: attestation/floor contracts OPEN; base is not tiered | profile 활성 fixture → tuple 변경/중복 actor/자식/위조/revoke → S-08 policy 정확 평가; 기본 build엔 commands/table 없음 |
| T77 / INF,S-09 | S-09: no fixed evaluation corpus/real multi-condition results | 사전 고정 evaluation corpus → 3조건 반복 → 품질/비용/Principal tokens/전체 tokens/latency 각각 결과, 미달 숨김 없음 |
