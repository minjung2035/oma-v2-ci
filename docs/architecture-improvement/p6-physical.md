# P6 — independent physical integrity and admin entry

Base: `aeeafd9b124032e28b417a3aab21aea640983e33`.
The engine combines the prior independent ledger evaluator with bounded read-only
filesystem, canonical Git and optional live unit observations. It never invokes
reconcile, materialization, chmod/fsync, unit start/stop or a provider.

## Administrator usage

```sh
node scripts/check-state.mjs --state /absolute/state/root --society NAME --mode offline --quiesced
node scripts/check-state.mjs --state /absolute/state/root --society NAME --mode live
```

Build the source first. `--quiesced` is the operator's assertion that mutations
have stopped; the tool does not stop services. Both modes re-read the ledger
around physical observation; changes make the combined result UNKNOWN instead
of asserting atomic host consistency. Exit 0=PASS, 1=FAIL, 2=UNKNOWN. These are
administrator-script outcomes, not new public oma commands or wire errors.
There is deliberately no repair option. JSON output contains bounded issue IDs,
not raw mail bodies, credentials, DB rows or unbounded subprocess stderr.

## Checks

Immutable mail objects are checked against size/hash and frozen EML header
relations. Archives/inboxes retain accepted message ownership, exact byte hashes,
new/cur uniqueness and materialized/presented flags. Pending publication gaps are
reported as pending, not terminal failures. Failed parent publication, orphan
public names, missing immutable evidence and malformed relations are failures;
unaccepted object orphans are UNKNOWN and are never deleted.

Context snapshots require their exact names, content, modes, single-link policy
and current pointer. Successful/published context candidates additionally have
their actual Git tree paths and blob bytes compared to the frozen manifest.
Published submission refs must equal their accepted candidate. Historical
successful integrations must remain ancestors of current main, not equal today's
main. Missing/ambiguous command observations never prove absence or success.
Live unit reads use the existing unit parser and never certify cgroup death.

The physical observer holds a checked descriptor while hashing and detects inode,
size and nanosecond timestamp changes. It bounds per-file/aggregate bytes and
directory entries. Commands use the existing process owner, fixed read-only argv,
sanitized environments, per-command/aggregate time, count and output bounds.
Git network protocols, optional locks, replacement objects, lazy fetch and
interactive prompting are disabled in the diagnostic environment.

## Decisions and compatibility

D11: keep diagnostic policy independent of workflow recovery; share only pure
identity/header/row and command-output parsers. Three supporting type imports
(mail facts/addresses and unit observations) now use their existing precise
contract owner. Their transpiled runtime bytes are identical to the source-pinned
baseline; no original wire, error set, plan/schema field or gate changed.

The new header check exposed a fixture using GMT rather than the existing parser's
canonical +0000 Date representation. The fixture now uses the existing date
formatter; production validation was not weakened to admit the bad fixture.
The real Git adapter also exposed the independently committed stdin-encoding bug,
documented in p0-stdin-encoding.md. No duplicate native-spawn owner was added.

## Executed verification

Node 22.16.0, TypeScript 5.8.3, @types/node 25.1.0. Strict semantic compilation of
the diagnostic, Store, units/process and migrated coordinator closures has zero
errors, with noUncheckedIndexedAccess/exactOptionalPropertyTypes enabled.
The combined serial run has **54 PASS, zero fail/cancelled/skipped/todo**:
31 diagnostic tests, 16 existing coordinator/SQLite transition tests, 3 stdin
regressions and 4 import migration tests. Real temporary SQLite files, filesystem
objects, Git repositories and the standalone admin command were used. The live
bus-negative test deliberately uses an unavailable real bus; it is not positive
systemd/cgroup proof. Raw TAP and source digests are under evidence/p6-physical.*.

```sh
node --test --test-concurrency=1 test/integrity-ledger.test.mjs test/integrity-files.test.mjs test/diagnostic-admin.test.mjs test/integrity-publications.test.mjs test/coordinator-facets.test.mjs test/operation-transition-characterization.test.mjs test/process-input-encoding.test.mjs test/contract-migration-seams.test.mjs
```

P6 implementation and focused oracles are present; P5 full graph enforcement and
P7 deterministic fault/recovery matrices are separate units. Full pinned P0,
release/OPEN gates, hostile concurrent parent containment and VM power-loss proof
are not claimed. Read-only SQLite may participate in SHM locking; this is not a
zero-kernel-metadata-side-effect promise. No accepted evidence is rewritten.
