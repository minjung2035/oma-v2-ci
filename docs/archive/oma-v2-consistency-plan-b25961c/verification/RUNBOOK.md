# 검증 실행 규율 — 명령·환경·출처

이 문서의 명령은 **구현 AI가 실제 repository checkout에서 수행할 절차**다. 이번 계획 작성 과정에서 제품 build/test/lane을 실행한 결과가 아니다. 실행 시 package.json의 현재 scripts를 다시 읽는다. [S36](../guide/SOURCES.md#s36), [S34](../guide/SOURCES.md#s34).

## 1. Evidence directory와 source binding

repository 밖의 새 directory를 사용한다. 예를 들어 아래 환경변수는 사용자가 승인한 임시 위치를 직접 지정한다. 이전 실행 경로를 덮어쓰지 않는다.

```sh
# 아래 경로는 예시다. 실행 환경의 실제 새 evidence directory를 지정한다.
export EVIDENCE_DIR=/absolute/new/oma-evidence-directory
mkdir -p "$EVIDENCE_DIR"
git rev-parse HEAD > "$EVIDENCE_DIR/source-head.txt"
git status --short > "$EVIDENCE_DIR/working-tree.txt"
node --version > "$EVIDENCE_DIR/node-version.txt"
npm --version > "$EVIDENCE_DIR/npm-version.txt"
git --version > "$EVIDENCE_DIR/git-version.txt"
uname -a > "$EVIDENCE_DIR/kernel.txt"
node --input-type=module -e '
  const { verificationInputDigest } = await import("./scripts/source-digest.mjs");
  console.log(JSON.stringify(verificationInputDigest("."), null, 2));
' > "$EVIDENCE_DIR/input-digest-before.json"
```

dirty tree에서 commit SHA만으로 실행 bytes를 특정할 수 없다. input digest와 diff/원본 snapshot을 함께 보존한다. repository private content와 logs는 승인된 범위에만 저장한다. credential·실제 token·Human private prompt를 로그에 복제하지 않는다.

## 2. Generator 전에 현재 상태를 먼저 측정한다

커밋된 inventory/LOC/dependency evidence가 stale인지 먼저 기록한다. `npm run inventory`, `node scripts/loc.mjs`, `npm run evidence:graph`는 생성물을 바꿀 수 있다. 이를 먼저 실행해 차이를 지운 다음 baseline이 통과했다고 보고하지 않는다.

의존성 설치는 clean/승인된 repository checkout에서 `npm ci --include=dev`를 사용한다. 설치 실패·플랫폼 native 모듈 실패는 기록하고 이후 시험을 통과한 것처럼 채우지 않는다. 의존성 install script는 코드를 실행하므로 격리 환경과 잠긴 lock을 사용한다.

## 3. 매 작업의 최소 루프

각 substep의 focused test는 실제 테스트 파일/case를 구현한 뒤 명령을 handoff에 적는다. 이 계획의 Vxx는 요구 ID이지 이미 존재하는 test runner 명령이 아니다.

```sh
npm run check:inventory
npm run typecheck
npm run build
npm run check:package
npm run check:architecture
npm test
```

각 명령의 stdout/stderr, 종료 코드, timeout, 시작/종료, skip/todo/cancel count를 별도로 저장한다. `cmd | tee log`를 쓸 경우 shell의 pipeline exit code가 본 명령 실패를 숨기지 않게 한다. 한 명령 실패로 다음 명령을 실행하지 않았다면 그 뒤 결과는 NOT_RUN이다.

새 production 경로/import가 생기면 original drift를 기록한 후 실제 generator로 정합성을 갱신한다.

```sh
npm run inventory
node scripts/loc.mjs
npm run evidence:graph
npm run check:inventory
npm run check:architecture
```

cloc 요구 버전과 package에 없는 도구는 현재 scripts/workflow에서 확인한다. 도구 부재 시 LOC를 손으로 수정하지 않는다. 이 작업에 필요한 정확한 cloc measurement가 없으면 해당 항목을 BLOCKED로 둔다.

## 4. 현재 존재하는 lane

```sh
npm run verify:fast -- --out "$EVIDENCE_DIR/fast"
npm run verify:durable -- --out "$EVIDENCE_DIR/durable"
npm run verify:property -- --out "$EVIDENCE_DIR/property"
npm run verify:stress -- --out "$EVIDENCE_DIR/stress"
```

`kernel`, `crash`, `all`은 현재 프로젝트가 요구하는 disposable user-systemd 환경을 확인한 뒤 실행한다. 환경 플래그만 1로 바꿔 native 기반 검증이 가능해지는 것은 아니다.

```sh
# 승인된 disposable 환경의 prerequisite가 실제로 성립할 때만 실행한다.
npm run verify:kernel -- --out "$EVIDENCE_DIR/kernel"
npm run verify:crash -- --out "$EVIDENCE_DIR/crash"
npm run verify:all -- --out "$EVIDENCE_DIR/all"
```

powercut은 `scripts/powercut-lane.mjs`의 현재 인터페이스와 실제 VM prerequisites를 확인해 별도로 수행한다. 계획서에는 확인되지 않은 powercut 옵션을 invent하지 않는다. `npm run verify:powercut`의 존재가 VM power loss 검증을 완료했다는 뜻은 아니다.

## 5. Test catalog의 lane과 실제 command 관계

| Catalog 분류 | 의미 | 실행 방법 |
|---|---|---|
| fast/durable/property/stress | 현재 package에 같은 이름의 lane이 존재 | 해당 lane inventory에 실제 case 연결 후 실행 |
| kernel | 실제 systemd/native/cgroup 환경 필요 | kernel/crash의 요구 조건 확인 |
| engine | 실제 잠긴 Pi 엔진, provider 없는 시험 가능 범위 | focused case 또는 functional script에 연결; `verify:engine` 명령을 있다고 가정하지 않음 |
| pty | 실제 pseudo-terminal 필요 | 기존 functional-surface 또는 새 focused case에 연결 |
| powercut | VM/디스크 전원 손실 의미 검증 | 실제 powercut tooling/환경 확인; SIGKILL과 분리 |

provider 호출이 필요한 경우 사용자 계정·비용과 처리할 자료가 명시적으로 허용됐는지 확인한다. provider 없는 local stand-in은 실제 provider inference 증거가 아니다.

## 6. 중요한 실패의 보고

SETUP_FAILED, TIMEOUT, CANCELLED, SKIPPED, NOT_RUN, BLOCKED를 성공으로 합치지 않는다. 실패가 테스트 assertion 때문인지 environment 때문인지 raw log로 구별한다. 로그가 없으면 원인 불명이지 arbitrary 코드 실패라고 추정하지 않는다.

정적 분석은 보장된 type/import/owner 위반 범위만 증명한다. actual engine/test fixture/kernel/source inspection 결과를 하나의 총 PASS 숫자만으로 요약하지 않는다.

## 7. Source digest 마감

마지막 code·test·script·contract·CI·owner·inventory 변경 뒤 input digest를 다시 계산한다. `implementation/validation.md`는 자체 digest field만 normalization하고 다른 내용을 포함하므로 상태 문구 변경도 입력을 바꿀 수 있다. [S33](../guide/SOURCES.md#s33).

결과 기록의 metadata 변경 때문에 새 digest가 생기면 실제 executable bytes가 같다는 mapping과 gate rerun을 기록한다. 정책적으로 fresh full lane을 요구하는 경우 다시 실행한다. digest 값만 바꿔 새 실행인 것처럼 주장하지 않는다. 생성 adversarial output/log는 현재 closure의 output exclusion 정책을 따른다.

## 8. CI는 commit 바깥의 실제 run을 읽는다

push/PR/merge는 사용자가 허용한 경우에만 한다. CI 결과를 기록할 때 exact head SHA, 실제 checkout SHA, workflow source SHA, event, run attempt, source digest를 함께 확인한다. PR head 검사와 merge-result 검사는 서로 다른 대상을 검증한다. 둘을 원하는 정책은 명시할 수 있지만 한쪽 결과를 다른 쪽 PASS로 바꾸지 않는다.

현재 SHA에 대한 성공 run을 확보하지 못하면 그대로 기록한다. baseline 또는 job 실패만 보고 원인 코드 줄을 추정하지 않는다. raw evidence와 실패 단계가 있어야 원인을 단정할 수 있다.
