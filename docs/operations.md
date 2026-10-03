# OMA 실행·운영 안내

## 실행

빌드한 checkout의 설치 경로다. Registry 배포와 플랫폼별 실제 지원 판정은 [validation](implementation/validation.md)을 확인한다.

```sh
npm ci
npm run build
npm install -g .
oma
```

프로젝트 디렉터리에서 `oma`로 시작한다. 엔진은 함께 배포되며 별도 Pi 설치를 요구하지 않는다. 기본 설정과 Society/Personal·로그인·package 동작은 아래 안내를 따른다.

## 역할별 운영 설정

모델·역할별 extension 목록·프롬프트를 broker/runner 코드와 분리한다. `resident`, `verifier`, `principal`은 **운영 프로필 이름**이며 새 권한 종류가 아니다. 권한·delegation·resource cap은 기존 `agentProfile` 검증을 그대로 통과해야 한다.

## 세션 모드

[DR28](design-revisions.md)의 Society는 기본 선택이며 기존 프로젝트 binding·Principal 제한·Worker 협업을 유지한다. Personal은 Principal에 쓰기 권한을 주는 옵션이 아니라 Society 없이 동봉 Pi/Open TUI·기본 도구·명시적으로 선택한 확장을 사용하는 별도 Human 세션이다. 새 세션의 선택창 또는 `oma --mode personal`로 시작하며 일반 OS 사용자 권한으로 프로젝트 밖 파일도 편집한다. 모드는 시작 때 고정되고 `/resume`·fork는 보존하며 `/new`만 다시 선택한다. Personal Config의 확장 선택은 Principal/Worker 설정과 독립적으로 저장된다.

Mac의 `oma pi install npm:<package> --host-only`는 앱·Host API token·VM 없이 기존 host package store/index만 갱신한다. `remove`, `update`, `list`에도 같은 선택을 사용할 수 있다. 설치만으로 Personal 확장을 켜지 않으므로 Personal의 Config > Extensions에서 명시적으로 선택한다. `--host-only`는 Pi에 전달되지 않으며 `--project`와 함께 쓸 수 없고 Linux에서는 거절한다. 이 flag가 없으면 기존 Society guest 동기화가 필요하며 앱이 없거나 관측이 실패해도 host-only로 대신 실행하지 않는다.

Mac Personal 시작은 Host API token 조회·VM 시작 전 host 경로로 분기한다. Linux에서 실행한 Mac entry·Darwin 경계 주입 시험은 native macOS 지원·내구성 증거가 아니다. Mac 최초 project 확장 선택과 guest Society history 연결을 포함한 현재 검증·미완료·차단 범위는 [validation](implementation/validation.md)이 소유한다.

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

각 role 파일은 다음 세 필드만 가진다. 그 밖의 필드는 거절한다. (이전에는 선택 필드 `toolSurface`가 있었으나, 표면 투영은 OMA의 내부 정책이므로 이제 설정에 두지 않는다 — D23.)

- `agentProfile`: 기존 host 설정의 동일 프로필 객체. `modelProfile`로 `models.json`의 모델을 선택한다. capabilities/delegable/childProfile/resources는 기존 필수 계약을 유지한다.
- `extensions`: 설치 `installation.libdir` 아래의 상대 JS/TS 파일 목록. 첫 항목은 항상 `dist/src/pi-extension.js`이며 생략·중복·자동 탐색은 허용하지 않는다. 예: `["dist/src/pi-extension.js", "extensions/verifier.js"]`.
- `promptFile`: **config.json이 있는 디렉터리 기준** 상대 UTF-8 파일. 예: `prompts/verifier.md`.

