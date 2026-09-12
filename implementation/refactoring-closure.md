# R37–R39 리팩터링 종료 기록

상태: **카드 처리 기록 / 실행 검증 NOT_RUN / release 미인증**.

이 문서는 `architecture.md` §21.1의 개념적 모듈과 `implementation-spec.md`의 기존 계약을 현재 source owner에 연결하는 비규범적 구현 기록이다. 새로운 MUST, service, role, wire method, durable state 또는 migration을 정의하지 않는다. 상충하는 경우 기존 규범과 D01–D12의 확정 경계를 우선한다.

## 1. 소스 기준과 확인 범위

첨부 계획의 분석 기준은 `5b4ffe1238af00aac4a569a5c4d7d9e71092dea0`이다. 이번 요청은 이미 진행된 R37 중간 상태에서 시작했으며, 이전 카드를 처음부터 다시 구현하지 않았다. R37 종료 marker는 `7875afbbe71ae44a65415648774e7f9b95fa4b34`이다. R39의 최종 commit은 `HANDOFF.md`를 갱신하는 `R39 DONE_WITH_BLOCKED_SUBSTEPS:` marker로 식별한다. 문서 자신의 commit SHA를 예측하여 적지 않는다.

저장소 읽기·쓰기·commit은 GitHub plugin action으로 수행했다. 테스트, 빌드, 정적 검사 스크립트, LOC 도구, 설치 및 native probe는 실행하지 않았다. source/commit 읽기와 실제 쓰기 성공 확인을 runtime 시험으로 세지 않는다.

## 2. 현재 책임과 호출 경로

| 개념적 경계 | 현재 owner와 연결 | 소유하지 않는 책임 |
|---|---|---|
| 외부 프로세스 command/observation | `process/command.ts`, `process/async.ts`, `process/run.ts`; `PreparationExecutor`가 workflow별 bounded admission 소유 | DB intent, receipt, 권한, 임의 descendant death proof |
| Git 제출 | `GitModule.submit` → `SubmitCoordinator` → `QuarantineImporter` → canonical publication observation | import child exit만으로 ref 공개/승인 인증 |
| main 통합 | `GitModule.integrate` → `IntegrationCoordinator` → `compareAndSwapCanonicalRef` | 새 tier evaluator, approval/floor persistence |
| context | `ContextCoordinator` → `ContextRepository` 및 `ContextPublicationObserver` → canonical CAS → snapshot/current → mail | 새로운 candidate를 만들어 과거 accepted plan 대체 |
| 생성 | `CreateCoordinator` → `WorkspaceCoordinator` → `CreationPublicationObserver` → `UnitsModule`/mail | linked create의 두 번째 workspace/unit/message 생성 |
| systemd | `units/render.ts`는 text, `units/execute.ts`는 command, `units/observe.ts`는 facts, `UnitsModule`은 고정 unit coordination | 비동기 show 결과를 새로운 run 발급의 사망 증거로 승격 |
| 복구 | `ReconcileModule` → `OperationRecovery` 및 각 effect coordinator | 무제한 concurrent sweep, unknown을 absence/success로 변환 |
| 프로세스 수명 | broker entry → `BrokerLifetime`; `settleWithin` → `preparationShutdownBarrier` | 불확실한 native child를 잊고 writer lock 해제 |
| 증거 도구 | `traceability.mjs`, `compliance.mjs`, `adversarial-report.mjs`; 별도 `source-owners.json` | runtime ledger 또는 실행하지 않은 proof 생성 |

표의 경로는 `src/` 기준이며 scripts와 implementation 파일만 별도 표기했다. 개념적 facade는 유지되고 독립 daemon/controller는 추가하지 않았다. 실제 설치 entrypoint, asset 복사 및 의존성 확인은 R38의 `scripts/build.mjs`/`scripts/check-package.mjs`에 연결되며, 설치된 `dist/src/entry/*` 실행 검증은 이번 작업에서 NOT_RUN이다.

## 3. 준비·접수·효과·정산의 구분

### Git/context

제출은 frozen bundle/accepted intent를 유지한 채 격리 준비 Promise를 실제 호출자까지 반환하고 기다린다. 준비 후 current actor와 live lease를 다시 확인하고, 최종 publication/CAS는 `await` 없는 구간에서 수행한다. child exit가 알려졌다는 사실은 canonical ref가 기대 값이라는 관측과 별개다.

context는 입력 manifest를 복사·고정하고 비동기 Git 준비가 끝난 뒤 actor와 expected ref를 재검사한다. mail 렌더링 등 추가 대기 뒤에도 acceptance 직전 expected ref와 transaction 내부 authority/recipient snapshot을 재확인한다. 접수된 candidate/base/entries는 recovery에서 다시 계산하지 않는다. CAS 후 canonical ref → snapshot/current → 고정 알림 → terminal receipt 순서를 유지한다.

