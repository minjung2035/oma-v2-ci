# OMA v2 — 현재 검증 상태

현재 활성 작업은 DR49 native 구현이다. 이전 문서 정리 범위는 사용자 구현 지시로 대체됐다.
아래 DR48·문서 정리 결과는 각 당시 입력의 기록이며 현재 source의 전체 PASS가 아니다.

## DR49 native 전환 — 진행 중 (2026-10-25)

작업 브랜치는 `work/macos-native-20261025`이며 master 병합·배포는 하지 않았다.
현재 G-PROCESS/G-FILES/G-AUTH는 OPEN이고 Mac 제품 진입은 효과 전에 거절한다.
이 거절 시험이나 부분 primitive 성공을 native Society 지원으로 표시하지 않는다.

| 실제 입력·실행 | 결과와 범위 |
|---|---|
| `d5d65ed4` 실제 CI `40243911993` | Mac26/15·Ubuntu 공통 각각 **56/56**, Ubuntu peer3/3·native33/33 PASS. Linux 선택 integration은 **179/180 FAIL**: 실제 full-filesystem child의 옛 unshare가 uid_map 권한 거절로 미실행. 세 OS input `218696cec4ea5d1dee5cac3969d2a85e526d4114828aa6952004a9e9b5ceaded`·전후 동일. 양 Darwin gate는 계속 OPEN/BLOCKED·각15개 실제 관측. zip5개 SHA256 확인·원시 `ci-d5d65ed4/` 보존. 전체 workflow 성공으로 표시하지 않음 |
| full-filesystem의 native primitive 전환 | 옛 unshare+shell mount를 pinned bwrap의 실제4MiB tmpfs로 대체. 실제 ENOSPC·STORAGE_FULL·accepted mail 원본/게시 검증을 모두 유지했고 global userns 설정을 바꾸지 않음. 추가 native asset/준비 시험과 함께 **21/21 PASS**·skip0, input `5e5793b5df95997edbcf014f55ed8cd7fec98b41908b10921ae40c42d419c39a`(15597개)·전후 동일. `native-full-fs-replacement-*` 보존. 후속 CI 재실행 필요 |
| `d5d65ed4` 이후 독립 모듈 설치 재검증 | **26/26 PASS**. 각 tarball을 선언한 dependency closure만으로 설치하고 public entries·authored declarations·해당 installed runtime을 검증. 외부 SDK declaration44개는 별도 진단이며 authored 오류0개. input `d05e9255f5df7f17f61bc83469997e6bd296362d475ab6c630ee50c805b222c5`·전후 동일. `native-d5-independent-install.log` 보존 |
| 선택 native integration의 단일 고정 입력 실행 | strict/noEmitOnError로19개 시험 파일을 컴파일하고 **180/180 PASS**·skip/cancel/todo0. input `8dcd2c2ec5c10709a5f73d5502db7061097281864c39c677293d9b88405663fe`(15597개)·전후 동일. `native-selected-integration-{before,after}.json`, `native-selected-integration-real.log`. 실제 Native/Pi·권한·receipt·Worker·durable SIGKILL을 같은 실행에서 검증. 전체 root type/module 검사는 여전히 별도 FAIL이며 Mac 제품 qualification이 아님 |
| `6d8263eb` 실제 CI `40239657753` | Mac26/15·Ubuntu 공통 각각 **54/54**, Ubuntu peer/leaf **3/3**, 실제 native **31/31 PASS**·skip0. 세 OS input `2c2cdee2d33c5cf83392cf626a988748c0aff5f492ef84735e9dd34d7de723fb`·전후 동일. Darwin 양쪽 각15개 실제 관측 후 계속 OPEN/BLOCKED. zip5개 SHA256 확인·원시 결과와 요약을 `ci-6d8263eb/`에 보존 |
| 실제 Native Resident/Broker/Pi 통합과 종료 수리 | **25/25 시나리오**, 실제 Resident6개를 포함한 공통 수명·shutdown **34/34 PASS**·skip0. input `b6a41d6ce65c8964788337a8b91fc19067fffe9343fc537aa72858b123a5a577`(15594개)·전후 동일. 자동 생성 첫 실행·현재 grant·provider 실패·SIGKILL·broker 교체·receipt·tool plan 거절을 실제 Pi/sandbox로 확인. `native-resident-drain-{scenarios,policies}.log` 보존. root 전체 PASS가 아님 |
| systemd 시험의 실제 native 전환 | strict 부분 컴파일 후 정책·권한·accepted fact **71/71 PASS**, input `db9e3ef267d7076bdc3ff1fb0f44a798e5e449f98711a686e8493a65ca370dfe`. 별도 입력 `62abb6d454cbe99a3dfec064faa4ddab4b73c81f5e92e1d5188b1b626286f392`에서 Worker/sandbox **38/38**, 실제 durable SIGKILL **46/46 PASS**·각 전후 동일·skip0. `native-policy-71-real.log`, `native-connected-{worker,crash}-regressions-real.log` 보존. 당시 시나리오25개 중1개 실패도 보존했으며 위 수리 후25/25와 합산하지 않음 |
| 전환 중 재현한 통합 실패 | 첫18개 시나리오 중2개 실패: 자동 시작으로 초기 mail이 cur로 이동하는 fixture 차이, 종료된 Store 재접근. 이후25개 중1개 실패: runner.open 뒤 옛 incarnation으로 stop하고 diagnostic close가 teardown 뒤 도착함. 실패·전후 input과 원시 로그를 보존했으며 skip·죽음 보장 완화로 해결하지 않음 |
| 최신 root 전체 strict typecheck | **FAIL, 61개 진단**. `native-root-after-layout.log`. 이전79개 진단은 `native-root-after-connected.log`에 보존했다. 제거된 unit/host relay API와 기존 물리 시험의 전환이 남았다. 선택 native integration의 PASS를 root 전체 PASS로 표시하지 않음 |
| `64cb2cad` 실제 CI `40237516208` | Mac26/15·Ubuntu 공통 각각 **54/54**, Ubuntu peer/leaf **3/3**, 실제 native 실행·SIGKILL·sender·Git·Resident **24/24 PASS**. build26/26·세 OS 동일 input `d568e62424b4c30f0d9729fb94436c0ffedcbaf93ff3bca5b3a08aadfb5caf10`(15591개), 각 전후 동일. Ubuntu bwrap 한정 AppArmor profile을 명시했고 전역 제한1은 그대로다. Darwin gate는 계속 OPEN/BLOCKED. zip5개 SHA256 확인·원시 artifact는 `ci-64cb2cad/` |
| 위 CI 이전의 Ubuntu 실제 실패 | `e62881f3`·`ffcb1140`에서 init pin 이전 종료를 재현. 추가 launcher 관측에서 실제 exit1·`bwrap: setting up uid map: Permission denied` 확인. unknown journal을 빈 목록으로 치환하지 않았고 실패 archive도 보존. OS의 application별 userns 권한을 설정한 뒤 동일 scope/격리/권한 시험을 실행해 위 결과를 얻음 |
| 후속 FD·로그·runtime 수정의 Linux 실행 | 옵션처럼 생긴 env 값 오분류, log open 뒤 hard link 도입 시 쓰기, diagnostic 실패 후 stop의 stale active 상태를 재현·수정. 실제 OS 및 공통 정책 **57/57**, 별도 strict 부분 컴파일 후 기존 권한·accepted fact·mail/storage/reconcile **37/37 PASS**·skip0. input `6a69b12e11d829ef9fda6268dca2ca2ba3a8f88af58b6d639096bb6df531ba20`(15594개), 두 실행 전후 동일. 원시 `native-log-and-runtime-fixed-*`, `native-policy-after-runtime-fixes.log` 보존. root 전체 strict typecheck는 여전히 FAIL |
| `7707de9d` 실제 CI `40235030613` | Mac26/15·Ubuntu 공통 시험 각각 **54/54 PASS**·build26/26·세 OS 동일 input `df788571bb8a51a39e945d8262c5484a630ade3c22f4f5841432d4a5adf6cbd6`(15590개), 각 전후 동일. Darwin 두 gate job은 BLOCKED·각 15개 실제 관측·Keychain SDK typecheck PASS. Ubuntu 후속 native-leaf는 제거된 sd_notify import로 2 PASS/1 FAIL이며 새 Linux execution step은 미실행. 전체 workflow 성공이 아님. artifact 5개 zip SHA256 확인·원시 로그를 `ci-7707de9d/`에 보존 |
| 직접 경로의 workspace·독립 설치 | workspace 시험 **421/421 PASS**·skip0. 첫 독립 설치 실행은 lifecycle smoke의 동기 assertion 때문에 실패했으며 async assertion 전환 뒤 **26/26 packed install/public declaration/import/해당 runtime smoke PASS**. 외부 SDK 선언 진단과 authored declaration 결과는 원시 로그에서 구분한다. `native-connected-workspace-tests.log`, `native-connected-isolation{,-fixed}.log` 보존. 전체 root 회귀는 별도 미완료 |
| 후속 native 회귀 | 제거된 notify 시험을 보관한 실제 peer/leaf **3/3 PASS**. 공통 ResidentRuntime과 실제 Linux scope/journal의 동시 시작·옛 incarnation 중지 거절·geometric backoff·5/60s start-limit·권한 거절 **3/3 PASS**. `native-legacy-leaf-fixed.log`, `native-resident-first-real.log` 보존. 후속 source의 Ubuntu CI는 재실행 필요 |
| 직접 native 경로와 공통 OS/정책의 확대 실행 | **80/80 PASS**, fail/skip/cancel/todo0. Linux 실제 namespace·sender·Git sandbox와 공통 FD/파일/로그/종료 정책·protocol·Restic dump oracle을 함께 실행. input `84b40cf23b96c72a8f0f5da5d570bf6c9cd4393862adf64a5778d53d75a0d19f`(15590개), 전후 동일. `native-connected-current-linux.log`와 before/after JSON 보존. 전체 local 및 Darwin qualification 아님 |
| 2026-10-26 직접 native 경로의 실제 관련 시험 | **33/33 PASS**, fail/skip/cancel/todo0. Linux 실제 bwrap0.12·kernel namespace/pidfd·SIGKILL 5개 경계·setsid double fork/FD 폐기·SCM_RIGHTS transfer와 64 FD 반환 반복·credential 위조 거절·candidate checkout/exec·quarantine 검증/import·POSIX FD·로그 정책·shutdown fence. 일부 policy 단위 시험도 포함하며 G-*나 전체 Linux/Mac 제품 qualification으로 승격하지 않음. input `f6ee85ab6055581bf7f400bbf47b452652bb7f15feab63cc7a91852e6c9b44db`(15590개), 전후 동일. 원시 `native-connected-fixed-real.log`와 before/after JSON 보존 |
| 위 실제 경로의 발견·수정 | 취소 후 gate release, pre-gate 부모 SIGKILL 후 init 생존, quarantine mount target 누락, private argv NUL 검증 누락을 실제 재현 후 수정. 첫 실패 로그를 삭제하지 않음. witness 없는 opening은 unknown으로 보존하며 이 사례의 기대된 거절을 복구 완료로 세지 않음 |
| 직접 경로 연결 뒤 전체 root 회귀 | strict typecheck 첫 실행 FAIL(제거된 units/cgroup API, async lifecycle 및 create v3 시험 전환 필요). 전체 local 미완료, 새 source의 전체 PASS 없음. workspace production build는 26개 성공. 최종 architecture/owner/독립 설치와 Darwin CI는 별도 재검증 필요 |
| `adf20331`: Linux 실제 Restic round trip·손상·죽음 불명·복구 | 19/19 PASS. 이전 source의 독립 결과이며 이후 모듈 이동에 대한 전체 재검증 아님 |
| VM 제거·Restic 모듈 이동 후 Linux 회귀 | durable fault·Restic round trip 27/27, 공통 파일/metadata/소유권 73/73 PASS. artifact 로그에 각 실행 범위를 보존 |
| `762c1604` 변경을 위한 Linux 실행 | 정식 build·typecheck PASS. config/generation/native/tar 30/30, package/세션 소유권 108/108 PASS. 전체 local은 미실행 |
| `aea22ec0`: 실제 macOS 26/15 common-runtime | 25개 workspace build 성공. 양 OS 9/10 PASS·1 FAIL. 파일 생성 뒤 EACCES: Darwin arm64 openat 가변 인자 ABI 결함을 발견. 실패를 보존하고 수정 |
| `762c1604`: 실제 macOS 26/15 common-runtime | build 성공, directory FFI 초기화가 없는 `readdir$INODE64` symbol을 요구해 실패. 수정 후 실제 OS 재실행 대기. Linux 성공으로 덮지 않음 |
| `13d60492`: 실제 macOS 26/15·Ubuntu 공통 runtime | Mac 각각 20/20, Ubuntu 19/19 PASS. build 25/25. 별도 Darwin gate는 계속 OPEN/BLOCKED |
| `0d471551`: 실제 macOS 26/15·Ubuntu 공통 runtime | Mac 각각 20/20, Ubuntu 19/19 PASS. 실제 SCM_RIGHTS 인계 뒤 peer PID는 connector 생존·종료 모두 holder를 가리켰다. PID 재사용·동시 메시지 인증 증명은 아니며 G-AUTH는 OPEN |
| VM 제거 후 첫 고정 입력 전체 local | FAIL. serial 9개 중 PASS4·SKIP5, parallel 3644개 중 PASS3527·FAIL52·SKIP65. exit1, signal null, 입력 변경0. 전체 통과로 합산하지 않음 |
| 위 실패 수리 후 부분 회귀 | strict typecheck·build·정적 gate PASS. 실제 bwrap 실행 16/16, Restic 복구/fault 12/12, 모듈/소유권 62/62, mjs 회귀 42/42, 구조/결박 8/8 PASS. 당시 부분 범위이며 아래 전체 재실행과 구분 |
| `982658de`: 수리 후 고정 입력 전체 local | **3640/3640 PASS**. serial9·parallel3631, fail/cancel/skip/todo0. exit0·signal null, 실행 전후 입력 변경0 |
| `982658de`: 실제 macOS 26/15·Ubuntu CI | Mac 각각 20/20, Ubuntu 19/19 PASS. 별도 Darwin gate는 BLOCKED. artifact zip SHA-256 확인 후 원본 보존 |
| P2 handle 연결 후 Linux 부분 회귀 | strict typecheck·build·정적 gate PASS. 관련 192개 중 191 PASS·1 FAIL은 옛 renameSync fault가 호출되지 않은 시험이었다. 실제 renameat 게시 후 flush에 fault를 옮긴 저장 회귀 12/12, 모듈/문서/trace 28/28 PASS. 전체 재실행 결과로 합성하지 않음 |
| `8c9ef61d`: P2 관련 고정 입력 회귀 | **192/192 PASS**, fail/cancel/skip/todo0·exit0·signal null·입력 변경0. 원본 `p2-handles-fixed{.log,-before.json,-after.json,-status.json}` |
| `8c9ef61d`: workspace 독립 설치 | **25/25 PASS**. tarball을 선언한 의존 closure만으로 설치하고 공개 entry·자체 declaration·해당 installed-runtime smoke 확인. 외부 SDK declaration 진단44개는 원시 로그에 별도 남음 |
| `8c9ef61d`: 실제 Mac 26/15·Ubuntu CI | Mac 각각 21/21, Ubuntu 20/20 PASS. 세 OS의 input digest가 `ab24d1368aea45d3e95aee4c0417bd6e65c7404dbeed44685213dd59447111f8`(15556개)로 동일. gate job은 계속 BLOCKED |
| P3 wake·CLI handle 연결 후 Linux 회귀 | build·strict typecheck·transaction 검사 PASS. captured T·wake·drain·현재 authority·CLI 입력 관련127/127, 실제 Mail→살아 있는 Broker hint 연결·same-key·rollback 관련30/30 PASS. 서로 다른 부분 실행이며 전체 PASS로 합성하지 않음 |
| `663adda3`: 실제 Mac 26/15·Ubuntu CI와 독립 설치 | Mac 각각28/28·Ubuntu27/27, workspace 독립 설치25/25 PASS. 공통 CI 세 OS의 input digest `f7750bfd598ef32554bc06176af265645a69c2a2735a66393abcf847aaaa3292`(15558개) 동일. 별도 Darwin gate는 BLOCKED |
| `663adda3`: 고정 입력 전체 local | FAIL. serial9 PASS, parallel3646 중 PASS3642·FAIL4. skip/cancel/todo0·exit1·signal null·입력 변경0. `local-p3{.log,-before.json,-after.json,-status.json}` 보존 |
| 위 4개 fault/checkpoint 연결 수리 | 관련35/35 PASS·skip0·입력 변경0. input `046211bd0c8ecb72fb29129d4200559d680d5460495893dde6bb921f0575cc95`(15558개). `p3-fault-repairs{.log,-before.json,-after.json,-status.json}` 보존. 전체 PASS로 합성하지 않음 |
| 26번째 tool-files workspace 분리 후 Linux 검증 | 정식 build·strict typecheck·정적 architecture PASS. 관련189/189, 별도 실제 SIGKILL·복구17/17, 독립 설치26/26 PASS. input `df4f5b65796e6429afcf52ccbb88c61b050132bb406ecd0964b01ae28e199135`(15564개), 세 실행 모두 입력 변경0. 전체 local PASS로 합산하지 않음 |
| 위 변경의 시험·빌드 실행 오류 | 최초 빌드는 도중 package.json 표기 편집을 입력 고정 검사가 거절했다. 최초 부분 시험160/163은 TS 원본 직접 실행으로 세 상대 경로가 어긋났다. 입력을 고정한 정식 빌드와 컴파일된 시험으로 위 결과를 얻었으며 최초 실패 로그도 보존 |
| `f042b159`: 고정 입력 전체 local·실제 CI | 전체3660/3660 PASS(serial9·parallel3651), skip/cancel/todo0·exit0·입력 변경0. 실제 Mac26/15·Ubuntu 공통 CI 각각30/30·build26/26. 세 OS와 local input `57327bddba87ce9a33f9e266e03d856c355d7a050c55d456b966753c6f26be65`(15564개) 동일. 별도 Darwin gate는 OPEN/BLOCKED |
| OS 경계 확대의 Linux 실행 | 새 실제 OS11개·기존 primitive4개·Linux pidfd/Unix credential5개, 합계20/20 PASS. input `a0143e84c5482b632f25e55cd83450d18b6cbe43c56b2b6d41f3fa7835927be2`(15566개), 입력 변경0. `os-boundaries-linux{.log,-before.json,-after.json,-status.json}` 보존. 새 Darwin 독립 사례는 실제 CI로 별도 판정 |
| 실제 macOS 26/15 Keychain | 독립 Swift primitive SDK typecheck PASS. signed Keychain·release 실행·TCC는 미실행 |
| 현재 source의 전체 local·최종 architecture/trace qualification | 미완료. 일부 이전 실행 PASS를 합산하지 않음 |