추가 extension 코드는 설치 디렉터리의 `extensions/` 등에 별도로 배치한다. 설정 로더 자체는 코드를 import하지 않지만 runner entry는 시작 직전에 기록된 SHA-256을 다시 확인한 뒤 core 및 role extension을 Pi에 명시적으로 `-e` 전달한다. 자동 탐색은 꺼 둔다. 추가 extension은 Pi host process와 같은 권한을 갖는 **trusted deployment code**이므로 model tool처럼 취급하면 안 된다. 기존 OMA 공통 extension의 프로토콜/검증 코드를 역할별로 복제하지 않는다. `codecRevision`·`pricingRevision`·token 한도는 v1 설정 schema가 요구하는 선언이다. provider 선택·가격·codec은 동봉 엔진의 것이므로(INF-001) OMA는 이 값으로 가격을 계산하거나 비용을 집행하지 않는다. credentialRef는 참조이며 API key를 파일에 넣는 자리가 아니다.

기록한 SHA-256과 시작 전 재검증은 관측한 자산 식별 정보다. 같은 UID가 검증 뒤 파일을 바꾸는 경합 전체나 trusted deployment manifest/Pi executable 승인을 대신하지 않는다.

## 적용 방식

기존 inline `config.json`도 계속 지원한다. broker와 runner의 기존 `--config`에 새 index 파일을 지정할 수 있다. 기본 경로를 유지하려면 원본을 별도로 백업하고, 생성된 파일 묶음을 기존 설정 디렉터리에 배치한다. **broker와 runner가 같은 설정 경로를 사용하도록 맞춘 뒤 재시작**한다. 실행 중 watcher/reload는 없으며 이미 읽은 설정·수락된 ledger/plan/cache를 다시 쓰지 않는다.

실제 모델·역할 정책을 바꿀 때는 `host.json.integration.policyRevision`도 새 값으로 갱신한다(CFG-005). 기존 accepted plan은 보존되지만 outstanding integrate는 새 policy와의 일치 여부를 다시 검사한다.

읽기는 파일당 1 MiB, role 최대 64개, role별 extension 최대 16개로 제한된다. 누락·미등록 model·중복 소유·알 수 없는 필드·경로 이탈·참조 파일의 symlink·비정상 파일을 거절한다. host가 지정한 최상위 config 경로의 symlink는 실제 파일 위치로 해석한다. 상대 참조는 `..`, 절대 경로, URL을 허용하지 않는다. 설정 묶음은 host가 관리해야 하며 이 경로 검사가 전체 same-UID 경합 방어 또는 다중 파일 원자적 배포를 보장하지 않는다. 설정을 갱신하는 동안 새 프로세스를 시작하지 않는다.

### 관리형 편집 (D02, WP13)

제품의 설정 화면과 extension 화면이 분할 bundle을 바꿀 때는 파일을 제자리에서 고치지 않는다.
한 번의 편집은 index 옆 `.oma-config/generations/<id>/`에 host·models·role·prompt 전체를
새로 쓰고, 모든 파일과 디렉터리를 flush한 뒤 일반 JSON manifest(`config.json`)를 마지막에
한 번 교체하고 그 parent를 flush해야 성공으로 보고한다. 읽는 쪽은 manifest를 한 번 읽으므로
완전한 옛 설정이나 완전한 새 설정만 본다. rename 뒤 flush 실패는 "게시됐지만 영속 불명"으로
보고되며, 같은 bundle의 다음 편집은 그 flush를 다시 확인한 뒤에만 진행한다.

- **처음 편집**: 수동 bundle의 파일은 그대로 남는다(rollback/export 근거). 여러 profile이 같은
  role 파일을 가리키면 profile별 사본으로 펼치되 효과는 같아야 게시된다.
- **충돌**: 화면이 읽은 뒤 manifest나 그 closure의 어떤 파일이라도 바뀌었으면 편집은
  `POLICY_CHANGED`로 거절되고 아무것도 쓰지 않는다. Control Panel은 저장을 시도할 때마다(성공이든
  거절이든) 설정을 다시 읽으므로, 거절 뒤에는 파일이 지금 가진 값을 보여 주고 다음 편집은 그 값에서
  만든다. 파일을 지금 읽을 수 없으면(권한·I/O 오류) "바뀜"이 아니라 `BROKER_UNAVAILABLE`로 거절한다.
  비협조적인 same-UID writer와의 동시 편집은 여전히 지원하지 않는다.