main writer는 한 작업만 admission에 들어간다. 추가 호출은 `BROKER_UNAVAILABLE`로 거절되며 동일 request key를 유지해야 한다. 이는 이전의 대기 promise chain을 무한히 보존하지 않도록 한 명시적 동작 변경이다. pending/unknown DB operation의 독립적인 writer barrier는 제거하지 않았다.

### 생성

기존 중간 코드에서 누락된 `await workspace.ensure(plan)`을 연결했다. workspace 준비 후 accepted plan JSON, child spec hash, incarnation을 다시 읽는다. 정상 요청에는 원래의 live lease를 유지하고 현재 정책으로 같은 child spec인지 재검사한다. recovery는 live auth를 위조하지 않고 별도의 accepted-intent 정책을 사용한다.

unit 공개/ready, gated initial mail, activation은 workspace 준비 완료 이후다. mail 대기 후에도 current authority/identity/desired/GOAL/activation 조건을 검사한다. 같은 creation completion은 합류하고 다른 accepted creation은 busy로 남겨 durable intent를 보존한다. connection 종료나 취소가 accepted workspace/bundle 증거를 임의 삭제하지 않는다.

### 관측과 종료

startup의 canonical fsck 및 sweep의 read-only systemctl show는 bounded async 실행을 사용한다. fsck 뒤에는 old-run death를 다시 확인한다. unit show 뒤에는 현재 role/spec/incarnation/desired를 다시 읽고, start 직전 동기 관측을 수행한다. `confirmDead`와 Store incarnation reader binding은 별개로 유지한다.

`ProcessTask.result`는 bounded observation이고 `closed`는 실제 direct-child/pipe close다. timeout/abort/signal/output overflow 또는 관측 실패를 exit-zero success로 바꾸지 않는다. 불확실한 준비 작업은 해당 executor와 프로세스 수명의 shutdown barrier에 남는다. logical request Promise가 끝났다는 사실만으로 Store/lock을 닫지 않는다. 기존 shutdown grace 안에 확정할 수 없으면 실패 상태에서 writer 자원을 유지하고 프로세스 종료 경로에 맡긴다. 이것은 임의 descendant death나 kernel quota 인증이 아니다.

## 4. 호환성과 유지한 게이트

| 계약 | 이번 변경의 처리 |
|---|---|
| wire v1, frame 순서, method/error/receipt 집합 | 변경하지 않음. busy/unknown은 기존 closed code를 사용 |
| 여섯 DB entity, schema version, immutable accepted plan | 변경하지 않음. worker가 Store를 소유하지 않음 |
| operation/message/request identity, request hash, 원래 terminal JSON bytes | 재발급·재직렬화 migration을 추가하지 않음 |
| context candidate와 frozen manifest, 기존 create link | 같은 accepted facts로 복구. 새 candidate로 보정하지 않음 |
| legacy integrate plan/result decoder | 기존 관계 검증 호환 경로 유지. old row를 새 format으로 rewrite하지 않음 |
| fixed systemd unit과 allowed service | 유지. transient candidate executor를 추가하지 않음 |
| resource limits | 기존 timeout/output/grace만 사용. 새 host-config budget/무제한 queue/sidecar 없음 |
| filesystem durability | rename/fsync 순서 유지. 긴 fsync 및 최종 canonical 검사까지 전부 nonblocking으로 바꿨다고 주장하지 않음 |
| S-01/S-03/S-04 및 candidate check | OPEN 또는 unsupported adapter의 fail-closed 경계 유지 |
| S-08/S-10/S-11 | approval/challenge/floor/strict clean-room 지원 추가 없음 |

현재 코드가 typecheck, 독립 golden bytes 또는 실제 legacy DB 복구를 통과했다는 실행 증거는 없다. 위 표는 source 변경 범위를 읽어 확인한 내용이며 실행 결과를 대신하지 않는다.

## 5. 회귀시험과 기존 시험의 수정

