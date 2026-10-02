# Config 구현 계약 — 후보 검증, version check, commit 결과

읽는 문서: [D02](D02.md), [WP11](../workpackages/WP11.md)–[WP15](../workpackages/WP15.md). 함수/타입 이름은 제안이며 새로운 범용 framework의 요구가 아니다.

## 결과 타입의 역할

`ConfigurationSnapshot`은 한 manifest에서 해석한 source closure와 validated effective config를 함께 가진다. `EditableConfigurationSource`는 잘못된 optional extension 참조 제거처럼 제한된 repair를 위해 안전하게 읽은 authored source이며, 실행 가능함을 의미하지 않는다. `ValidatedConfigCandidate`는 전체 순수 validator를 통과한 편집 결과다. writer는 arbitrary `HostConfigV1`을 받지 않는다.

shape brand와 snapshot version은 다른 보장이다. snapshot version은 편집 전 관측과 현재 commit target을 비교하는 값이지, 다른 프로세스가 이후 파일을 바꿀 수 없다는 증거가 아니다.

## Edit descriptor의 닫힌 집합

기존 mutable field들을 literal union으로 정의하고 다음 의미를 하나의 descriptor가 제공하게 한다: 허용 입력, 순수 변경 함수, 실제 authored owner, apply-time 표시. `EXTENSIONS` 같은 navigation link를 mutable field와 구별한다. `Record<string, ...>`가 모든 required edit를 포함한다고 주장하지 않는다.

사용자 입력의 min/max만으로 전체 config validity를 대체하지 않는다. 변경 후 `lineageAgents <= societyAgents`, `seed count <= societyAgents`, known profiles/models, closed resource/limit fields 등 현재 전체 제약을 실행한다. 교차 조건을 맞추려고 관련 필드를 자동으로 바꾸지 않는다. 예를 들어 worker limit를 줄인다고 lineage quota를 몰래 줄이지 않는다.

## Lost update 방지의 실제 원리

동일 host tenure의 메서드라도 async 편집 두 개가 interleave될 수 있다. **한 config owner가 expected-version 읽기/비교부터 pointer commit까지 한 편집을 직렬화**해야 한다. 새 무한 queue 대신 진행 중이면 bounded busy/conflict로 거절하거나 명시한 제한을 사용한다. `read → compare → await → unconditional rename`만으로 CAS가 된다고 생각하지 않는다.

현재 supported writer는 이 owner를 사용해야 한다. 외부 수동 editor가 동시에 파일을 바꾸지 않는 운영 조건은 유지한다. 변경을 감지하면 거절하지만 비협조적인 same-UID writer까지 완벽히 동기화했다고 주장하지 않는다. 다른 프로세스의 managed writer를 허용하려면 동일 config identity에 걸린 실제 공통 직렬화 장치와 테스트가 필요하다. 기존 society lease와 중복된 권한 체계를 임의 추가하지 말고 먼저 필요한 범위를 결정한다.

## Generation commit의 결과

| 결과 | 요청자에게 말할 내용 | 다음 편집 |
|---|---|---|
| rejected-before-publication | 설정을 바꾸지 못했다 | 원인 수정 뒤 새 snapshot으로 재시도 |
| conflict | 읽은 version이 현재가 아니다 | 최신 snapshot을 읽고 의도 확인 |
| committed | 특정 generation이 file/parent flush까지 완료됐다 | 그 version에서 다음 편집 가능 |
| outcome-unconfirmed | pointer publication 결과 또는 영속성이 불명이다 | target 관측/복구 전 자동 overwrite 금지 |

함수 이름이나 wire error code는 기존 계약에 맞추되 위 의미를 잃지 않는다. postcommit UI reload 실패가 이미 commit된 generation을 지우거나 이전 pointer를 자동 복원할 이유가 되지 않는다.

## Reader와 generation 수명

새 reader는 하나의 manifest를 읽고 그 참조 closure에서 호스트/모델/역할/프롬프트를 구성한다. prompt 참조의 기준은 index root다. managed generations는 읽는 동안 수정되지 않고 구세대는 reader 사용 가능성이 있을 때 삭제하지 않는다.

수동 bundle은 같은 강도를 보장하지 않는다. 개별 파일 변경을 탐지해 실패시킬 수 있지만, arbitrary multi-file concurrent edit의 snapshot isolation을 filesystem stat 비교만으로 증명하지 않는다. 관리형 writer 전환을 하지 않았으면 운영 문서의 동시 편집 금지 조건이 계속 유효하다.

## Generation ID와 policy revision

logical filenames와 실제 내용으로 generation identity를 산출한다. `generation ID → 그 ID를 포함한 파일 경로 → 파일 hash → generation ID`가 자기참조가 되지 않도록 recipe를 분리한다. 생성을 위한 후보 ID와 effective policy fingerprint를 다르게 둘 수 있다. 기존 accepted request/spec/result hash recipe는 변경하지 않는다.

integration.policyRevision의 갱신은 기존 CFG-005 요구와 연결하고 동일 semantics의 재저장은 불필요한 policy change로 해석되지 않게 한다. external extension code는 deployment digest와 actual pre-spawn hash 재검증이 소유한다.
