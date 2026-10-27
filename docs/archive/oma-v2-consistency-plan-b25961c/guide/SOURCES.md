# Source 근거 원장

대상: `minjung2035/oma-v2` / `refactor/safety-preserving-architecture` / `b25961cc46532f5e30ff60cc381fed51c59d13ab`. HEAD는 계획 작성 시 GitHub connector로 재확인했다.

READ_THIS_PASS는 이번 요청에서 해당 scope를 다시 읽었다는 뜻이며, 전체 파일을 보았는지는 scope 열로 판단한다. READ_PRIOR_SAME_SHA는 이 대화의 이전 검토를 같은 고정 SHA에 한해 사용한다. SCOPE_ONLY는 파일 존재와 검토 담당만 확인했다. 모두 제품 실행 결과와 다르다.

Repository URL에는 임시 download token을 포함하지 않는다. 새 구현의 current source는 이 고정 링크와 다를 수 있으므로 WP00에서 diff를 확인한다.

<a id="s01"></a>

## S01 — `MAINTENANCE.md`

**검토:** READ_THIS_PASS. 1–440행: Fact/Relation/Phase, 규범 우선순위, 복구·검증 규율.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/MAINTENANCE.md)

<a id="s02"></a>

## S02 — `implementation/schema-v1.sql`

**검토:** READ_THIS_PASS. 전체: 기존 6개 entity와 v1 state/constraint.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/implementation/schema-v1.sql)

<a id="s03"></a>

## S03 — `src/storage/transaction.ts`

**검토:** READ_PRIOR_SAME_SHA. scope capability와 synchronous result; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/storage/transaction.ts)

<a id="s04"></a>

## S04 — `src/storage/operation-codec.ts`

**검토:** READ_PRIOR_SAME_SHA. raw row → checked relation/union 경계; 이전 부분 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/storage/operation-codec.ts)

<a id="s05"></a>

## S05 — `src/domain/errors.ts`

**검토:** READ_PRIOR_SAME_SHA. phase/effect knowledge 오류 분류; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/domain/errors.ts)

<a id="s06"></a>

## S06 — `src/broker.ts`

**검토:** READ_PRIOR_SAME_SHA. dispatch quota, openRun, drain/lease; 이전 주요 경로 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/broker.ts)

<a id="s07"></a>

## S07 — `src/storage/transitions.ts`

**검토:** READ_PRIOR_SAME_SHA. reassignPreparedBatches/completeBatch; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/storage/transitions.ts)

<a id="s08"></a>

## S08 — `src/storage/delivery-receipt.ts`

**검토:** READ_PRIOR_SAME_SHA. 영수증 읽기·관측·exclusive publication; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/storage/delivery-receipt.ts)

<a id="s09"></a>

## S09 — `src/mail/batches.ts`

**검토:** READ_PRIOR_SAME_SHA. prepare/complete/derived view; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/mail/batches.ts)

<a id="s10"></a>

## S10 — `src/runner.ts`

**검토:** READ_PRIOR_SAME_SHA. consume의 receipt 우선 경로와 confinement; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/runner.ts)

<a id="s11"></a>

## S11 — `src/runtime/principal-delivery.ts`

**검토:** READ_PRIOR_SAME_SHA. tick/deliverOne의 재시도와 receipt; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/runtime/principal-delivery.ts)

<a id="s12"></a>

## S12 — `src/tui/session.ts`

**검토:** READ_PRIOR_SAME_SHA. turn owner·waiting·unanswered·completion; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/tui/session.ts)

<a id="s13"></a>

## S13 — `src/runtime/pi-rpc.ts`

**검토:** READ_PRIOR_SAME_SHA. write/partial-line deadline와 transport completion; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/runtime/pi-rpc.ts)

<a id="s14"></a>

## S14 — `src/runtime/pi-adapter.ts`

**검토:** READ_PRIOR_SAME_SHA. batch delivery와 absolute deadline; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/runtime/pi-adapter.ts)

<a id="s15"></a>

## S15 — `src/tui/sources/settings.ts`

**검토:** READ_PRIOR_SAME_SHA. applyField/PLACEMENT/commitField; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/tui/sources/settings.ts)

<a id="s16"></a>

## S16 — `src/config.ts`

**검토:** READ_PRIOR_SAME_SHA. 전체 config 교차 제약; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/config.ts)

<a id="s17"></a>

## S17 — `src/config/operations.ts`

