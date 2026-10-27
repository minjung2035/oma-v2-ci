# 적대적 검증 공통 지침 (2026-09-28)

저장소: `/home/dev/oma-v2` (branch `feat/macos-hidden-vm`, HEAD `070a52d`). 이 검토는 **코드를 절대 수정하지 않는다.** 결과는 문서와 재현 스크립트뿐이다.

## 최상위 불변조건

`PRIORITY-0.md`를 먼저 전부 읽는다. 명제: "한 번 durable하게 확정된 사실의 의미는, 이후의 프로세스·권한·재시작·복구 때문에 바뀌어서는 안 된다." 하위 규칙 P0-1…P0-7이 판정 기준이다. 필요하면 `implementation/schema-v1.sql`, `MAINTENANCE.md`(§3–§18), `implementation/durable-boundaries.json`, `implementation/validation.md`의 "알려진 한계"(203–250행)를 참고한다.

기존 시험·문서·점검 결론(P0V-xx "고쳤다")을 믿지 않는다. 이미 고쳤다고 적힌 결함이 실제로는 남아 있으면 그것도 발견이다. 단, `validation.md` "알려진 한계"에 이미 적힌 한계를 다시 보고할 때는 `known-limitation`으로 표시하고, 그 문서의 서술이 실제 코드와 다를 때만 결함으로 올린다.

## 절대 규칙

1. `review/adversarial-2026-09-28/` 밖의 파일을 만들거나 고치거나 지우지 않는다. `git` 쓰기 명령(commit, stash, checkout, reset, add)을 쓰지 않는다.
2. `npm run build`, `npm test`, `npm ci`를 실행하지 않는다(다른 검토자와 `dist/`를 공유한다). `dist/`는 HEAD로 이미 빌드되어 있다. 기존 시험 하나를 돌리려면 `node --test dist/test/<name>.test.js`만 쓴다(systemd·sudo가 필요한 시험은 제외).
3. `systemctl`, `sudo`, `loginctl`, 네트워크 접속, 실제 provider/credential 사용을 하지 않는다. `auth.json`, keychain, `.env`, `/home/dev/oma-evidence/` 아래는 읽지 않는다.
4. 재현 스크립트는 `review/adversarial-2026-09-28/repro/<그룹ID>/` 아래에만 둔다(`.mjs` 권장, `dist/src/...js`를 상대 경로로 import). 임시 파일은 `mkdtemp`로 `/tmp/oma-adv-<그룹ID>-*` 아래에만 만들고 스크립트 끝에서 지운다. 오래 걸리거나 무한 루프가 될 수 있는 실행에는 `timeout 60`을 붙인다.

## 읽는 방법

- 할당된 파일을 **처음부터 끝까지 한 줄도 빼지 않고** 읽는다(read 도구로 나눠 읽는다). 키워드 grep으로 대신하지 않는다.
- **커버리지 증명(필수):** 시작할 때 `wc -l <할당 파일들>`을 실행해 실제 줄 수를 얻는다. 각 파일은 read의 `offset`/`limit`로 나눠 **마지막 줄까지** 읽고, 커버리지 표의 "줄 수"에는 `wc -l` 값을, 비고에는 "마지막으로 읽은 줄 N"과 그 줄의 내용 앞 20자를 적는다. 1차 wave에서 줄 수를 추정으로 적은 보고가 있었다. 추정치는 허용하지 않는다.
- 발견이 적다고 끝내지 않는다. 파일마다 실제로 시도한 공격 시나리오를 §5에 적어(최소 2개, 줄 번호 근거) 무엇이 막았는지 보인다.
- 호출 경로를 확인하려면 그룹 밖의 파일도 읽는다(호출자·피호출자). 그러나 판정 대상은 할당된 파일이다.
- 파일마다 다음을 묻는다. 이 파일이 만들거나 읽는 durable fact는 무엇인가? owner는 누구인가? 각 catch / timeout / null 분기는 unknown을 사실로 승격하는가? 각 write 직후 SIGKILL이 오면 다음 실행은 무엇을 보는가?

## 우선 공격 벡터 (정상 경로보다 먼저)

