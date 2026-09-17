# 5c94e59 감사 후속 — EML 수락 경계와 CLI

기준: `5c94e59c913bf1b6bd96f02307a99882e776077f`, `refactor/safety-preserving-architecture`.
이전 [F1–F4 수정](f1-f4-remediation.md)과 별개의 후속이다. 실행 결과/source pin은 [현재 검증 상태](../../implementation/validation.md)에만 기록한다.

## 수정 범위

| 항목 | 수정과 회귀 |
|---|---|
| 긴 subject의 수락 후 mail 손상 판정 | 공용 `buildEml`이 모든 새 결과를 같은 OMA header parser로 검증한 뒤 반환한다. 따라서 submit/context도 freeze/accept 전에 거절한다. raw Subject가 RFC line 한도를 넘으면 UTF-8 B encoded-word와 folding을 사용하며 host subject 상한을 임의로 낮추지 않는다. 989/990-byte 경계, 긴 ASCII/Unicode, 제어된 MIME dependency 오류, accepted pending의 동일 ID/plan/bytes 복구와 후속 admission을 검사한다. |
| CLI의 first-parent prerequisite | 새 요청에서 `git.known`을 조회하고, 광고된 OID 중 로컬 commit이며 candidate ancestor인 하나만 선택한다. 없으면 self-contained, candidate가 이미 알려졌으면 no-bundle이다. broker 목록에는 main과 published tips를 중복 없이 넣고 최종 frame 예산으로 제한한다. 잘린 목록과 별개로 candidate 보유 여부를 유지한다. SHA-1/SHA-256의 3가지 전송 형태와 moved-HEAD retry를 실제 CLI/RPC/Git/Store fixture로 검사한다. |
| 예측 가능한 shared `/tmp` bundle 및 잔존 | `mkdtemp`의 무작위 0700 디렉터리 안에서 생성한다. no-follow/non-blocking fd와 regular-file/single-link 확인 후 읽고 `finally`로 정리한다. 이 범위 안에서는 `process.exit`하지 않는다. 성공 및 제어된 Git/read 실패 모두 cache freeze 이전에 임시 산출물을 정리한다. unrelated fixture 파일은 보존한다. |
| 파일 본문의 CRLF | send/submit/agent brief를 읽을 때 CRLF만 LF로 바꾼 뒤 cache/hash/wire에 전달한다. BOM, 나머지 공백, lone CR은 보존한다. 같은 키 재시도는 원본 파일이 없어져도 frozen bytes를 사용한다. broker나 durable evidence를 재정규화하지 않는다. |
| reply 기본 제목 | `Re: <원문 제목>`을 사용하며 pinned MIME writer의 UTF-8 B/Q words를 한 번만 decode한다. 명시한 subject는 요청/cache에서 그대로 유지한다. 기존 parser의 raw subject projection과 policy의 B-only 규칙은 유지한다. 재시도 비교는 생략된 subject에 새 기본값을 만들어 넣거나 reply 파일을 재독해하지 않는다. |

과거 `implementation/conformance-followup.md`의 first-parent 문구는 당시 구현 기록이지 GIT-004 MUST의 예외가 아니다. 이번 변경으로 해당 경로를 대체했다.

통합 검증에서는 기존 context preparation의 auto-maintenance가 `fsyncTree`와 경합해 사라진 `maintenance.lock`을 관측한 실패도 나왔다. context commit 환경의 자동 maintenance를 끄고 해당 fetch 경로에 `--no-auto-maintenance`를 적용했다. fsync/error 검사를 완화하지 않았으며, 실제 Git trace로 commit/fetch 실행과 maintenance/gc child 미실행을 함께 검사한다.

## 테스트와 소유권

- `test/audit-eml-admission.test.ts`: 공용 emission guard, 긴 subject, accepted evidence 보존과 복구.
- `test/audit-cli-submit.test.ts`: 실제 CLI, 양쪽 Git object format, bundle/no-bundle, cache replay, 임시 파일 수명, body 정규화.
- `test/audit-git-known.test.ts`: main 포함, 중복 제거, 응답 frame 경계와 candidate 정보.
- `test/audit-cli-text.test.ts`: B/Q 단일 decode, reply 기본/명시 subject, normalized body/brief와 삭제된 source 재시도.
- `test/fixtures/cli-peer.ts`: production RPC transport를 사용하는 소유 local peer. native authentication이나 배포 환경의 대역 증명이 아니다.
- fast에는 text/known, durable에는 emission/submit 회귀와 required-name 검사를 추가했다. 기존 테스트나 positive READY 요구를 삭제하지 않았다.
- 기존 maximum-key CLI fixture는 `git.known` 응답을 추가하고 이전 shared `/tmp` 경로 삭제를 제거했다. approval metadata fixture는 정상 OMA Message-ID를 사용한다. 기존 assertion과 independent MIME decoder는 유지한다.

## 변경하지 않은 경계

Wire/DB/persisted v1 schema와 accepted evidence는 변경하지 않았다. transient unknown과 진짜 accepted corruption은 구분하며, `STORE_CORRUPT` 차단을 완화하거나 새 plan으로 치환하지 않는다. pinned MIME의 기존 raw-header 외곽 공백 렌더링은 변경하지 않았다. IPC request/cache의 subject 공백 보존과 구분한다.

무작위 디렉터리와 fd 검사는 전체 same-UID filesystem/process-memory 방어 또는 SIGKILL/power-loss 후 임시 파일 자동 청소 보장이 아니다. cached bundle은 재시도 증거이므로 임시 산출물과 함께 지우지 않는다.

지원된 storage quota profile이 없다는 qualification blocker, 실제 READY 시험 요구, OPEN SPIKE, LOC/release 승인 게이트를 유지한다. local/fast/durable PASS를 실제 systemd/provider/power-loss 또는 release 인증으로 확대하지 않는다.
