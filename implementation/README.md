# implementation/ — 색인

이 디렉터리에 있는 파일이 무엇인지 적는 색인이다. 문서의 권위·우선순위와 새 정보를 적는 곳은 [문서 지도](../docs/README.md)가 정한다.
읽기 순서도 그 지도를 따른다(코드를 고친다면 [MAINTENANCE.md](../MAINTENANCE.md) §1).

## 규범 문서

spec을 구체화하는 계약이다. `**MUST [ID]**` 조항은 [traceability.json](traceability.json)이 fingerprint로 inventory한다.

| 문서 | 소유하는 것 |
|---|---|
| [physical-ordering.md](physical-ordering.md) | durable·physical effect의 canonical 순서 |
| [integration-policy.md](integration-policy.md) | base/tiered integration 정책 |
| [compliance.md](compliance.md) | requirement → owner → executable evidence 계약 |
| [loc-budget.md](loc-budget.md) | production LOC·inventory 측정 계약 |
| [test-matrix.md](test-matrix.md) | 수용 oracle: Core T01–T77, 제품 표면 T91–T127. T78–T90은 tiered 예약 대역이며 행이 아직 없다 |
| [spikes.md](spikes.md) | OPEN qualification·spike 조건 |
| [validation.md](validation.md) | 현재 검증 판정과 수치, 알려진 한계, 재검증 명령(VAL 조항 포함) |
| [store-opening.md](store-opening.md) | Store를 열 때 writer 준비 전 호환성 판정 |
| [contracts/README.md](contracts/README.md) | contract owner 경계 |
| [systemd/README.md](systemd/README.md) | unit template 계약(UNIT-TPL) |

`contracts.ts`, `contracts/`, `schema-v1.sql`, `systemd/*.in`, `cloc-systemd.lang`은 문서가 아니라 실제 선언·배포 표면·측정 filter다.

## 결정 기록과 점검 기록

규범이 **왜** 그런지 적는다. 규범 문장 자체는 spec과 위 규범 문서가 가진다. 절 제목의 상태는 작성 당시의 것이고, 지금의 검증 상태는 [validation.md](validation.md)가 소유한다.

| 문서 | 내용 |
|---|---|
| [consistency-decisions.md](consistency-decisions.md) | 계획의 D01–D06, 카드(WP)별 결정, 재검토와 AV1–AV31, ENG1 |
| [design-revisions.md](design-revisions.md) | 설계 수정 DR1–DR14, 바꾼 규범, architecture와 어긋나는 문장 |
| [priority-0-audit.md](priority-0-audit.md) | Priority 0 파일 단위 점검: 근거(파일:줄), 코드 발견 P0V-01–P0V-24와 수정 commit, 변이 결과, 14차 실제 점검, 문서·식별자 발견 P0D-01–P0D-14, 외부 전수 검토를 판정한 4차 점검 P0V-25–P0V-53 |

## machine-readable map

검색으로 owner를 추론하기 전에 먼저 본다.

| 파일 | 먼저 볼 때 |
|---|---|
| [mutation-owners.json](mutation-owners.json) | durable mutation 추가·수정, 관련 runtime/test owner |
| [source-owners.json](source-owners.json) | requirement별 production owner·call path |
| [durable-boundaries.json](durable-boundaries.json) | durable 경계 owner별 kill·retry·restart 시험(P0-7, `check:boundaries`) |
| [oracle-map.json](oracle-map.json) | 계획 oracle을 담당하는 시험과 lane |
| [review-ledger.json](review-ledger.json), [review-notes.json](review-notes.json) | production 파일별 검토 상태와 근거(`npm run review:ledger`로 생성) |
| [traceability.json](traceability.json) | 규범 조항 fingerprint와 evidence inventory |
| [contract-direction-plan.json](contract-direction-plan.json) | contract → implementation 역의존 제거 계획 |
| [broker-lifecycle-review.json](broker-lifecycle-review.json) | broker lifecycle 분리 여부 판단 |

```sh
npm run mutation:locality -- git.submit
```

`durable.ts`, `validate.ts`, `protocol/methods.ts` 같은 중앙 registry는 파일 크기만으로 분해하지 않는다. map의 `path + symbol`로 필요한 section만 읽는다.

## 생성물과 시험 보조

- `../production-files.txt`, `../production-loc.json`, `../production-loc-hashes.json`: production inventory·LOC artifact.
- `evidence/dependency-graph.json`: dependency evidence. import·source graph를 바꾼 뒤 `npm run evidence:graph`로 다시 만든다.
- `adversarial-review.md`: `scripts/adversarial-report.mjs`가 필요할 때 만드는 point-in-time report. 현재 지침이 아니다.
- `tests/`: type-level 시험(`*.type-test.ts`)과 LOC 측정 fixture.

생성물은 사람이 새 측정처럼 손으로 고치지 않는다.

## 과거 기록

완료된 phase·audit·closure 문서와 장문의 검증 이력은 이 디렉터리에 두지 않는다. [docs/archive.md](../docs/archive.md)가 가리키는 Git snapshot에서 본다. 새 audit가 끝났다고 `followup-2.md`, `closure-final.md` 같은 파일을 더하지 않는다.
