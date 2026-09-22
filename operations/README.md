# 역할별 운영 설정

모델·역할별 extension 목록·프롬프트를 broker/runner 코드와 분리한다. `resident`, `verifier`, `principal`은 **운영 프로필 이름**이며 새 권한 종류가 아니다. 권한·delegation·resource cap은 기존 `agentProfile` 검증을 그대로 통과해야 한다.

## 기존 설정 분리

```sh
npm run config:split -- /absolute/path/to/current/config.json /absolute/path/to/new-operations
```

입력은 기존의 유효한 host 설정이며 출력 디렉터리는 존재하지 않아야 한다. 원본·기존 출력은 덮어쓰지 않는다. 모델/가격/자원값을 임의로 기본값으로 채우지 않는다. **현재 설정에 있는 프로필**을 각각 분리하고, 새 프롬프트는 기존 동작 보존을 위해 빈 파일로 만든다.

```text
new-operations/
  config.json             # 명시적 파일 목록
  host.json               # 설치 경로, quota, 초기 population, integration, limits
  models.json             # provider/model/credentialRef/codec/pricing/token/timeout
  roles/
    resident.json         # agentProfile + extensions + promptFile
    verifier.json
    principal.json
  prompts/
    resident.md
    verifier.md
    principal.md
```

위 역할 이름은 예시다. 기존 프로필 이름을 그대로 보존하며 verifier를 자동 생성하거나 권한을 추가하지 않는다. 새 역할은 role 파일과 `config.json.roles`에 명시적으로 추가하고, `initialResidents` 또는 `childProfile` 정책에서 선택한다.

`config.json` 형식:

```json
{
  "kind": "oma-operations-v1",
  "host": "host.json",
  "models": "models.json",
  "roles": {
    "resident": "roles/resident.json",
    "verifier": "roles/verifier.json",
    "principal": "roles/principal.json"
  }
}
```

각 role 파일은 다음 세 필드를 필수로 가지며, 선택 필드는 아래 "Role별 tool 표면 투영"의 `toolSurface` 하나뿐이다. 그 밖의 필드는 거절한다.

- `agentProfile`: 기존 host 설정의 동일 프로필 객체. `modelProfile`로 `models.json`의 모델을 선택한다. capabilities/delegable/childProfile/resources는 기존 필수 계약을 유지한다.
- `extensions`: 설치 `installation.libdir` 아래의 상대 JS/TS 파일 목록. 첫 항목은 항상 `dist/src/pi-extension.js`이며 생략·중복·자동 탐색은 허용하지 않는다. 예: `["dist/src/pi-extension.js", "extensions/verifier.js"]`.
- `promptFile`: **config.json이 있는 디렉터리 기준** 상대 UTF-8 파일. 예: `prompts/verifier.md`.

추가 extension 코드는 설치 디렉터리의 `extensions/` 등에 별도로 배치한다. 설정 로더 자체는 코드를 import하지 않지만 runner entry는 시작 직전에 기록된 SHA-256을 다시 확인한 뒤 core 및 role extension을 Pi에 명시적으로 `-e` 전달한다. 자동 탐색은 꺼 둔다. 추가 extension은 Pi host process와 같은 권한을 갖는 **trusted deployment code**이므로 model tool처럼 취급하면 안 된다. 기존 OMA 공통 extension의 프로토콜/검증 코드를 역할별로 복제하지 않는다. 모델 이름을 바꿀 때는 해당 codec·가격 revision·한도도 운영자가 함께 검토한다. credentialRef는 참조이며 API key를 파일에 넣는 자리가 아니다.

기록한 SHA-256과 시작 전 재검증은 관측한 자산 식별 정보다. 같은 UID가 검증 뒤 파일을 바꾸는 경합 전체나 trusted deployment manifest/Pi executable 승인을 대신하지 않는다.

## 적용 방식

기존 inline `config.json`도 계속 지원한다. broker와 runner의 기존 `--config`에 새 index 파일을 지정할 수 있다. 기본 경로를 유지하려면 원본을 별도로 백업하고, 생성된 파일 묶음을 기존 설정 디렉터리에 배치한다. **broker와 runner가 같은 설정 경로를 사용하도록 맞춘 뒤 재시작**한다. 실행 중 watcher/reload는 없으며 이미 읽은 설정·수락된 ledger/plan/cache를 다시 쓰지 않는다.

실제 모델·역할 정책을 바꿀 때는 `host.json.integration.policyRevision`도 새 값으로 갱신한다(CFG-005). 기존 accepted plan은 보존되지만 outstanding integrate는 새 policy와의 일치 여부를 다시 검사한다.