- **정책 revision**: host·model·role·prompt·extension 선택·tool surface의 의미가 바뀐 편집만
  `integration.policyRevision`을 바꾼다. 의미가 같은 저장은 아무것도 게시하지 않는다.
- **구버전 writer 금지**: 게시된 generation 디렉터리는 읽기 전용(0500/0400)이다. 파일을
  제자리에서 고치는 writer는 파일시스템이 거절한다. 관리형으로 승격한 bundle에는 구버전
  바이너리의 편집 기능을 쓰지 않는다. 직접 지우려면 먼저 `chmod -R u+w`가 필요하다.
- **보관 한도**: 게시된 generation 16개 또는 generation 전체 256 MiB를 넘는 편집은
  `LIMIT_EXCEEDED`로 거절한다. 한 generation은 loader 한도(파일 256개·8 MiB) 안이므로
  유효한 설정의 첫 편집은 언제나 가능하다. 정리는 `oma`가 society를 소유하고 broker가
  없는 시작 시점에만 하며, 현재와 직전 generation을 남기고 나머지와 중단된 staging·임시
  manifest를 지운다. 나이만으로 지우지 않는다. 읽기 한도는 바뀌지 않는다.
- **export**: `npm run config:export -- <config.json> <새 디렉터리>`는 현재
  manifest가 가리키는 설정을 새 위치에 평평한 수동 bundle로 쓴다. 입력과 기존 출력은
  바꾸지 않는다. backup에는 index와 `.oma-config` 전체를 함께 포함한다.
- **rollback**: 이전 설정으로 돌아가는 것은 검증된 새 generation을 게시하는 일이다. history를
  지우거나 수락된 spec을 다시 쓰지 않는다.
