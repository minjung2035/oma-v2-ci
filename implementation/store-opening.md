# Store opening: compatibility before writer setup

`src/store.ts` owns this boundary. This is a C1 correction, not a schema migration,
a second writer, a new recovery service, or a live-authority decision. Current
verification status belongs exclusively to [validation.md](validation.md).

## Preconditions and phases

The broker startup composition must already hold its process/society single-writer
fence. File identities and a successful schema observation do not establish that
authority. The no-mutation refusal contract concerns closed/quiescent database
artifacts under that ownership; it is not protection against an independent writer
or same-UID operator concurrently changing the files.

1. **Identify the path and existing evidence.** The Store API takes a filesystem
   path (or the existing `:memory:` special case), not a SQLite URI. Database and
   sidecar leaves must be regular, singly linked files. A different hard-link name
   can hide the original name's WAL; it is not an alternate safe database identity.
   The native reader URI is constructed internally with URL escaping.
2. **Inspect compatibility without writer setup.** Observe the database, `-wal`,
   `-shm`, and `-journal` identities. Missing database plus sidecars is unavailable,
   not a new database. A journal, or an incomplete WAL/SHM pair, is preserved and
   refused rather than recovered, deleted, or treated as absent.
3. **Read the actual SQLite view.** With existing WAL and SHM, use the read-only
   Unix-VFS `readonly_shm=1` path. Never ignore those files with `immutable`.
   Only when all sidecars are absent, under the startup fence, use a read-only
   immutable main-file view to avoid SQLite creating empty WAL/SHM files during
   the compatibility query. Recheck file identities and sidecar absence before
   writer setup. This conditional absence check is not an immutable fallback after
   a failed WAL read, and is not a substitute for the startup fence.
4. **Apply the explicit format boundary.** Read `user_version` through SQLite,
   using the existing readable-version registry and integer decoder. An
   unversioned database is eligible for initialization only when `sqlite_schema`
   is empty. An arbitrary version-zero database with objects is not a fresh OMA
   database. A corrupt header or unavailable native observation does not authorize
   migration. Close the observation connection before opening the writer.
5. **Set up the one writer.** Only after compatibility admission, apply the
   existing foreign-key, WAL, FULL synchronous, and busy-timeout PRAGMAs, then the
   existing v1 migration and reader/transition/journal composition. Supported-v1
   reads still go through the existing relational decoders.
6. **Transfer ownership only on successful construction.** Until then the
   constructor owns the native connection and closes it on every subsequent
   throw. The broker lifetime can retain only a successfully returned Store.

The SQLite option is native-backend behavior, not a portable property of
`readOnly: true`. Runtime qualification must exercise the actual Node/SQLite/VFS
combination, including retained WAL whose committed version differs from the main
header. A pre-existing writable SHM node in the same process is not the closed-file
startup condition: the VFS can reuse that node. The opening helper does not grant
permission to share a live writer or open arbitrary concurrently managed SQLite
connections. The administrator's `readDiagnosticSnapshot` remains a separate,
bounded read-only diagnostic path; it is not a Store writer and does not inherit a
claim that SQLite never touches diagnostic sidecars.

## Failure and resource ownership

Unsupported versions are rejected before writer PRAGMAs, recovery, or DDL. Missing
or ambiguous evidence remains unavailable. Native SQLite errors retain their
native cause; an I/O/locking error is not evidence of absence. Compatibility refusal
does not request repair, deletion, or renaming of a sidecar. After a supported
database is admitted, normal SQLite writer checkpoint/sidecar behavior still
applies, including during cleanup of a later initialization failure.

Migration rollback is attempted only while the native connection still reports a
transaction. Its primary failure and any rollback failure remain in the cause
chain. If constructor cleanup also fails, preserve both initialization and close
failures. A close failure does not prove termination or authorize automatic replay;
retain the artifacts and follow the failed-startup lifetime policy.

A closed JavaScript SQLite handle need not immediately remove every native file
descriptor while another same-process connection holds a POSIX file lock. SQLite
can defer native closes so that closing one connection does not release the other
connection's locks. The resource oracle therefore checks handle closure, an
independent process's inability to acquire the held writer lock, and the descriptor
baseline after the final lock owner closes. Never force-close those descriptors to
make an intermediate count match.

A compatible read-only view does not establish write availability. Permission
denial can be observed during writer setup or at the first write transaction.
POSIX permission-denial fixtures are not read-only-mount/EROFS, storage-power-loss,
or manager-lifetime qualification.

## Transaction and relational boundaries retained

The opening change does not replace `TransactionScope` or create a second mutation
path. Its `AsyncLocalStorage` context, exact Store owner, captured active scope,
and invalidation on exit remain connected to compatibility methods and write
facets. Admission checks and the original-acceptance-only plan rule remain in that
scope. A Promise/thenable result is still refused before commit; rollback cannot
cancel an external effect already started by an invalid asynchronous callback.

`Store.transaction` still checks newly inserted operations through the full reader
and validates pending transitions before COMMIT. `LedgerReader` retains its row,
operation, batch, incarnation, and delivery-link checks. No schema-version refusal
weakens valid-v1 decoding, introduces a header-only trusted row, changes a receipt
format, or grants stale live authority. Normal transaction error handling outside
constructor/migration initialization is unchanged by this work.

The production-linked cases are in `test/store-open.test.ts` (V04A/V04B), alongside
existing `r10-ledger-rows`, `r11-transactions`, `r12-ledger-transitions`,
`r17-lifetime`, and `persisted-format-boundary` regressions. Fixture observations use
physical artifact identities/bytes and native SQLite handles, not an expected
result copied from the production preflight.

## Compatibility and rollback

The v1 DDL, readable/written format registry, wire contract, and live fencing are
unchanged. Ordinary new databases, existing supported-v1 DELETE databases, and
supported-v1 WAL databases retain their normal path. Unknown, corrupt, aliased, or
unavailable inputs are not silently initialized. The sidecar-preserving refusal is
intentionally stricter than allowing SQLite to recover an unknown database first.

Reverting the code is not a rollback of durable database facts. It can restore the
old writer-PRAGMA-before-refusal behavior. Preserve the database and its sidecars
together for an explicit, quiesced recovery decision; do not make an unsupported
input appear supported by deleting evidence, changing `user_version`, or copying
only the main database file. No automatic downgrade or operational recovery action
is authorized by this document.
