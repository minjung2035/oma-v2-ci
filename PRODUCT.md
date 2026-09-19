# OMA — 무엇을 만들고 있는가

이 문서는 제품의 의도를 소유한다. 구현이 무엇을 해야 하는지는 [architecture.md](architecture.md)와 [implementation-spec.md](implementation-spec.md)가 정하고, 이 문서는 **왜 그렇게 정했는지와 무엇을 제품이라고 부르는지**를 정한다. 둘이 충돌하면 규범 문서가 우선한다.

## 한 문장

OMA는 **Pi를 의존성으로 삼는 새로운 코딩 에이전트**다. Pi extension의 형태를 띠고 있지만, 사용자에게는 Pi가 아니라 OMA 하나로 보여야 한다.

## 사용자가 보는 것

```sh
npm install -g oma
oma
```

두 줄이 전부다. 이 뒤에 설정 파일 작성, 초기화 명령, 별도 Pi 설치, 재로그인이 오면 그것은 결함이다.

실행하면 대화 화면이 뜨고 바로 코딩을 시작한다. 관리 기능은 `Ctrl+X` 하나로 열리는 Control Panel에 있고 Dashboard / Config / Mail 셋뿐이다.

## 구성

```text
사용자
  └─ oma                         ← 유일한 공개 진입점
       ├─ TUI                    ← OMA가 소유하는 화면과 UX
       ├─ OMA core               ← broker, mail, git, systemd lifecycle
       ├─ tool surface 투영      ← role별로 보이는 tool을 정리
       ├─ 선별한 extensions      ← host가 배치한 신뢰된 것만
       └─ Pi 엔진 (동봉)         ← 실행 엔진. 수정하지 않음
```

Pi는 **내부 실행 엔진**이다. 사용자는 Pi의 명령 체계, 설정 화면, 슬래시 명령을 알 필요가 없고 접할 일도 없다.

## 네 가지 원칙

### 1. Pi는 의존성이지 제품이 아니다

Pi가 이미 하는 일을 다시 만들지 않는다. 자격 증명, 모델 선택, 가격표, provider 호출, 재시도, 세션 저장, 터미널 폭 계산 — 전부 엔진의 것이다.

반대로 Pi를 **고치지도 않는다**. 제품 동작은 신뢰된 core extension과 OMA core가 소유한다. 엔진을 수정하는 순간 upstream 추적 책임이 생기고, 수정한 fork는 production LOC 예산에 들어온다.

경계는 이렇게 긋는다.

| | 누가 소유하나 |
|---|---|
| 산술·프로토콜 프리미티브 (폭 측정, 키 식별) | 엔진에서 빌려온다 |
| 표현·레이아웃·제품 UX | OMA가 소유한다 |
| 다중 에이전트·durable 상태·Git 권한 | OMA만 갖고 있다 |

빌려온 것마다 소유자를 한 곳으로 두고, 그 목록을 테스트가 고정한다.

### 2. 설치 후 즉시 사용 가능해야 한다

`npm` 한 번 뒤에 사용자가 할 일이 남으면 안 된다.

- 엔진은 **함께 배포**한다. 사용자 컴퓨터에 Pi가 없어도 동작한다.
- 사용자가 이미 Pi를 쓰고 있어도 **섞이지 않는다**. OMA는 자기 복사본을 실행하고 자기 agent 디렉터리를 쓴다. `PATH`의 Pi를 찾지 않는다.
- 설정 파일이 없으면 **만든다**. society 이름은 실행 디렉터리에서 유도한다. 프로젝트마다 준비 작업을 시키지 않는다.
- 로그인·모델 선택은 **엔진의 기존 흐름**을 쓴다. OMA가 인증 화면을 따로 만들지 않는다.

### 3. 하나의 제품처럼 보여야 한다

`oma` 안에 Pi UI와 OMA UI가 동시에 존재해서는 안 된다. Pi는 RPC 모드로만 실행해서 대화형 표면이 애초에 없게 한다 — 사후에 가리는 것이 아니다.

extension이 늘어도 사용자는 "extension을 여러 개 깔았다"가 아니라 **"OMA의 기능이 늘었다"**고 느껴야 한다. extension은 능력을 제공하고, UI는 OMA가 소유한다.

tool이 많아지면 모델이 보는 표면이 넓어지므로, role별로 DIRECT / DISABLED / GROUPED로 투영한다. 열기는 활성화이지 실행이 아니며, 드러난 tool은 엔진이 자기 pipeline으로 실행한다.

### 4. 안전 경계는 제품 편의로 무르지 않는다

이건 일반 애플리케이션이 아니라 durable operation, Git CAS, Maildir, systemd lifecycle, crash recovery를 다루는 runtime이다. TUI를 위해 wire/durable/persisted 의미를 바꾸지 않는다.

- 표면에서 감췄다는 것은 안전해졌다는 뜻이 아니다. 실제 권한은 sandbox mount·FD·network와 capability가 정한다.
- 관측하지 못한 것은 `unknown`으로 남긴다. 화면에 0이나 "Ready"로 바꿔 쓰지 않는다.
- 설정을 저장했다는 것과 적용됐다는 것은 다르다. 화면이 적용 시점을 함께 말한다.
- 기록한 자산 digest는 실행 직전에 다시 확인하고, 불일치면 기동을 거절한다.

## 의도적으로 하지 않는 것

- Pi 명령을 기계적으로 감싼 `oma config`, `oma install` 같은 wrapper
- worker 상세 대시보드, topology 그래프, 실시간 토큰 그래프
- command palette, 설정 검색, 다단계 메뉴, 마우스 중심 UI
- 모든 extension을 위한 범용 설정 UI
- 변경 범위를 줄이지 않는 새 abstraction

기능은 실제로 필요해질 때 추가한다.

## 아직 아닌 것

정직하게 적는다. 아래는 제품 목표에 포함되지만 현재 충족되지 않았다.

- **봉인된 Resident의 provider 연결** — sandbox 배선과 relay는 됐고 실제 소켓·실제 TLS provider로 확인했다. 남은 것은 credential 인계 한 조각이며, 그 경로가 broker를 지나므로 아래 bring-up과 같은 작업이다. 신뢰 rootfs를 선언하지 않은 배포는 여전히 비봉인이고, 그 상태는 Dashboard의 `Sandbox` 줄과 runner 시작 로그에 그대로 나온다.
- **Dashboard의 broker 유래 값** — society bring-up은 됐고 `oma` 한 번으로 broker가 뜬다. 그런데 `status.get`의 권한이 cgroup 기반 actor 신원이라, 터미널에서 띄운 TUI가 읽을 권한을 가진 endpoint가 없다. TUI에 unit 신원을 주거나 관측 경로를 바꾸는 architecture 결정이 필요하다. 그때까지 Active/Pending/Status는 이유와 시각이 붙은 `unknown`이다.
- **워커 실행** — canonical `main`은 빈 commit으로 심는다. 사용자의 코드를 society의 canonical 저장소로 가져오는 것은 별개 결정이고 아직 하지 않는다. GOAL이 없으면 활성화도 없으므로 워커는 아직 돌지 않는다.
- **비용 상한** — inference를 엔진에 위임하면서 OMA가 multi-agent 예산을 집행하지 않는다. 되돌리려면 relay 구현이라는 별도 결정이 필요하다.
- **단일 설치 아티팩트** — 현재는 npm 패키지다. node·git·bwrap은 여전히 호스트에 있어야 한다.
- **release gate** — production LOC가 architecture review 기준을 넘어 열려 있다.

현재 수치와 실행 증거는 [implementation/validation.md](implementation/validation.md)에 있다.
