# OMA — 제품의 목적과 경계

이 문서는 제품 의도를 소유한다. 구체적인 동작은 [구현 계약](implementation-spec.md), 실제 검증 범위는 [validation](implementation/validation.md)에서 확인한다.

## 목적

OMA는 Pi를 내부 엔진으로 사용하는 코딩 에이전트다. 사용자는 `oma` 하나로 대화하고, 여러 Worker가 독립 작업공간에서 코드와 증거를 만들고 메일·Git으로 협업한다. Principal은 사용자의 의도와 어려운 판단을 다룬다. 세부 작업을 중앙에서 배정하는 task scheduler를 만들지 않는다.

## 사용자가 보는 것

설치·실행 방법은 [운영 안내](operations.md)가 소유한다. 별도의 Pi 설치나 사용자에게 broker·DB·unit 관리 명령을 요구하지 않는다. 기본 설정과 이후 변경도 같은 제품 안에서 다룬다.

원래 Pi의 대화형 화면과 엔진 기능을 사용하고 OMA의 협업·설정·메일 기능을 연결한다. 이전 RPC 전용/custom conversation 설계는 DR21에서 철회했고 원본 InteractiveMode 사용은 DR22가 수용했다. 제품 구현을 과거 화면 설계로 되돌리지 않는다([결정 기록](design-revisions.md)).

Society와 Personal은 세션 모드다. Society는 Principal/Worker 협업, Personal은 일반 Human 코딩 경로다. OMA는 시작 시 모드 선택창 없이 기본 Society로 열린다. 첫 대화 전 idle 상태에서는 `/society`로 모드를 선택하고 현재 writer 종료 후 다른 모드의 세션을 연다. 기존 birth·history는 보존하며 선택·history·resume·설정은 [운영 안내](operations.md#세션-모드)와 관련 MODE 계약을 따른다. Personal을 Principal 권한 toggle로 구현하지 않는다.

## 소유 경계

| 기능 | owner |
|---|---|
| provider 인증·모델 선택·effort·추론·retry·compaction·엔진 세션 | 동봉 Pi 엔진 |
| agent identity·메일 전달·durable operation·canonical Git 권한 | OMA core |
| role별 tool 투영과 실행 제한 | OMA extension와 broker의 동일 계약 |
| 제품 진입점·Control Panel·세션 모드·플랫폼 연결 | OMA 제품 경계 |

엔진을 임의로 fork하거나 엔진 기능의 두 번째 구현을 만들지 않는다. 원본 엔진의 package 기능을 쓰되 OMA saved role 선택과 실행 경계를 연결한다.

## 협업의 원칙

Worker는 독립 clone에서 수정하고 다른 Worker의 merge 때문에 작업공간이 자동 reset되지 않는다. Principal의 읽기와 승인 권한을 코드 쓰기 권한으로 확대하지 않는다. 구체적인 도구와 리뷰·투표·challenge 동작은 해당 정책 문서가 소유한다.

표면에서 기능을 숨기는 것만으로 권한을 제한하지 않는다. 실제 경계는 인증된 actor, capability, sandbox와 현재 효과 권한으로 집행한다. 관측 실패는 성공이나 미실행으로 바꾸지 않는다. 확정된 사실은 재시작과 설정 변경 뒤에도 같은 뜻으로 남는다([PRIORITY-0](PRIORITY-0.md)).

## 완료의 의미

설계 채택, 코드 작성, fixture 통과, 실제 플랫폼 실행, release 검증은 서로 다른 상태다. 지원 여부와 미실행 환경은 validation에 기록한다. 비교 실험 없이 다중 모델의 품질·속도·비용 우위를 제품 사실로 적지 않는다.
