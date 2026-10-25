# OMA 코드 품질 보완 명세

상태: CQ47-01..05 구현 및 로컬 수용 검증 완료 (2026-10-25). [Priority 0](PRIORITY-0.md)가 최상위다.
2026-10-25 실제 코드 검사의 두 재현 결함과 세 유지보수 항목을 모두 대상으로 한다.
현재 실행 판정과 원시 로그는 [validation](implementation/validation.md)이 소유한다.

## 기준 입력과 목적

시작 입력은15645개 파일, digest 4f986be1c6d6e09e6790eb20a533fd99ce2ec917dff74c212c8139fa31495222다.
25개 workspace/순환 의존0/자체 실행 TS514개에 명시적 any0인 구조와 기존 기능을 유지한다.
기존4108 local PASS는 과거 입력의 실행이며 새 변경의 PASS로 사용하지 않는다.
검사의8/10 평가는 의견이며 완료 기준으로 사용하지 않는다.

이번 작업은 확정된 사실의 의미·현재 권한·관측의 분리를 유지하면서 cleanup의 실제 구멍을
닫고, 긴 SDK host의 책임과 외부에 약속하는 API를 좁힌다. 패키지 수를 늘리는 것이 목표가 아니다.

## 보존 조건

- accepted bytes·terminal·receipt·동일 key retry/restart·기존 wire 및 schema를 유지한다.
- captured T와 원래 Store/gate를 유지하며 transaction 안에 await/I/O를 추가하지 않는다.
- unknown을 absent/dead/success로 바꾸지 않는다. cleanup 오류는 최초 오류를 덮어쓰지 않는다.
- FD·child·listener·timer는 생성 순간부터 한 owner가 실제 종료까지 소유한다. close 재시도로
  재사용된 FD를 닫지 않는다. 모든 예정된 cleanup을 한 번씩 시도하고 실패들을 보존한다.
- UI queue·prompt attribution·reload epoch·취소·실제 child 종료·session history 수명을 유지한다.
- 현재 TUI 문구와 renderer 폭·모델/effort·Personal/Society 동작을 유지한다.
- immutable architecture/review-notes와 과거 실행 기록·식별자의 뜻을 변경하거나 재승인하지 않는다.

## CQ47-01: 설정 generation의 cleanup

실제 publishGeneration에서 역할/프롬프트 디렉터리를 닫는 첫 close가 실패하면 다음 FD가
열린 채 남고 최초 STORE_CORRUPT가 EIO에 가려지는 재현을 수정한다.
Native의 공통 cleanup mechanism은 여러 정리의 전체 시도와 복수 오류 보존을 소유한다.
Config는 동일 owner가 얻은 FD들을 등록하고 내부 디렉터리와 tree를 실패 시에도 모두 반환한다.
설정 generation의 게시·flush·journal·manifest commit 순서는 변경하지 않는다.
실제 로컬 FD에 첫/후속 close 오류, effect+cleanup 동시 오류, cleanup-only 오류를 주입한다.
primaryFailure/errorCodeOf는 최초 효과 실패의 의미를 유지하고 남은 열린 FD는0이어야 한다.

## CQ47-02: Keychain helper 종료 타이머

child 종료가 먼저 관측되어도 close의 deadline timer를 해제한다. 동시/반복 close는 한 종료
작업을 공유한다. timeout은 실제 child 종료의 대체 증거가 아니며 FD/상속 fence는 실제 종료까지
유지한다. 정상 조기 종료·timeout·반복 close·error/EOF와 실제 close의 구분을 검사한다.
종료 완료 뒤 남은 deadline timer/콜백은0이어야 한다. 실제 Mac qualification으로 세지 않는다.

## CQ47-03: interactive host의 책임 분리

575줄 runInteractive를 startup/disposal을 잇는 coordinator로 줄인다. UI epoch/timer/panel/queue,
Human input·command routing, model/effort/history 선택, session event/delivery/RPC, SDK adaptation을
각 의미 owner로 나눈다. 같은 큰 본문을 이름만 다른 함수나 class로 옮기지 않는다.
한 UI lifetime과 한 input sequence/pending attribution을 유지하고 await 뒤 epoch를 다시 확인한다.
coordinator는 약150줄 이내를 목표로 하되 줄 수보다 책임·오류/수명 순서의 보존을 우선한다.
내부 module은 명명된 최소 ports를 사용하며 임의 callback registry나 전역 singleton을 추가하지 않는다.
Personal에서도 같은 SDK adapter/수명 primitive를 재사용한다.