- inline `config.json`도 같은 commit 순서를 따른다(DR12): 화면이 읽은 버전 확인, 전체 검증, private
  임시 파일, production loader로 다시 읽어 같음을 확인, 버전 재확인, rename(commit point), parent flush.
  flush가 실패하면 "게시됐지만 영속 불명"으로 보고하고(화면은 "저장됨 · 디스크에 남았는지는 아직 확인되지
  않았습니다") 다음 편집 전에 다시 flush한다. 처음 만드는 설정은 이미 있는 파일을 덮어쓰지 않는다.

D03(WP03): 제품이 띄운 broker는 config 경로·state root·run root를 Resident unit의 ExecStart에
그대로 전달하고, 존재하지 않는 broker.service에 Resident를 묶지 않으며 종료할 때 Resident를
정지한다. user manager의 런타임 디렉터리가 아닌 `XDG_RUNTIME_DIR`로는 시작하지 않는다
(`UNSUPPORTED_PROFILE`). systemd가 fixed broker unit으로 broker를 실행하는 운영 방식은
렌더링만 검증됐고 지원한다고 표시하지 않는다.
D04의 bounded settlement/read/safety 예산 분리는 WP21–23의 구현·ENOSPC 검증 대상이며
tree scan quota를 kernel hard cap이나 ENOSPC에도 성공하는 보장으로 해석하지 않는다.

## 현재 실행 제한

로딩 결과는 기존 closed `HostConfigV1`으로 검증되므로 wire/DB/persisted v1 schema를 바꾸지 않는다. Production runner는 profile의 model/provider와 prompt/extension snapshot을 새 RPC session에 전달한다. `provider=pi, model=current`는 `--model`을 생략해 현재 Pi 연결을 사용하며, 그 외 값은 `provider/model`로 Pi에 요청한다. terminal boundary의 pinned durable receipt가 일치해야 batch를 completed/presented로 commit한다.

Core extension은 shell/powershell tool을 거절하고 built-in file tool을 agent workspace 안으로 제한하며 OMA mail read/send/ack/status만 고정 argv로 노출한다. Pi project extension/skill/prompt/context 자동 탐색은 끈다. 추가 role extension은 이 제한 밖의 trusted code가 될 수 있으므로 운영자가 별도 검토해야 한다.

Broker는 `quota.storageBytes`가 유효하면 시작하고, 시작 및 각 public/internal admission에서 owned state tree 사용량을 관측한다. streamed body의 선언 bytes와 role별 workspace write/edit도 사전 제한한다. 따라서 S-01/S-03의 unconditional `SPIKE_UNRESOLVED` 차단은 없다. 실제 systemd/READY와 외부 same-UID writer에 대한 kernel filesystem quota는 별도 release-hardening 범위다. S-03의 run 중 steer는 v1에 없다([DR18](design-revisions.md)). 가격·usage·error/cancel codec은 동봉 엔진이 소유하므로(INF-001) OMA의 hardening 범위가 아니며, v1에는 비용 상한이 없다(DR18).

### Resident의 현재 run 양보

Resident sandbox의 `oma agent wait`는 실행 중인 도구의 결과가 기록된 안전한 경계에서
다음 모델 호출 없이 현재 run을 끝낸다. `oma agent wait --observe true`는 그 run의
요청 여부만 JSON으로 읽는다. 이는 작업 완료·ACK·Worker 강제 중지가 아니다.
이미 명시적으로 수행한 ACK는 그대로이고, 나머지 메일과 prepared batch는 다음 활성화에
남는다. 새 incarnation과 broker 재시작에는 wait flag가 넘어가지 않는다.
조회 실패는 unconfirmed로 남기며, Principal은 이 개별 Worker 양보 명령을 사용하지 않는다.

## 봉인된 Resident의 provider 경로

Society의 Resident는 항상 bwrap 안에서 실행된다. 설정 없이 시작한 society의 `installation.rootfs`는 OMA가 state root 아래에 만든 rootfs이며(`SB-007`), 빈 mount target 위에 host 운영체제의 `/usr` 등을 RO로 겹친다. 그 안에는 provider credential도 network도 없다(`PR-004`, `SB-004`). 엔진은 host의 relay socket을 통해 provider에 닿는다(`INF-005`/`INF-006`).

- credential은 runner가 동봉 엔진으로 OMA 소유 agent directory에서 해석하고 한 delivery 동안만 relay에 둔다(`INF-008`). 로그인은 `oma login`으로 엔진 자체 흐름을 한 번 연다([DR18](design-revisions.md)).
- sandbox의 엔진은 진짜 key와 같은 모양의 자리표시자를 받는다. relay는 나가는 길에 인증 header(`authorization`, `x-api-key`, `api-key`, `x-goog-api-key`)와 `key` query parameter에서만 진짜 key로 바꾼다. 그 밖(request path, 다른 header·query)에 자리표시자가 있으면 요청을 거절하고, 응답에 진짜 key의 바이트가 나타나면 sandbox에 닿기 전에 끊는다(INF-007, INF-008).

- relay는 stream을 해석하지 않는다. 헤더에 진짜 credential을 끼우고 바이트를 그대로 넘긴다. 가격·token·재시도는 계속 엔진의 것이다.
- 목적지는 model profile이 선언한 provider endpoint 하나다. 그 경로를 벗어나는 요청은 provider에 닿기 전에 거절된다.
- sandbox 안의 provider 설정에 들어가는 key는 자리표시자다. 운영자가 sandbox 안에서 `/login`을 실행하면 진짜 토큰이 sandbox 안에 쓰여 이 모델이 무너진다. 하지 않는다.
- `installation.rootfs`는 정규화된 비-root 절대 경로여야 한다. `/`는 `UNSUPPORTED_PROFILE` startup failure이며 RunnerModule 구성 전에 거절한다. bwrap/user namespace가 없거나 spawn이 실패해도 host 실행으로 대체하지 않는다([DR31](design-revisions.md)). `oma login`과 `oma pi`의 대화형 엔진은 Resident가 아니며 이 sandbox 계약을 적용하지 않는다.
- Resident 환경은 host 환경을 상속하지 않는다(`--clearenv`). `LANG`/`LC_ALL=C.UTF-8`, `TZ=UTC`, `TERM=xterm-256color`, `TMPDIR=/tmp`, `SHELL=/bin/sh`, `USER`/`LOGNAME=agent`를 설정한다. `XDG_DATA_HOME=/home/agent/.local/share`, `XDG_RUNTIME_DIR=/home/agent/.run`은 confined home의 private 디렉터리다. PATH는 pinned OMA/Node, confined home의 `.local/bin`, `/usr/bin`, `/bin` 순서다.
- 존재하는 DNS/NSS/hosts/timezone 파일과 CA 디렉터리만 RO bind한다. 없는 파일(깨진 symlink 포함)은 mount 계획에서 제외하며 `/etc` 전체를 노출하지 않는다. network namespace와 일반 egress 비활성화는 그대로다.
- macOS guest의 package engine과 Society session도 UTC, `/bin/sh`, `USER`/`LOGNAME=oma`, `/tmp`를 명시한다. 이는 guest 환경 구성 계약이며 native macOS VM 실행 증거는 별도다.

## Dashboard 관측

broker는 `status.get`과 같은 답을 state root의 `status.json`(`0600`)으로 게시하고 5초마다 다시 쓰며 멈출 때 지운다(`TUI-021`). TUI는 이 파일을 읽는다. 20초 넘게 갱신되지 않은 파일은 오래된 값으로 보이지 않고 `unknown`과 마지막 관측 시각으로 보인다.

## 첫 시작

`oma`를 처음 실행한 디렉터리가 git 저장소면 그 커밋된 `HEAD`로 canonical `main`을 시작한다(`TUI-022`). 커밋되지 않은 변경은 가져오지 않으며, 이후 그 디렉터리의 새 커밋은 society 이력을 움직이지 않는다. 저장소가 아니거나 커밋이 아직 없으면 빈 root commit으로 시작한다. 저장소를 읽을 수 없거나(권한·손상) 기존 canonical 저장소를 읽을 수 없으면 빈 저장소로 대신하지 않고 시작을 멈춘다.

### 프로젝트 식별과 바인딩 (D05, WP16)

기본 society 이름은 프로젝트 디렉터리의 실제 경로(realpath)에서 만든다: 디렉터리 이름의 ASCII slug 최대 15자(없으면 `project`) + `-` + 그 경로 SHA-256의 앞 16자. 이름이 같은 다른 프로젝트는 다른 society가 되고, symlink로 들어와도 같은 프로젝트면 같은 society다.

처음 시작할 때 `<state root>/project-binding.json`(0600, `kind: oma-project-binding-v1`, `society`, `canonicalProjectPath`)을 private temp→fsync→no-replace link→parent fsync로 게시한 뒤에야 설정·provisioning을 한다. 이후 모든 실행은 무엇을 쓰기 전에 이 파일의 전체 경로를 현재 프로젝트와 비교하고, 다르면 `--society`를 줘도 거절한다. 이 파일은 quiescent backup/restore에 포함하는 host 메타데이터이며, 이것을 모르는 이전 바이너리는 이를 강제하지 못하므로 승격 뒤 writer로 쓰지 않는다.

이전 버전이 디렉터리 이름만으로 만든 society는 자동으로 이름을 바꾸거나 새 프로젝트에 묶지 않는다. 기본 이름으로 실행했는데 그런 society가 있으면 새 society를 만들지 않고 안내만 한다. 그 society가 이 프로젝트의 것임을 확인했다면 `oma --society <이전 이름> --bind-project`로 한 번 실행해 바인딩을 기록한다. state root 이동은 lease와 수락된 경로가 그 위치를 가리키므로 단순 rename으로 하지 않는다.

## Pi 엔진

OMA는 Pi 엔진을 함께 배포하고 그것만 실행한다. `PATH`에서 Pi를 찾지 않으며, 엔진이 없는 설치본은 대체 경로로 물러서지 않고 `UNSUPPORTED_PROFILE`로 실패한다. 엔진 entry는 동봉 패키지가 선언한 `bin`에서 읽는다.

엔진에는 `PI_CODING_AGENT_DIR`로 society state root 아래의 OMA 소유 디렉터리를 지정한다. 지정하지 않으면 엔진이 운영자 계정의 `~/.pi` 설정·extension·session을 공유하므로, 별도로 설치한 Pi와 상태가 섞인다. 이 디렉터리는 backup/restore 범위에 포함된다.

운영자가 다른 엔진을 써야 하면 `OMA_PI_COMMAND`에 절대 경로를 지정한다. 의도적 이탈이며 존재하지 않는 경로는 거절한다. 이 경우 실행되는 엔진의 신뢰·버전 확인은 운영자 책임이다.

동봉 엔진은 수정하지 않는다. 제품 동작은 신뢰된 core extension이 소유한다.

## Tool 표면 (OMA 내부 정책)

Tool 표면 투영은 더 이상 role 설정이 아니다(D23). 모델에게 보이는 tool 집합의 표현은 OMA가 소유하는 정책이고, 신뢰된 core extension만이 `OMA_TOOL_SURFACE` 환경 변수의 인코딩된 계획을 읽어 적용한다. 어떤 role 파일 필드도 이 표면을 선언할 수 없으며, 선언된 필드가 있으면 설정 로드가 거절된다.

표면 계획 자체는 변하지 않았다: `defaultMode`(`DIRECT`/`DISABLED`), `direct`/`disabled` 이름 목록, tool과 하위 group의 명시 참조로만 이루어진 `groups`, 진입점 `roots`. 모델이 group을 열면 **직계 자식만** 추가로 활성화된다. 열기는 활성화이지 실행이 아니며, 드러난 tool은 Pi가 자기 pipeline으로 직접 실행한다.

엔진 안에서는 시작 시점 검증이 최종 게이트다. 선언된 이름이 registry에 없거나, group 이름이 등록된 tool과 충돌하거나, 활성화가 지시한 대로 적용되지 않으면 세션은 시작되지 않고 엔진이 명시적으로 종료된다(#5). 침묵하는 축소 적용은 없다. 한편 그 호출 경계는 어떤 tool이 실제로 실행될 수 있는지를 이름이 아니라 출처로 판정한다(D25): builtin이거나, 기록된 SHA-256을 다시 확인한 뒤 spawn argv가 고정한 확장 파일에서 온 tool만 허용된다.

표면 표현은 권한이 아니다. 실제 권한은 sandbox mount/FD/network와 capability가 정한다. extension 파일 자체의 신뢰·SHA-256 재검증 요구는 그대로 적용된다. Society Principal은 [DR29](design-revisions.md#dr29--complete-candidate-checks-and-apply-principal-roles-at-execution-boundaries)의 role 제한을 먼저 적용하고 실행 시에도 검사한다.

## 지원과 업그레이드

현재 실행 환경의 검증 범위와 미실행 항목은 [validation](implementation/validation.md)을 확인한다. 플랫폼의 요구 조건은 [Core 계약](implementation-spec.md)과 [macOS 계약](macos-platform.md)을 따른다. 이전 WP31 지원 조합·lockfile 수정 기록은 [과거 qualification 기록](archive/qualification-before-consolidation.md#운영-문서의-wp31-지원-checkpoint)에 보존했다.

호환성: WP03 이전에 렌더된 Resident unit은 launch location이 없고, WP25 이전 unit은 accepted 자원(`OMA_RESOURCES_HEX`)이 없어 runner가 시작을 거절한다. 기존 unit을 다시 렌더하는 경로는 없으므로 그런 society의 Resident는 다시 만들어야 한다. 관리형 설정 generation(WP13)은 이전 버전 writer가 알지 못하므로, 이전 바이너리로 같은 설정을 편집하지 않는다.