- 실패·중단: 모든 syscall/await 사이의 SIGKILL, 예외, EINTR, 부분 성공(rename 성공 뒤 fsync 실패 등), 일부만 끝난 여러 단계 효과
- 재시작·복구: 복구 코드가 정상 경로와 다른 결론을 내는가, 복구의 멱등성 `R(R(s)) == R(s)`, 복구 중 다시 죽기
- 부분 쓰기: 잘린 파일, 0바이트 파일, 임시 파일 잔재, 디렉터리 fsync 누락, WAL/transaction 경계 밖의 물리 효과
- 시계 역행: `Date.now()` 역행·점프, 단조 시계와 벽시계 혼용, `updated_at_ms >= created_at_ms` 같은 CHECK 위반을 만드는 역행, 타이머 기한 계산
- 자원 고갈: ENOSPC, EMFILE, EAGAIN, 큰 입력, frame 한계, 무제한 목록/버퍼, 메모리, 자식 프로세스 누수, FD 누수, listener 누수
- 경계값: 0, 음수, `Number.MAX_SAFE_INTEGER`, NaN, 빈 문자열, NUL, 개행, 비 UTF-8, 매우 긴 이름, 대소문자, 유니코드 정규화, 중복 key, JSON prototype key(`__proto__`)
- 동시성: 두 broker, 같은 UID의 적대 프로세스, TOCTOU, symlink/hardlink 교체, 같은 request key의 동시 요청, 이벤트 순서 뒤바뀜
- 권한·소유권: peer credential 확인, 파일 mode/uid, 권한을 과거 값으로 재사용, 소유권 이전 후 이중 반납
- 구조: 같은 결정의 중복 구현(P0-2), 이름 없는 특수처리(P0-6), 리팩터링이 필요한 지점

## 산출물

`review/adversarial-2026-09-28/groups/<그룹ID>.md` 한 파일(한국어, 식별자·코드는 원문). 형식:

```
# <그룹ID> 적대적 검증 결과

## 1. 커버리지
| 파일 | 줄 수 | 전부 읽음 | 비고 |   ← 할당 파일 전부, 한 줄씩

## 2. 발견 요약
| ID | 심각도 | 분류 | 제목 | 확신도 |

## 3. 발견 상세
### <그룹ID>-NN 제목
- 심각도: Critical | High | Medium | Low | Info
- 분류: bug | logic | race | recovery | authority/ownership | persistence | resource | boundary | structural
- 위반 규칙: P0-x (또는 없음)
- 코드 경로: `파일:줄` → `파일:줄` (실제 줄 번호)
- 원인:
- 영향:
- 최소 반례: (구체적 입력·순서·타이밍)
- 재현 방법: 스크립트 경로와 명령, 관측된 출력 한두 줄. 실행하지 못했으면 "추론만"이라고 쓰고 단계를 정확히 적는다.
- 확신도: confirmed(재현됨) | high | medium | low
- 개선 방향: (코드를 고치지 말고 방향만)

## 4. 리팩터링 필요 지점
## 5. 점검했고 문제없다고 판단한 것 (공격했지만 막혀 있던 경로, 근거 줄 번호)
## 6. 확인하지 못한 것
```

심각도 기준:
- **Critical**: 현실적인 조건에서 확정된 사실의 의미가 바뀌거나, 데이터가 사라지거나, 보안 경계가 깨진다.
- **High**: crash·restart·timing으로 닿을 수 있는 P0 위반(unknown을 사실로 승격, 중복 효과, 권한 혼동), 또는 운영자 수리 없이는 풀리지 않는 정지.
- **Medium**: 드문 조건이 필요하거나, 조용한 손상 없이 멈추거나 잘못 거절한다.
- **Low**: 견고성, 진단 품질, 작은 경계값.
- **Info**: 구조·리팩터링 제안.

오탐을 줄인다. "그럴 수 있다"가 아니라, 코드 줄을 따라 도달 경로를 끝까지 확인한 것만 발견으로 적는다. 방어 코드가 다른 층에 있으면 그 줄을 찾아 확인한다. 확인하지 못했으면 확신도를 낮추고 §6에 적는다.

## 최종 응답

작업을 마치면 응답은 짧게: 산출물 경로, 심각도별 개수, High 이상 발견의 ID·제목·코드 경로 한 줄씩. 상세는 파일에만 둔다.
