# P6 — independent read-only integrity engine (pinned 재검증)

제안서 §11의 P6은 구현이 HEAD에 이미 존재했고, 이번 세션에서 **pinned 환경(Node v26.7.0 / TypeScript 5.9.3)에서 실제 state root로 재검증**했다.

## 1. 구성

| 파일 | 역할 |
|---|---|
| `src/diagnostics/ledger.ts` | 닫힌 row 검증과 cross-row relation. `reconcile`/`Store` write를 import하지 않는다 |
| `src/diagnostics/integrity.ts` | phase-aware read-only 점검. `inspectLedger`가 PASS가 아니면 물리 관측을 시작하지 않는다 |
| `src/diagnostics/files.ts` | bounded filesystem 관측(byte/entry budget 공유) |
| `src/diagnostics/mail.ts` | mail header/object relation |
| `scripts/diagnostic-observers.mjs` | Git ref/commit/ancestry 관측 adapter |
| `scripts/check-state.mjs` | 관리자 CLI. public `oma` subcommand가 아니며 repair mode가 없다 |

검사 범위: DB closed-row/relation, operation↔result relation, message/delivery/batch/usage relation, immutable mail hash, archive/inbox relation, published Git ref, context snapshot/current, agent spec/hash. `mode=offline|live`를 구분하고, live에서는 unit 관측을 추가하되 SQLite snapshot이 파일 관측을 freeze하지 않는다는 경고를 남긴다.

## 2. 재검증 결과 (fresh evidence)

`docs/architecture-improvement/evidence/p6-live-verification.json` — 실제 temporary state root에 accepted `mail.send` 하나를 만들고(object 0444, archive `cur/<id>:2,`, inbox `new/<id>`, delivery materialized) admin CLI를 실행했다.

| 시나리오 | 결과 |
|---|---|
| clean state, `--mode offline --quiesced` | **PASS**, exit 0, scanned = agents 1 / operations 1 / deliveries 1 |
| archive bytes를 corrupt로 교체 후 재실행 | **FAIL**, exit 1, `MAIL_OBJECT_INVALID` + `MAIL_ARCHIVE_INVALID` + `INBOX_NEW_INVALID` |
| clean scan이 파일/row를 바꿨는가 | **아니오** (`noRepairOnClean: true`, `rowsUnchangedByCleanScan: true`) |
| corrupt scan이 repair를 했는가 | **아니오** (`noRepairOnCorrupt: true`) |

보고서의 `scope`는 스스로를 `read-only bounded observations; not release, provider, cgroup-death or power-loss proof`로 한정한다.

## 3. focused suite 재실행

```sh
node --test test/integrity-ledger.test.mjs        # 10 pass / 0 fail
node --test test/integrity-files.test.mjs         # 11 pass / 0 fail
node --test test/integrity-publications.test.mjs  #  3 pass / 0 fail
node --test test/diagnostic-admin.test.mjs        #  7 pass / 0 fail
```

## 4. 남은 경계

- 실제 systemd/cgroup이 있는 live 관측(unit 상태, cgroup population)은 이 환경에서 실행하지 않았다. `mode=live`의 unit 관측은 NOT_RUN이다.
- offline 관측은 operator가 quiescence를 주장한 상태를 전제한다. 동시 변경이 감지되면 `UNKNOWN`으로 남기고 atomic consistency를 주장하지 않는다(코드 경로 확인).
- P6은 repair/materialize/reconcile을 호출하지 않는다. 이 성질은 `test/integrity-*.test.mjs`와 위 evidence가 함께 고정한다.