## CQ47-04: App 공개 API

App의140개 공개 subpath를 실제 설치/실행 consumer가 사용하는 최소 API로 줄인다.
검토한 공개 surface는 명시적인 runtime/assets installer API와 실제 admin command가 소비하는 diagnostics/{ledger,integrity,files} API다. 실행 파일은 bin/deployment manifest가
소유하며 public module facade를 만들지 않는다. 삭제한136개 경로의 호환 alias는 남기지 않는다.

제품 기능 workspace 간 소비는 기존 package exports 경계를 계속 지킨다. App 내부를 검증하는
root integration test는 root package의 native Node private imports인 #oma-test/app/*를 사용한다.
이 개발 전용 map은 apps/oma/dist의 같은 authored module만 가리키며 compiler paths/custom loader,
product runtime alias 또는 App public reexport로 동작하지 않는다. production/App/다른 workspace는
이 map을 사용할 수 없다. 같은 App 내부 시험은 자기 package의 relative import를 사용한다.
기존 root-test도 public API만 사용하던 DR46 규칙 중 App integration 접근만 이 명시적인 private
시험 경계로 대체한다. 다른 feature package의 public 경계는 완화하지 않는다.

기계 검사는 production/private-map 접근, map target 변조, 경로 탈출, 미존재 module, 퇴역한
@oma/app subpath, 다른 workspace 우회를 negative control로 거부한다. tests를 위해 모든 내부
module을 다시 public barrel이나 testing facade로 재수출하지 않는다.

## CQ47-05: SDK private 경계

host의 unchecked InteractiveModeInternals cast/직접 private member 조작을 제거한다.
하나의 pi-compat adapter만 SDK-specific 이름과 patching을 소유하고 host에는 shutdown/failure,
표시 정책·history·thinking visibility 등의 의미 API를 제공한다. 실제 공개 SDK API가 존재하면
그것을 사용한다. SDK 버전과 필요한 member/field shape를 시작 시 검사해 호환 불가를 명확히 거부한다.

pinned SDK1.0.1에 공개 hook이 없는 기존 기능은 adapter의 단일 inventory와 원래 semantic oracle로
유지한다. 접점13개를 다른 이름으로 숨겨 제거했다고 주장하거나 SDK fork/버전 교체/기능 삭제를
완료 수단으로 사용하지 않는다. 잔여 접점과 이유는 adapter inventory가 소유한다.
host에서 raw private handle을 얻거나 private 이름에 다시 의존하는 것은 정적 검사로 거부한다.
정상 실제 SDK와 누락/잘못된 member·version, handler 의미·cleanup/정확한 UI 문자열을 검증한다.

## 검증과 완료

1. 재현된 두 결함의 red/green 원시 결과와 실제 자원 상태를 보존한다.
2. 변경 package의 strict build/typecheck, package-local과 해당 integration tests를 실행한다.
3. API/SDK 경계 negative controls, 기존 transaction/권한/복구·UI ownership 검사를 유지한다.
4. 독립 tarball 설치에서 축소된 App API, 실제 bin, Engine adapter의 선언/runtime을 검증한다.
5. metadata를 build 뒤 갱신하고 전체 static gate 및 입력을 고정한 전체 local을 실행한다.
6. 실행 중 source/docs/install/build를 바꾸지 않는다. 첫 serial9개 동안 CPU 작업을 병행하지 않는다.
7. 문서 기록 후의 차이와 실제 실행 입력을 구분하고 현재 binding을 재검증한다.

최종 보고는 실제 API 개수·coordinator 책임/크기·직접 private 접근 제거·두 결함의 재현 후
검증을 포함한다. real Mac/VM/systemd/provider/power-loss는 지원 환경에서의 실행과 구분해
NOT_RUN으로 남기며, 이 로컬 보완을 전체 release qualification 완료로 표시하지 않는다.
