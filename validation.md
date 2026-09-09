# 설계 및 runtime 검증 기록

이 문서는 primitive 조합의 초기 검증과 현재 `oma-v2` runtime 검증의 색인을 제공한다. 최신 실행 결과와 남은 release blocker는 [implementation/validation.md](implementation/validation.md)를 기준으로 한다.

## 2026-09-10 현재 상태

현재 HEAD는 `326a1d6` (`close lifecycle and batch deterministic contracts`)이며 다음을 실행했다.

```text
npm test              83 passed, 0 failed, 0 skipped
node scripts/loc.mjs  9,900 non-empty physical lines
```

이번 상태에서 확인된 구현 범위는 다음과 같다.

- persisted resolved spec을 기준으로 capability를 확인하고, 동적으로 만든 Resident도 자신의 workspace/profile로 runner를 연다.
- 같은 name과 resolved spec의 create 요청은 하나의 physical create로 수렴하고, 다른 resolved spec은 충돌한다.
- GOAL 전 activation 차단, broker singleton lock, stop/start의 실제 systemd 관측, stale cgroup 차단이 실행된다.
- batch fairness/notice shape와 Principal relay의 new→cur 동작이 실행된다.
- Git bundle quarantine, published ref, main CAS, policy reread, context CAS/reconcile이 실행된다.
- Pi 0.85.1 sandbox/custom message 전달은 확인했지만, provider가 없는 환경에서는 trusted session-boundary evidence가 생성되지 않는다.

전체 test-to-requirement audit과 unresolved 목록은 [implementation/validation.md](implementation/validation.md)의 Phase 10 및 coverage map을 본다. `npm test`의 성공은 S-03/S-04/S-06/S-09 release gate를 통과했다는 뜻이 아니다.

## LOC 계산 주의

현재 `scripts/loc.mjs`는 기존 baseline 호환을 위해 공백 줄만 제외한 non-empty physical line을 계산하며 결과는 9,900이다. 공백과 comment-only line을 모두 제외한 code-only cloc audit은 9,407이다. 두 계산을 동일한 숫자로 취급하지 않으며, canonical LOC 계산기는 normative spec에서 최종 고정해야 한다.

아래의 초기 primitive 검증 기록은 2026-09-07 설계 단계에 OMA 저장소를 열지 않고 별도 임시 디렉터리에서 수행한 것이다. 이는 아키텍처에 사용하는 기존 도구의 동작 확인이며, OMA runtime 구현 완료를 뜻하지 않는다. 현재 runtime audit은 위의 2026-09-10 상태와 [implementation/validation.md](implementation/validation.md)에 별도로 기록한다.

## systemd 설정

- broker, Resident service/path, Principal relay/path, reconcile service/timer 총 7개 초안을 생성했다.
- 임시 사본에서 미구현 ExecStart를 `/usr/bin/true`로 치환했다.
- `systemd-analyze verify --man=no`가 exit 0으로 통과했다.
- 실제 service 설치·시작, path activation timing, systemd user manager 자원 제한은 실행하지 않았다.

## Git

1. 256 KiB의 합성 base 파일을 가진 작은 Git 저장소를 생성했다.
2. central bare repo와 두 개의 독립 clone을 만들었다.
3. A의 commit이 B의 HEAD를 변경하지 않는 것을 확인했다.
4. A의 게시 ref에서 base를 prerequisite으로 제외한 bundle을 만들었다.
5. central에서 bundle을 검증·수입하고 B가 게시 ref를 fetch했다.
6. B가 읽은 파일 내용이 A의 candidate와 일치했다.
7. A의 main CAS 이후 같은 old OID를 사용한 B의 CAS가 거절됐다.

이 합성 사례의 bundle 크기는 증분 413 bytes, 전체 262,767 bytes였다. 이것은 증분 경로가 작동한다는 확인이며 실제 저장소의 절감률 예측이 아니다.

## Maildir 파일 조합

- 동일 원문의 hardlink를 A/B mailbox의 new에 만들었다.
- B의 파일은 cur로 이동했다.
- C에게는 아직 전달하지 않은 상태에서 수신자 snapshot을 재대조했다.
- C에게만 추가 link를 생성했으며 A/B의 메일은 중복되지 않았다.

이는 부분 fanout과 new/cur 확인 규칙의 작은 파일 실험이다. daemon을 실제로 죽이거나 SQLite와 Maildir를 함께 crash-test한 결과는 아니다.

## 아직 구현 단계에서 검증할 것

- Pi의 고정 버전에서 custom notice, steer/followUp, session 기록 경계.
- 실제 systemd.path와 runner의 idle/stop/start-limit 상호작용.
- Linux peer credential과 cgroup/namespace identity 매핑.
- bubblewrap의 전체 tool 격리와 Principal 도구 교체.
- provider stream·quota·unknown usage.
- notmuch index 생성/재생성 및 readonly 조회.
- disk-full, broker crash, filesystem flush, 백업 복원.
- 실제 저비용 society + 고성능 Principal의 품질·비용 비교.