읽기는 파일당 1 MiB, role 최대 64개, role별 extension 최대 16개로 제한된다. 누락·미등록 model·중복 소유·알 수 없는 필드·경로 이탈·참조 파일의 symlink·비정상 파일을 거절한다. host가 지정한 최상위 config 경로의 symlink는 실제 파일 위치로 해석한다. 상대 참조는 `..`, 절대 경로, URL을 허용하지 않는다. 설정 묶음은 host가 관리해야 하며 이 경로 검사가 전체 same-UID 경합 방어 또는 다중 파일 원자적 배포를 보장하지 않는다. 설정을 갱신하는 동안 새 프로세스를 시작하지 않는다.

### 채택된 관리형 편집 방향 — 아직 운영 검증 전

[WP01 D02](../implementation/consistency-decisions.md)는 manual bundle을 그대로 읽되
관리형 편집을 immutable `.oma-config/generations/<generation>/`과 manifest-last
commit으로 전환하기로 결정했다. 이것은 위 수동 파일 묶음의 원자성을 소급 주장하지
않는다. 현재 구현의 writer는 아직 이 보장을 제공하지 않는다(WP11–14).

한 snapshot에서 layout/content를 함께 읽고 전체 후보를 검증한다. writer는 host tenure
하에서 version 비교부터 publication까지 직렬화한다. 새 파일과 directory chain을 flush한
뒤 ordinary JSON manifest를 교체하고 parent를 flush해야 성공이다. rename 이후 flush
실패는 outcome-unconfirmed이며 재관측 전 rollback/자동 overwrite하지 않는다.
promptFile은 계속 index root 기준이며 extension code는 config generation에 포함하지 않는다.
finite retention budget, old-reader compatibility 및 새 목적지로의 explicit flat export를
WP13에서 검증하기 전 관리형 편집을 지원한다고 표시하지 않는다. 승격 뒤 구버전 writer는
사용하지 않는다. backup에는 index와 generation/prompt closure를 함께 포함한다.

D03의 custom locator/XDG 전달 및 foreground/systemd lifetime 동등성은 WP03의 실제
disposable user-manager gate다. 이 문서나 TUI 기동 성공만으로 그 gate를 통과하지 않는다.
D04의 bounded settlement/read/safety 예산 분리는 WP21–23의 구현·ENOSPC 검증 대상이며
tree scan quota를 kernel hard cap이나 ENOSPC에도 성공하는 보장으로 해석하지 않는다.

## 현재 실행 제한

로딩 결과는 기존 closed `HostConfigV1`으로 검증되므로 wire/DB/persisted v1 schema를 바꾸지 않는다. Production runner는 profile의 model/provider와 prompt/extension snapshot을 새 RPC session에 전달한다. `provider=pi, model=current`는 `--model`을 생략해 현재 Pi 연결을 사용하며, 그 외 값은 `provider/model`로 Pi에 요청한다. terminal boundary의 pinned durable receipt가 일치해야 batch를 completed/presented로 commit한다.

Core extension은 shell/powershell tool을 거절하고 built-in file tool을 agent workspace 안으로 제한하며 OMA mail read/send/ack/status만 고정 argv로 노출한다. Pi project extension/skill/prompt/context 자동 탐색은 끈다. 추가 role extension은 이 제한 밖의 trusted code가 될 수 있으므로 운영자가 별도 검토해야 한다.

Broker는 `quota.storageBytes`가 유효하면 시작하고, 시작 및 각 public/internal admission에서 owned state tree 사용량을 관측한다. streamed body의 선언 bytes와 role별 workspace write/edit도 사전 제한한다. 따라서 S-01/S-03의 unconditional `SPIKE_UNRESOLVED` 차단은 없다. 실제 systemd/READY, 외부 same-UID writer에 대한 kernel filesystem quota, S-03 steer·concurrency·전체 kill matrix는 별도 release-hardening 범위다. 가격·usage·error/cancel codec은 동봉 엔진이 소유하므로(INF-001) OMA의 hardening 범위가 아니며, OMA는 비용 상한을 집행하지 않는다.

## 봉인된 Resident의 provider 경로

Resident는 기본으로 bwrap 안에서 실행된다. 설정 없이 시작한 society의 `installation.rootfs`는 OMA가 state root 아래에 만든 rootfs이며(`SB-007`), 빈 mount target 위에 host 운영체제의 `/usr` 등을 RO로 겹친다. 그 안에는 provider credential도 network도 없다(`PR-004`, `SB-004`). 엔진은 host의 relay socket을 통해 provider에 닿는다(`INF-005`/`INF-006`).

- credential은 runner가 동봉 엔진으로 OMA 소유 agent directory에서 해석하고 한 delivery 동안만 relay에 둔다(`INF-008`). 로그인은 `oma` 대화 화면에서 엔진 자체 흐름으로 한 번 한다.
- sandbox의 엔진은 진짜 key와 같은 모양의 자리표시자를 받고, relay가 나가는 길에 header와 path에서만 진짜 key로 바꾼다.