**검토:** READ_PRIOR_SAME_SHA. bundle layout와 asset loader; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/config/operations.ts)

<a id="s18"></a>

## S18 — `src/tui/sources/extensions.ts`

**검토:** READ_PRIOR_SAME_SHA. containedEntry/toggle/readExtensions; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/tui/sources/extensions.ts)

<a id="s19"></a>

## S19 — `src/config/defaults.ts`

**검토:** READ_PRIOR_SAME_SHA. society slug·seed·quota·timeout 기본값; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/config/defaults.ts)

<a id="s20"></a>

## S20 — `src/entry/oma.ts`

**검토:** READ_PRIOR_SAME_SHA. tenure/프로비저닝/설정 편집/session 배선; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/entry/oma.ts)

<a id="s21"></a>

## S21 — `src/runtime/provision.ts`

**검토:** READ_PRIOR_SAME_SHA. canonical 최초 seed와 rootfs prepare/repair; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/runtime/provision.ts)

<a id="s22"></a>

## S22 — `src/storage/preaccept-artifact.ts`

**검토:** READ_PRIOR_SAME_SHA. PreacceptOwner와 uncertainty 보존; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/storage/preaccept-artifact.ts)

<a id="s23"></a>

## S23 — `src/git/context.ts`

**검토:** READ_PRIOR_SAME_SHA. 준비 scope와 acceptance 경계; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/git/context.ts)

<a id="s24"></a>

## S24 — `src/lifecycle/create.ts`

**검토:** READ_PRIOR_SAME_SHA. bootstrap Promise.all/initial artifact/refresh; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/lifecycle/create.ts)

<a id="s25"></a>

## S25 — `src/git/submit.ts`

**검토:** READ_PRIOR_SAME_SHA. frozen spool·accepted effect·recovery; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/git/submit.ts)

<a id="s26"></a>

## S26 — `src/git/integration.ts`

**검토:** READ_PRIOR_SAME_SHA. execute/reconcile/no-op와 policy CAS; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/git/integration.ts)

<a id="s27"></a>

## S27 — `src/git/integration-policy.ts`

**검토:** READ_PRIOR_SAME_SHA. nonempty checks gate와 전체 policy identity; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/git/integration-policy.ts)

<a id="s28"></a>

## S28 — `src/git.ts`

**검토:** READ_PRIOR_SAME_SHA. writer arbitration와 coordinator 구성; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/git.ts)

<a id="s29"></a>

## S29 — `src/reconcile.ts`

**검토:** READ_PRIOR_SAME_SHA. startup quiescence·sweep·unit 관측; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/reconcile.ts)

<a id="s30"></a>

## S30 — `src/units.ts`

**검토:** READ_PRIOR_SAME_SHA. ensure/start/stop/confirmDead/관측; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/units.ts)

<a id="s31"></a>

## S31 — `src/units/execute.ts`

**검토:** READ_PRIOR_SAME_SHA. 동기/비동기 systemctl budget; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/units/execute.ts)

<a id="s32"></a>

## S32 — `src/store.ts`

**검토:** READ_PRIOR_SAME_SHA. open/PRAGMA/schema 검사·transaction; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/store.ts)

<a id="s33"></a>

## S33 — `scripts/source-digest.mjs`

**검토:** READ_THIS_PASS. 전체: verification input closure와 self field normalization.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/scripts/source-digest.mjs)

<a id="s34"></a>

## S34 — `scripts/verification-lanes.mjs`

**검토:** READ_THIS_PASS. 1–240행: 로컬 제외 시험/fast/durable/kernel/crash/property/stress 일부.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/scripts/verification-lanes.mjs)

<a id="s35"></a>

## S35 — `scripts/build.mjs`

**검토:** READ_THIS_PASS. 전체: 고정 dist layout와 package 검사.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/scripts/build.mjs)

<a id="s36"></a>

## S36 — `package.json`

**검토:** READ_PRIOR_SAME_SHA. script와 의존성 버전 선언; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/package.json)

<a id="s37"></a>

## S37 — `implementation/physical-ordering.md`

**검토:** READ_PRIOR_SAME_SHA. SEQ-001..004; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/implementation/physical-ordering.md)

<a id="s38"></a>

## S38 — `architecture.md`

**검토:** READ_PRIOR_SAME_SHA. 초기 구조, §7 batch/recovery, TUI 관련 이전 부분 검토; 전 문서 읽기 아님.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/architecture.md)

