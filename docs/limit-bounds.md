# 숫자 제한의 분류와 확인 방법

이 문서는 제한을 해석하고 실제 코드에서 확인하는 안내다. 과거 전수조사의 값과 경로는 [UX-38/DR37/DR39 당시 장부](archive/documentation-cleanup-2026-10-25/limit-bounds.md)에 보존한다. 그 표를 현재 숫자의 전수 검증으로 사용하지 않는다.

## 분류

| 종류 | 의미 | 변경 시 확인할 것 |
|---|---|---|
| 프로토콜 | peer가 공유하는 frame·문법·식별자·descriptor 크기 | producer/consumer와 codec이 같은 계약을 사용하는가 |
| 파일 형식 | u16/u32·이름·포맷 필드가 표현할 수 있는 범위 | 표현 범위를 넘어서는 값을 성공처럼 인코딩하지 않는가 |
| 무결성·보안 | parser·입력 구조·검증 결과의 완전성 | 초과나 절단을 완전한 증거로 표시하지 않는가 |
| 메모리·화면·진단 예산 | parser가 통째 보유하는 문서, view·preview·진단의 작업 집합 | 전체 원문과 preview를 구분하고 partial/truncated를 표시하는가 |
| 관측·정체·종료 예산 | 진행으로 리셋되는 침묵 창, 고정 deadline, retry·grace | timeout이 실제 성공·부재·죽음의 대체 증거가 되지 않는가 |
| 시험 전용 | fixture나 명시적 주입 값 | 제품 기본값과 혼동하지 않는가 |

청크 크기·read/write 버퍼는 스트림 전체의 용량 상한과 다르다. 공개된 전체 결과를 보존하는 spool과 화면 preview도 구분한다.

## 현재 owner를 찾는 위치

| 주제 | 실제 소유 코드 |
|---|---|
| 프로토콜 설정과 frame | [domain/protocol-limits.ts](../packages/domain/src/protocol-limits.ts), [domain/limits.ts](../packages/domain/src/limits.ts), [protocol/frame.ts](../packages/protocol/src/frame.ts) |
| Broker supervision channel | [protocol/host-channel.ts](../packages/protocol/src/host-channel.ts) |
| 설정 문서·소스 closure·extension 목록 | [config/operations.ts](../packages/config/src/operations.ts) |
| 설정 generation 보존 | [config/generations.ts](../packages/config/src/generations.ts) |
| 진단 읽기 | [storage/diagnostic-snapshot.ts](../packages/storage/src/diagnostic-snapshot.ts) |
| 화면·표시·입력 | [domain/surface-bounds.ts](../packages/domain/src/surface-bounds.ts) |
| child 출력·실행·침묵 관측 | [process/command.ts](../packages/process/src/command.ts), [process/async.ts](../packages/process/src/async.ts) |
| contained 검색 | [tool-runtime/contained-search.ts](../packages/tool-runtime/src/contained-search.ts) |
| Keychain primitive 관측 | [keychain-client.ts](../packages/platform-mac/src/keychain-client.ts) |

실제 값은 상수뿐 아니라 caller가 넘긴 설정과 실행 경로를 함께 확인한다. 문서의 별도 숫자 목록을 정본으로 만들지 않는다.

## 자원 정책과 구분

DR37에서 실행 자원·저장량·agent count admission cap을 제거했고 DR46에서 관련 HostConfig 필드와 quota 구현도 제거했다. 현재 HostConfig schema 3은 `quota`·role `resources`를 허용하지 않는다. 과거 양수 값을 읽어 무시하는 호환 경로가 있다고 안내하지 않는다.

이 결정은 wire·설정 문서·진단·화면의 모든 bound를 없앴다는 뜻이 아니다. 실제 OS의 디스크 부족·권한 오류·FD 고갈도 남는다. Restic 중복 제거 역시 저장 총량을 일정하게 만드는 quota가 아니며, 고유 데이터와 과거 snapshot은 계속 쌓일 수 있다. 사용법과 회수 조건은 [operations](operations.md#세션-작업공간-보관)를 따른다.