| 파일 | 작성한 oracle | 실제 증명하지 않은 것 |
|---|---|---|
| `test/r37-async-process.test.ts` | frozen argv/env/input, event-loop yield, output bound, timeout/abort, singleton uncertainty | latency/RSS 개선 수치, 임의 process-tree 사망 |
| `test/r37-preparation-boundaries.test.ts` | submit Promise 전달, accepted 증거 보존, context 정상 대조군/revoke/base race, create workspace 후 권한 재검사 | 전체 broker/systemd/Pi crash matrix |
| `test/r37-recovery-observation.test.ts` | 지연 관측 중 stop/incarnation/shutdown/unknown 변경 | 실제 systemd 관측의 kernel 정확성; scripted unit port와 구분 |
| `test/r37-shutdown-observation.test.ts` | 정상 native 종료 전 lock 유지, unknown 결과 후 Store/lock 미해제, 초기 config 실패 cleanup | 강제 전원단절/host reboot |
| `test/traceability-policy.test.mjs` | 동일 fingerprint 보존, owner 변경 시 invalidation, 독립 core/tiered inventory | full-clause runtime compliance |
| `test/compliance.test.ts` | 정상 structural 대조군과 missing/stale/extra/duplicate/dependency/import 변형 | 실제 production evidence 자체 |
| `test/acceptance-auth.test.ts` | 기존 권한 race/recipient winner oracle 보존 | 새로운 일반 replay auth 우회 |

기존 acceptance-auth fixture의 fake spec hash와 두 society 혼용을 정상 constructor/단일 society로 정리했다. context의 frozen spec만 바꾸던 손상 fixture는 live capability revoke로 바꾸어 의도한 권한 검사를 겨냥했다. `publishGated` interceptor는 publication proof를 포함한 모든 인자를 전달한다. negative assertion을 삭제하거나 timeout으로 제품 실패를 감추는 변경이 아니다. 각 시험은 **NOT_RUN**이다.

## 6. Trace와 증거의 상태

`implementation/source-owners.json`은 검토한 경계의 수동 source locator다. `traceability.json`의 digest 또는 runtime proof를 수동으로 재생성한 파일이 아니다. checker는 실제 current clause와 일치하는 명시적 link만 적용한다. 동일 fingerprint와 동일 link의 record는 보존하고, 바뀐 owner/entry/call path/test는 `unverified`, `evidence:null`, `verification:NOT_RUN`으로 취급한다.

검토하지 않은 규범은 추측한 owner/test로 채우지 않았으며 UNLINKED/unverified 상태를 유지한다. 따라서 이 작업은 전체 조항의 authoritative owner 감사나 behavioral proof를 완료했다는 선언이 아니다. 원본 trace/generated report와 LOC inventory 재생성도 실행하지 않았다.

compliance는 기존 generated manifest만 신뢰하지 않고 실제 source/test/tool/dependency closure와 evidence pin을 대조하도록 수정했다. 새로운 helper/test나 import escape가 오래된 proof 뒤에 숨지 않아야 한다. report는 inventory와 실제 build/test를 구분하며 과거 raw log를 현재 source hash에 재결합하지 않는다.

T01–T77 core와 T78–T90 tiered target은 각각 실제 규범 table row로 계산한다. prose의 T78–T90 언급, 같은 ID 중복, 숫자 상수 변경은 missing oracle을 채우지 않는다. 현재 읽은 core matrix와 policy에는 target 요구의 참조는 있으나 target table의 완전한 존재를 확인하지 못했다. generator는 빠진 row를 명시하고 실패하도록 작성했으며 실제 결과/분모는 **NOT_RUN**이다. 미확정 target oracle을 새로 발명하지 않았다.

## 7. 남은 검증·범위 밖 substep

- `NOT_RUN`: typecheck/build/package/architecture/transaction 검사, fast/durable/kernel/crash/property/stress/all lanes, LOC/cloc fixture, trace inventory/report/compliance, 실제 Pi/provider, VM power loss, 성능 비교.
- `BLOCKED_SUBSTEP(D05/D09/D10)`: 새 kernel/resource primitive가 필요한 candidate 실행 또는 임의 descendant 사망 인증. 기존 지원 경계만 유지하며 native 불확실성은 보존한다.
- `BLOCKED_SUBSTEP(D01/D09)`: S-03/S-04와 S-08/S-10/S-11의 미확정 계약·실제 환경 인증. helper나 새 test file만으로 gate를 해제하지 않는다.
- `UNVERIFIED`: 전체 규범의 남은 owner/negative-oracle 연결 검토, 설치 entrypoint부터의 실제 실행 증거, 역사적 source pin의 현재 적합성. 일부 연결을 추가했다는 사실을 전체 trace 완성률로 환산하지 않는다.
- `NOT_RUN / STALE`: 현재 production inventory와 LOC. 과거 숫자를 현재 budget 충족 근거로 쓰지 않는다. 8,000 목표와 10,000 초과 review 조건은 그대로다.

R37/R39의 DONE 계열 marker는 중단 뒤 재개 위치용이다. runtime PASS, 출시 승인 또는 미검증 범위 소멸을 의미하지 않는다.