<a id="s39"></a>

## S39 — `implementation/systemd/resident.service.in`

**검토:** READ_THIS_PASS. 전체: BindsTo/After와 --config 없는 ExecStart.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/implementation/systemd/resident.service.in)

<a id="s40"></a>

## S40 — `src/entry/broker.ts`

**검토:** READ_THIS_PASS. 1–240행 반환 전체: configPath/lock/Store/units composition.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/entry/broker.ts)

<a id="s41"></a>

## S41 — `src/entry/runner.ts`

**검토:** READ_PRIOR_SAME_SHA. config 선택과 profile 구성; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/entry/runner.ts)

<a id="s42"></a>

## S42 — `src/runtime/broker-supervisor.ts`

**검토:** READ_THIS_PASS. 1–240행: foreground child spawn와 generation registration; 후반 미조회.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/runtime/broker-supervisor.ts)

<a id="s43"></a>

## S43 — `src/runtime/society-lease.ts`

**검토:** READ_THIS_PASS. 전체: abstract namespace lease와 inherited descriptor 확인.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/runtime/society-lease.ts)

<a id="s44"></a>

## S44 — `src/runtime/broker-lifetime.ts`

**검토:** READ_THIS_PASS. 전체: native barrier를 포함한 drain와 writer resource 수명.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/runtime/broker-lifetime.ts)

<a id="s45"></a>

## S45 — `src/process/preparation.ts`

**검토:** READ_THIS_PASS. 전체: PreparationExecutor와 sticky uncertain closure.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/process/preparation.ts)

<a id="s46"></a>

## S46 — `src/storage/durable-fs.ts`

**검토:** READ_THIS_PASS. 1–240행 반환 전체: exclusive write와 derived replace/fsync 책임.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/storage/durable-fs.ts)

<a id="s47"></a>

## S47 — `src/storage/immutable-file.ts`

**검토:** READ_THIS_PASS. 1–240행 반환 전체: checked inode·publication·parent fsync·0444 정책.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/storage/immutable-file.ts)

<a id="s48"></a>

## S48 — `src/storage/ledger-reader.ts`

**검토:** READ_THIS_PASS. 전체: batch incarnation 상한·정확한 link 집합·operation relation.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/storage/ledger-reader.ts)

<a id="s49"></a>

## S49 — `src/cli/request-service.ts`

**검토:** READ_THIS_PASS. 전체: cache 불명/손상 보존, lookup 후 frozen resend.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/cli/request-service.ts)

<a id="s50"></a>

## S50 — `src/config/policy.ts`

**검토:** READ_THIS_PASS. 전체: policy snapshot·revision·refresh 실패 후 invalidation.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/config/policy.ts)

<a id="s51"></a>

## S51 — `src/runtime/engine-auth.ts`

**검토:** READ_THIS_PASS. 전체: engine SDK resolution·placeholder fallback.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/runtime/engine-auth.ts)

<a id="s52"></a>

## S52 — `test/receipt-supersession.test.mjs`

**검토:** READ_THIS_PASS. 앞부분과 concurrent CLI cache test; 출력 잘림 이후 미조회.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/test/receipt-supersession.test.mjs)

<a id="s53"></a>

## S53 — `test/config-bundle-owner.test.mjs`

**검토:** READ_PRIOR_SAME_SHA. 구성 loader/쓰기 경로 fixture와 source gate; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/test/config-bundle-owner.test.mjs)

<a id="s54"></a>

## S54 — `scripts/architecture/rule-check.mjs`

**검토:** READ_PRIOR_SAME_SHA. rule group 목록; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/scripts/architecture/rule-check.mjs)

<a id="s55"></a>

## S55 — `HANDOFF.md`

**검토:** READ_PRIOR_SAME_SHA. 구조 종료 선언·이전 상태 기술; 이전 부분 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/HANDOFF.md)

<a id="s56"></a>

## S56 — `src/storage/quota.ts`

**검토:** READ_PRIOR_SAME_SHA. tree accounting와 admission 비교; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/storage/quota.ts)

<a id="s57"></a>

## S57 — `src/pi-extension.ts`

**검토:** READ_PRIOR_SAME_SHA. extension composition과 import closure; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/pi-extension.ts)

<a id="s58"></a>

## S58 — `src/extension/delivery.ts`

**검토:** READ_PRIOR_SAME_SHA. settled boundary 발행·pending 해제; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/extension/delivery.ts)

