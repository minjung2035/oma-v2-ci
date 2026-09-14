# P0 follow-up — preserve the hash domain across typed crypto overloads

The first complete semantic check of the restored Store/codec closure reproduced
TS2345 in `sha256Hex`: passing a string-or-Uint8Array with an explicit encoding
selects the string overload. Runtime tests happened to pass because Node ignores
that encoding for binary input. The helper now narrows strings explicitly and
passes binary views without an encoding. No bytes, normalization, algorithm or
persisted hash domain change. No assertion cast or typings downgrade was used.

Decision D07: this is a separate compatibility correction, not an architecture
or wire/format change. Node's documented `hash.update` accepts TypedArray input
and ignores its encoding argument (https://nodejs.org/api/crypto.html#hashupdatedata-inputencoding).

After correction, a semantic `tsc --noEmit --strict --noUncheckedIndexedAccess
--exactOptionalPropertyTypes --target ES2022 --module NodeNext --moduleResolution
NodeNext --types node src/store.ts` exits 0. It checks the actual transitive source
closure, not transpile-only stubs. Environment: Node 22.16.0, TS 5.8.3 and
@types/node 24.0.4. It is NOT the 5.9.3/26.x pinned whole-repository typecheck.

Four hash tests cover known empty/abc SHA-256 digests, UTF-8, non-ASCII, embedded
NUL, surrogate encoding, view offsets and binary non-mutation. With the 12 SQLite
and 18 public-wire tests: 34 pass, zero fail/cancelled/skipped/todo. Full P0 and
host-dependent gates remain separately recorded; this result does not close them.