실제 workflow: [40195568898](https://github.com/minjung2035/oma-v2/actions/runs/40195568898),
[40197183201](https://github.com/minjung2035/oma-v2/actions/runs/40197183201),
[40200893255](https://github.com/minjung2035/oma-v2/actions/runs/40200893255),
[40201140402](https://github.com/minjung2035/oma-v2/actions/runs/40201140402),
[40201962210](https://github.com/minjung2035/oma-v2/actions/runs/40201962210),
[40202613809](https://github.com/minjung2035/oma-v2/actions/runs/40202613809),
[40202936879](https://github.com/minjung2035/oma-v2/actions/runs/40202936879),
[40205394437](https://github.com/minjung2035/oma-v2/actions/runs/40205394437),
[40207646347](https://github.com/minjung2035/oma-v2/actions/runs/40207646347),
[40210726412](https://github.com/minjung2035/oma-v2/actions/runs/40210726412),
[40216022510](https://github.com/minjung2035/oma-v2/actions/runs/40216022510).
모든 실패 artifact를 보존한다. 원시 local 로그는
`/home/dev/oma-audit-artifacts/native-2026-10-25/`에 있다. 새/변경 source는 NOT_REVIEWED이며
고정 architecture·authored review·과거 검토 기록은 변경하지 않는다.

첫 전체 실행의 입력은 `bcb1b03b01d3605ef0155d0d14d201d35eea9747797109ccd42b8932f67359f2`
(15564개)이며 실행 전후 동일하다. 원시 결과는 위 artifact 디렉터리의
`local-frozen.log`, `local-frozen-before.json`, `local-frozen-after.json`,
`local-frozen-status.json`이 소유한다. 실제 bwrap을 private mount로 배치한 부분 시험은
실제 service/cgroup 또는 manager 없는 제품 실행의 증거가 아니다.

수리 후 전체 실행은 2026-10-25 15:06:43.852–15:21:40.916 UTC에 실행했다.
입력 `7c71573c808ff941dd9849690bf895ccb8e8fe0907ad9616a9c73250dc559d4c`(15556개)는
전후 동일하다. 원본은 `local-repaired.log`, `local-repaired-before.json`,
`local-repaired-after.json`, `local-repaired-status.json`이다. 실행 뒤의 파일 handle 변경은
이 전체 PASS의 입력이 아니다. 이 입력에서도 local runner가 별도로 제외한 service/cgroup
suite 9개는 NOT_RUN이며 Darwin 세 gate의 proof로 합산하지 않는다.

`8c9ef61d`의 실제 Mac 26/15에서 connector가 인계 전에 queue한 첫 바이트를 읽기 전·후
모두 LOCAL_PEERPID는 holder를 가리켰다. 두 process는 살아 있었다. 현재 endpoint의 마지막
PID를 각 요청의 발신자로 간주할 수 없다는 반례이며 G-AUTH를 OPEN으로 유지한다.
SHA-256을 확인한 원본 zip·probe·SDK·시험·input artifact는 `ci-8c9ef61d/`에 보존했다.
그 뒤 CLI context의 held descriptor 연결은 위 runtime/설치 결과의 입력에 포함되지 않는다.

남은 구현은 [전환 기록](native-transition.md)을 따른다. 직접 실행 scope·auth·owned 파일
pin/reopen·quarantine/checker·설치와 P7 최종 대조가 남아 있으며 full support 완료가 아니다.

## 이전 입력의 코드 검증: DR48 (2026-10-25)

| 검사 | 실제 결과와 범위 |
|---|---|
| 전체 local suite | **4184/4184 PASS**. serial9 + parallel4175, fail/cancel/skip/todo0, status0/signal null, 951.28초 |
| 실행 입력 | 15681개, `06811f22e03c6e8eca2e088c1780579a2c3f3525124ec1b3f4b48b4ee77a1c13`. 실행 전후 변경0 |
| build·strict typecheck·전체 정적 gate | PASS. architecture·transaction·durable-boundary·document·spec 검사를 포함 |
| 최신 App 독립 설치 | PASS. 실제 Restic/SQLite close→read-only→reopen, 공개 entry·자체 declaration·설치 runtime |
| Domain·Native·Storage 독립 설치 | PASS. 이후 해당 package 소스 변경 없음 |
| 설치 확인 | 설치된 `oma --help`, managed Restic 0.19.1 확인 |
| review | 새/변경 코드 NOT_REVIEWED. 과거 authored review를 갱신하지 않음 |

원시 결과의 소유자:
`/home/dev/oma-audit-artifacts/session-storage-2026-10-25/verification-result.json`.
같은 디렉터리의 `local-full-accepted.log`, `*-before.json`, `*-after.json`, `*-status.json`이 실제 입력과 종료 상태를 보존한다. 실행 뒤 결과·운영 안내·인계를 기록한 차이는 `post-runtime-input-relation.json`에 있다.

DR48은 Git index·local refs·staged/unstaged·untracked/ignored 파일, mode·소유권·nanomtime·symlink·내부 hardlink의 보관/복원과 삭제·게시 후 실패 재시도를 검사했다. 두 세션의 동일한 random 4MiB 파일은 source 합계 8,388,608 bytes에 대해 unique stored data 4,235,172 bytes였다. 이 fixture 결과를 제품 전체 절감률로 사용하지 않는다.

초기 손상 시험에서 Restic tree cache가 repository 손상을 가린 실패를 보존했다. `--no-cache` 수정 후 실제 손상 pack과 원본 보존을 검증했다. SQLite read-only 조회가 만든 빈 WAL 때문에 복원이 막히던 결함도 회귀로 확인했다. 첫 전체 실행은 수정 전에 SIGTERM으로 중단했으며 PASS로 계산하지 않는다. 자세한 실패·수리 과정은 [정리 전 검증 전문](../archive/documentation-cleanup-2026-10-25/validation.md)에 있다.

## 기동 시간의 마지막 측정 (2026-10-25)

같은 설치·프로젝트에서 통제한 전후 각 3회 중앙값이다.

| 측정 지점 | 이전 → 개선 후 | 측정 경계 |
|---|---|---|
| 대화 화면 | 4.50 → 4.27초 | 실제 entry·PTY·SDK·Open TUI, local scripted provider, systemd 조작 차단 |
| 첫 provider 요청 | 4.77 → 4.54초 | 위와 같은 통제 환경. 실제 외부 provider 응답 시간 아님 |
| 저장소 준비 | 12.69 → 9.67초 | 별도의 실제 Git 준비 측정. Workers 최종 준비 시간 아님 |

VM을 포함한 전체 Society 시작 시간은 측정하지 못했다. 서로 다른 측정값을 더해 전체 시간으로 표시하지 않는다. 원시 입력·로그·실패·검증 판정은
`/home/dev/oma-audit-artifacts/society-startup-2026-10-25/verification-result.json`에 있다.

## DR48 입력의 실제 환경 검증과 당시 한계

| 항목 | 현재 판정 |
|---|---|
| 현재 코드의 실제 Linux 서비스/cgroup qualification | NOT_RUN. local runner에서 별도 제외한 suite이며 private bwrap overlay로 대체하지 않음 |
| native macOS·Swift helper·VM·Keychain·APFS | NOT_RUN. 이 저장소에 설치 가능한 OMA.app/guest image 배포물 없음 |
| 현재 코드의 실제 provider turn·release qualification | NOT_RUN. scripted/loopback 검사는 외부 서비스 증거가 아님 |
| 실제 power-loss 내구성 | NOT_RUN. SIGKILL·in-process fault 결과와 구분 |
| 실제 manager/cgroup candidate 검사·reviewer shortage 예외 | 기존 독립 거절의 영향이 남음. fixture 성공으로 실행 지원을 주장하지 않음 |
| 선택적 notmuch·reflink·fresh verifier 및 모델 품질/비용 우위 | 활성 구현이나 비교 실험이 확인된 기능으로 표시하지 않음 |

DR48은 ACL/xattr·special file·nested mount·읽을 수 없는 파일·복원할 수 없는 소유권이 있으면 회수를 거부하고 원본을 남긴다. 도구·키·checkpoint·closed DB identity가 확인되지 않는 cold 세션은 시작하지 않는다. Restic의 과거 snapshot을 자동 prune하지 않으므로 고유 데이터의 누적은 남는다. 상세 사용법은 [operations](../operations.md)가 소유한다.

과거 kernel/crash·provider 실행 기록은 해당 당시의 입력에 대한 기록이다. 현재 입력의 미실행 범위를 그 기록으로 닫지 않는다. 측정용 임시 VM은 제거됐고 전체 VM+Society 시간 결과는 없다.

## 문서 정리의 검증 (2026-10-25)

| 검사 | 결과 |
|---|---|
| 전체 정적 gate `npm run check:architecture` | PASS. workspace·legacy·source inventory·architecture rule·transaction·durable boundary·문서·spec 검사 위반0 |
| 문서·trace·inventory·decision·review closure·verification policy 회귀 | **77/77 PASS**. fail/cancel/skip/todo0 |
| 위 두 실행의 입력 | 15674개, `2f870978ea6dbbb62e8b666d0d8bb29b9ce9a496ef4efda8ac66bb6ac3a1e8b6`. 각각 실행 전후 변경0 |
| 보존 확인 | 원문 사본13개·기존 archive·architecture·PRIORITY-0·review-notes bytes 일치. 규범 조항375개 fingerprint 동일 |
| 변경 범위 | 문서만 변경. production code·schema·설정·권한·기계 판독 map 변경 없음. 전체 runtime suite 재실행은 NOT_RUN |

결과를 기록하기 전 입력의 원시 로그와 상태는
`/home/dev/oma-audit-artifacts/documentation-cleanup-2026-10-25/`의 `architecture.log`, `documentation-tests.log`, 각 `*-before.json`/`*-after.json`/`*-status.json`이 소유한다. `preservation.json`은 문서 원문·규범·보호 파일·코드 입력의 보존을 확인한다. 이 결과를 인계·validation에 기록한 뒤의 입력 차이와 재검사는 같은 디렉터리의 `post-check-input-relation.json`, `final-documentation-checks.log`, `verification-result.json`에 구분한다. 정적 검사는 실제 플랫폼 qualification이 아니다.

정리 전 인계·검증·감사·계획 원문은 [보관 색인](../archive/documentation-cleanup-2026-10-25/README.md)에 있다. 문서를 옮겨도 요구 ID·수용 번호·과거 실패·검토 판정은 유지한다.

## 검증 입력과 LOC

아래 값은 **구조 검사의 현재 입력 identity**다. digest 생성은 runtime PASS를 만들지 않는다.

verification input digest `56991abb99703cec806c932adf310dcf89f1319e06782403bf66729f30bb8030` (15597 files).

현재 source 목록은 [production-files.txt](../../production-files.txt), per-file SHA-256은 [production-loc-hashes.json](../../production-loc-hashes.json)이 소유한다. `npm run check:inventory`는 cloc 없이 source bytes를 확인한다. `npm run evidence:refresh`의 구조 재생성과 실제 runtime 실행은 별도다.

이전 기록의 cloc 2.08 측정치: 354 files / 35,832 code LOC. 이 역사적 기록은 현재 source의 LOC claim이 아니며, 문서 정리로 새 측정치를 만들지 않는다. DR46 마지막 LOC 시도는 같은-source 반복 결과 불일치로 UNRELIABLE이다. 유효한 최종 LOC·감소율은 주장하지 않는다.

현재 LOC 측정의 경로는 `node scripts/loc.mjs --out <evidence-directory>`가 생성·검증하는 CI artifact `production-loc.json`과 `production-measurement-hashes.json`이다. 생성기는 committed source digest를 먼저 확인하며, source/tool/report의 불일치를 손으로 고치지 않는다. 크기 상한은 없다.

## 재검증 명령

명령의 실제 정의는 [package.json](../../package.json), 요구 범위는 [verification-spec](../verification-spec.md)이 소유한다.

```sh
npm run check:documents
npm run check:spec-inventory
npm run check:inventory
npm run check:architecture
node --test test/document-integrity.test.mjs test/traceability-policy.test.mjs test/production-inventory.test.mjs
```

코드 변경이 있으면 해당 lane을 추가한다. 실제 환경이 필요한 suite는 지원·허용 환경에서 실행하고, 미실행은 NOT_RUN으로 기록한다.