<a id="s59"></a>

## S59 — `implementation/broker-lifecycle-review.json`

**검토:** READ_PRIOR_SAME_SHA. 추가 분해 보류 조건과 split trigger; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/implementation/broker-lifecycle-review.json)

<a id="s60"></a>

## S60 — `production-files.txt`

**검토:** READ_THIS_PASS. 고정 HEAD의 전체 production inventory 재조회.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/production-files.txt)

<a id="s61"></a>

## S61 — `src/broker/connection.ts`

**검토:** READ_PRIOR_SAME_SHA. connection/task 별도 수명과 state union; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/broker/connection.ts)

<a id="s62"></a>

## S62 — `src/broker/public-dispatcher.ts`

**검토:** READ_PRIOR_SAME_SHA. capability/DTO/key와 final dispatch; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/broker/public-dispatcher.ts)

<a id="s63"></a>

## S63 — `src/broker/internal-dispatcher.ts`

**검토:** READ_PRIOR_SAME_SHA. runner/host method 분기; 이전 부분 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/broker/internal-dispatcher.ts)

<a id="s64"></a>

## S64 — `operations/README.md`

**검토:** READ_THIS_PASS. 1–180행 요청 중 반환된 내용: 수동 bundle 비원자성, no cost cap, rootfs opt-out, prompt root.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/operations/README.md)

<a id="s65"></a>

## S65 — `src/lifecycle/actions.ts`

**검토:** READ_THIS_PASS. 전체: frozen previousIncarnation·D06 replay authority·start/stop recovery.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/lifecycle/actions.ts)

<a id="s66"></a>

## S66 — `src/process/async.ts`

**검토:** READ_PRIOR_SAME_SHA. result/closed와 fenced stdio; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/process/async.ts)

<a id="s67"></a>

## S67 — `src/storage/context-stream.ts`

**검토:** READ_PRIOR_SAME_SHA. tree preparation와 owned file cleanup; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/storage/context-stream.ts)

<a id="s68"></a>

## S68 — `src/storage/batch-view.ts`

**검토:** READ_PRIOR_SAME_SHA. derived inbox view replacement; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/storage/batch-view.ts)

<a id="s69"></a>

## S69 — `src/runtime/host-tenure.ts`

**검토:** READ_PRIOR_SAME_SHA. host/engine/broker 등록·end; 이전 동일 SHA 검토.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/runtime/host-tenure.ts)

<a id="s70"></a>

## S70 — `implementation/validation.md`

**검토:** READ_PRIOR_SAME_SHA. 이전 로컬/CI 주장과 BLOCKED 분리; 과거 수치를 fresh proof로 사용하지 않음.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/implementation/validation.md)

<a id="s71"></a>

## S71 — `src/runtime/run-registry.ts`

**검토:** READ_THIS_PASS. 전체: 이전 pinned cgroup 사망 확인과 새 opening run 소유권.

[고정 커밋 원문](https://github.com/minjung2035/oma-v2/blob/b25961cc46532f5e30ff60cc381fed51c59d13ab/src/runtime/run-registry.ts)

## 외부 기술 확인 — 제품 자체의 검증 증거 아님

<a id="e01"></a>

### E01 — Node.js child_process

[공식 문서](https://nodejs.org/api/child_process.html). exit/close/error와 신호 송신 결과의 구별. 작성 시 공식 문서를 확인했으며 구현에서는 실제 지원 Node 버전과 맞춰 검증한다.

<a id="e02"></a>

### E02 — SQLite WAL

[공식 문서](https://www.sqlite.org/wal.html). read-only WAL과 sidecar 조건, journal mode의 지속성. immutable 옵션을 live DB 편의를 위해 사용하지 않는다.

<a id="e03"></a>

### E03 — SQLite atomic commit

[공식 문서](https://www.sqlite.org/atomiccommit.html). rollback-journal 문서의 persistence/commit 단계. WAL의 세부 동작을 설명하는 자료로 잘못 인용하지 않는다.

<a id="e04"></a>

### E04 — TypeScript 4.9 satisfies

[공식 문서](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html). literal key union과 Record를 통한 키 집합 검증. readonly/type brand 자체의 runtime once-only 보장과 무관하다.

<a id="e05"></a>

### E05 — Linux cgroup v2

[공식 문서](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html). 실제 cgroup 관측과 lifecycle 근거. 계획의 구조 checker가 kernel proof를 제공하지 않는다.