- relay는 stream을 해석하지 않는다. 헤더에 진짜 credential을 끼우고 바이트를 그대로 넘긴다. 가격·token·재시도는 계속 엔진의 것이다.
- 목적지는 model profile이 선언한 provider endpoint 하나다. 그 경로를 벗어나는 요청은 provider에 닿기 전에 거절된다.
- sandbox 안의 provider 설정에 들어가는 key는 자리표시자다. 운영자가 sandbox 안에서 `/login`을 실행하면 진짜 토큰이 sandbox 안에 쓰여 이 모델이 무너진다. 하지 않는다.
- `installation.rootfs`를 `/`로 명시하면 신뢰 rootfs가 없다는 선언이며 Resident는 봉인 없이 host에서 실행된다. runner가 시작할 때 그 사실을 stderr로 보고하고 TUI Dashboard의 `Sandbox` 줄에도 나온다. bwrap이 없는 host에서만 이렇게 둔다.

## Dashboard 관측

broker는 `status.get`과 같은 답을 state root의 `status.json`(`0600`)으로 게시하고 5초마다 다시 쓰며 멈출 때 지운다(`TUI-021`). TUI는 이 파일을 읽는다. 20초 넘게 갱신되지 않은 파일은 오래된 값으로 보이지 않고 `unknown`과 마지막 관측 시각으로 보인다.

## 첫 시작

`oma`를 처음 실행한 디렉터리가 git 저장소면 그 커밋된 `HEAD`로 canonical `main`을 시작한다(`TUI-022`). 커밋되지 않은 변경은 가져오지 않으며, 이후 그 디렉터리의 새 커밋은 society 이력을 움직이지 않는다.

## Pi 엔진

OMA는 Pi 엔진을 함께 배포하고 그것만 실행한다. `PATH`에서 Pi를 찾지 않으며, 엔진이 없는 설치본은 대체 경로로 물러서지 않고 `UNSUPPORTED_PROFILE`로 실패한다. 엔진 entry는 동봉 패키지가 선언한 `bin`에서 읽는다.

엔진에는 `PI_CODING_AGENT_DIR`로 society state root 아래의 OMA 소유 디렉터리를 지정한다. 지정하지 않으면 엔진이 운영자 계정의 `~/.pi` 설정·extension·session을 공유하므로, 별도로 설치한 Pi와 상태가 섞인다. 이 디렉터리는 backup/restore 범위에 포함된다.

운영자가 다른 엔진을 써야 하면 `OMA_PI_COMMAND`에 절대 경로를 지정한다. 의도적 이탈이며 존재하지 않는 경로는 거절한다. 이 경우 실행되는 엔진의 신뢰·버전 확인은 운영자 책임이다.

동봉 엔진은 수정하지 않는다. 제품 동작은 신뢰된 core extension이 소유한다.

## Role별 tool 표면 투영

각 role 파일은 선택적으로 `toolSurface` 블록을 가질 수 있다. extension을 켜는 것과 그 extension의 tool을 모델에게 어떻게 보일지를 분리하는 설정이며, 새 권한 종류나 wire/DB schema를 만들지 않는다.

```json
{
  "agentProfile": { "...": "기존과 동일" },
  "extensions": ["dist/src/pi-extension.js", "extensions/browser.js"],
  "promptFile": "prompts/resident.md",
  "toolSurface": {
    "defaultMode": "DISABLED",
    "direct": ["read", "grep"],
    "disabled": ["dangerous_tool"],
    "groups": [
      { "name": "web", "description": "웹 조회 도구", "members": [{ "tool": "fetch" }, { "group": "browser" }] },
      { "name": "browser", "description": "브라우저 제어", "members": [{ "tool": "click" }, { "tool": "screenshot" }] }
    ],
    "roots": ["web"]
  }
}
```

- `defaultMode`는 `DIRECT` 또는 `DISABLED`이며 생략하면 `DIRECT`다. 여기 이름이 없는 tool이 따르는 기본값이다.
- `direct`는 처음부터 보이는 tool, `disabled`는 등록되어 있어도 활성화하지 않는 tool이다.
- `groups`의 member는 `{"tool": ...}` 또는 `{"group": ...}`의 명시 참조뿐이다. 접두사나 패턴 매칭은 없다.
- `roots`를 생략하면 아무도 중첩하지 않은 group이 진입점이 된다.
- 모델이 group을 열면 **직계 자식만** 추가로 활성화된다. 열기는 활성화이지 실행이 아니며, 드러난 tool은 Pi가 자기 pipeline으로 직접 실행한다.

cycle, 중복 소속, 알 수 없는 참조, 한도 초과(group 32개, group당 member 16개, 깊이 4)는 **설정을 읽는 시점에** 거절한다. 블록을 생략하면 해당 role은 등록된 tool을 그대로 보여준다.

이 설정은 표면 표현만 바꾼다. 실제 권한은 sandbox mount/FD/network와 capability가 정하므로, 표면에서 감출 수 있다는 이유로 위험한 extension을 role에 추가하지 않는다. extension 파일 자체의 신뢰·SHA-256 재검증 요구는 그대로 적용된다.
