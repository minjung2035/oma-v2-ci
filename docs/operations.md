# OMA 실행·운영 안내

## 실행

아래는 **Linux checkout** 설치 경로다. Node.js 26을 사용하는 환경에서 저장소 루트에서 설치·빌드한다. DR49의 foreground native Society는 bubblewrap 0.12의 FD mount/gate 기능, user·PID namespace와 pidfd, SO_PEERPIDFD를 제공하는 Linux kernel, Git 및 프로젝트 도구를 요구한다. 실행·wake·로그는 공통 TypeScript owner가 담당한다. CI의 Node.js 버전은 26이며, 빌드 성공만으로 이 실행 조건이 충족되는 것은 아니다. Registry 배포와 플랫폼별 실제 지원 판정은 [validation](implementation/validation.md)을 확인한다. Node 26은 Corepack을 동봉하지 않으므로 Worker의 선언된 toolchain에는 별도 Corepack 설치가 필요하다. CI는 0.34.0을 명시적으로 설치하고 실제 버전과 SHA256을 남긴다. Host의 contained search는 실제 ripgrep과 fd/fdfind를 요구하며 CI도 이 도구를 설치한다.

Ubuntu의 AppArmor user namespace 제한이 활성화된 환경에서는 고정 `/usr/bin/bwrap`에
application별 `userns` 권한이 필요하다. CI는 distro의 해당 profile을 로드하거나 그 binary에만
적용하는 명시적 profile을 기록해 사용하며, 전역 user namespace 제한 값을 바꾸지 않는다.
[Ubuntu의 해당 권한 설명](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces)을
따르며 실제 namespace/seccomp·FD·종료 시험을 그대로 실행한다. `uid map: Permission denied`는
실행 성공이나 scope 사망 증거가 아니다. journal의 witness 없는 opening은 unknown으로 남는다.

```sh
npm ci
npm run build
npm run setup:storage
npm install -g .
cd /absolute/path/to/your/project
oma
```

프로젝트 디렉터리에서 `oma`로 시작한다. 엔진은 함께 배포되며 별도 Pi 설치를 요구하지 않는다. 기본 설정과 Society/Personal·로그인·package 동작은 아래 안내를 따른다.

## 세션 작업공간 보관

Society를 닫으면 Worker가 모두 멈춘 뒤 프로젝트별 Restic 보관소에 작업공간을 중복 제거해
저장·검증하고 원래 clone을 회수한다. 재개할 때 복원한다. Git의 staged/unstaged·untracked·
ignored 파일과 Worker home도 포함하며 대화·작업 DB·runner history는 세션에 그대로 남는다.
실행 중인 세션의 독립 작업공간과 새로 생긴 고유 데이터 용량은 계속 필요하다. 보관·복원은
파일 전체를 읽으므로 종료/재개에 추가 I/O가 든다. 강제 종료 전 보관하지 못한 세션은 원본을
남기며, 그 세션을 다음에 정상 종료할 때 회수한다.

보관소는 Society state root의 상위 `.session-storage/<SHA256(canonical project path)>`에 있다.
**repository와 password를 함께 백업**하고 프로젝트의 `repository-ready`와 각 세션의
`session-checkpoints`, `session-storage.json`, `session-storage.enabled` 및 DB를 함께 보존한다.
password를 잃으면 복원할 수 없다. 다른 경로로 파일을 일부만 옮기거나 오래된 binary로 cold
세션을 열지 않는다. 이 기능은 Git push나 branch를 새로 만들지 않으며 과거 snapshot을 자동
삭제하지 않는다. 오래된 고유 데이터도 계속 저장되므로 총량이 무제한으로 일정해지지는 않는다.

Restic 0.19.1의 Linux/macOS x64·arm64 archive/binary checksum을 고정한다.
setup 단계는 `/usr/bin/bzip2`를 사용하고, 실행 검증은 공통 TypeScript stream verifier가
담당한다. Darwin의 설치·실제 보관/복원 지원은 아래 native gate가 해결될 때까지 미검증이다.
기존 파일과 checksum이 다르면 덮어쓰지 않는다. 도구가 없거나 저장 검증이 실패하면 원래
작업공간을 유지하고 이유를 로그에 남긴다. cold 세션에서 도구가 없으면 위 setup 명령을 다시
실행한다. 현재 verifier는 extended attributes/ACL·special file·nested mount가 있거나 읽을 수
없는 파일, 현재 user/group 권한으로 소유권을 복원할 수 없는 파일이 있으면 회수를 거부하고
원본을 보존한다. 실패한 복원 stage도 진단/복구를 위해
보존하며 같은 snapshot을 정상 복원한 후 자동 회수한다. 세부 계약은 [DR48](design-revisions.md)을 따른다.

## macOS 코드와 배포 상태

**macOS 제품 실행은 아직 지원하지 않는다.** 공통 native 진입점은 있으나
G-PROCESS·G-FILES·G-AUTH가 미해결이므로 Society·Personal·login·package 명령을 효과 전에
거절한다. OMA.app·host service·VM image를 설치하는 경로는 폐기했다. 기존 데이터와
history는 자동 변환하거나 삭제하지 않는다. 위 Linux 설치 안내를 Mac 지원 절차로 사용하지 않는다.

## 역할별 운영 설정

모델·역할별 extension 목록·프롬프트를 broker/runner 코드와 분리한다. `resident`, `verifier`, `principal`은 **운영 프로필 이름**이며 새 권한 종류가 아니다. 권한·delegation은 `agentProfile` 검증을 통과해야 한다. 현재 HostConfig schema 4에는 quota·실행 자원 필드가 없으며, 이전 필드를 넣으면 거절한다.

## 세션 모드

[DR28](design-revisions.md)의 Society는 기본 모드이며 기존 프로젝트 binding·Principal 제한·Worker 협업을 유지한다. `oma`는 모드 선택창 없이 바로 Society 세션을 연다. 아직 대화를 시작하지 않은 idle 세션에서 `/society`를 입력하면 Personal/Society 선택이 열린다. 다른 모드를 고르면 현재 세션이 완전히 종료된 뒤 같은 프로젝트에서 해당 모드로 다시 시작하며 기존 history를 변환하지 않는다. 작업을 시작한 뒤에는 `/new`로 현재 모드의 새 세션을 열고 선택한다. Personal은 Society 없이 동봉 Pi/Open TUI·기본 도구·명시적으로 선택한 확장을 사용하는 별도 Human 세션이며, `oma --mode personal`로도 바로 시작할 수 있다. `/resume`·fork는 저장된 모드를 보존한다. Personal Config의 확장 선택은 Principal/Worker 설정과 독립적으로 저장된다.

`oma pi install npm:<package>`와 `remove`·`update`·`list`는 공통 local package store를
사용한다. 폐기한 VM 선택자 `--host-only`·`--project`는 거절한다. 설치만으로 Personal
확장을 켜지 않으므로 Personal의 Config > Extensions에서 명시적으로 선택한다.

Mac도 공통 native 진입점을 사용하며 VM 실행 경로는 제거했다. 현재 G-PROCESS·G-FILES·G-AUTH가
미해결이므로 Mac 제품 실행은 효과 전에 거절한다. 기존 VM 데이터·history·accepted plan을 자동
변환하거나 삭제하지 않는다. 공통 primitive 시험 성공과 실제 Mac 제품 지원은 [validation](implementation/validation.md)에서 구분한다.

최초 Personal 설정에서 프로젝트 확장을 가져오지 않으려면 `oma --mode personal --no-project-extensions`로 시작한다. 읽을 수 없는 bookmark·프로젝트 설정 때문에 첫 실행이 막혔을 때도 명시적으로 이 선택을 할 수 있다. 기존 Personal 확장 선택은 유지되며 이 flag로 지워지지 않는다. 저장된 history 재개에는 사용할 수 없다. 기본 경로는 관측 실패를 빈 확장 목록으로 바꾸지 않고 오류를 보고한다.

## 기존 설정 분리

```sh
npm run config:split -- /absolute/path/to/current/config.json /absolute/path/to/new-operations
```

입력은 기존의 유효한 host 설정이며 출력 디렉터리는 존재하지 않아야 한다. 원본·기존 출력은 덮어쓰지 않는다. 모델·권한값을 임의로 기본값으로 채우지 않는다. **현재 설정에 있는 프로필**을 각각 분리하고, 새 프롬프트는 기존 동작 보존을 위해 빈 파일로 만든다.

```text
new-operations/
  config.json             # 명시적 파일 목록
  host.json               # schemaVersion, society, 설치 경로, 초기 Worker, integration, limits
  models.json             # provider, model, inferenceTimeoutSeconds, 선택 thinking
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

- `agentProfile`: 기존 host 설정의 동일 프로필 객체. `modelProfile`로 `models.json`의 모델을 선택한다. 필드는 `modelProfile`, `capabilities`, `delegable`, `childProfile`이다. `resources`는 허용하지 않는다.
- `extensions`: 설치 `installation.libdir` 아래의 상대 JS/TS 파일 목록. 첫 항목은 항상 `packages/extension/dist/index.js`이며 생략·중복·자동 탐색은 허용하지 않는다. 예: `["packages/extension/dist/index.js", "extensions/verifier.js"]`.
- `promptFile`: **config.json이 있는 디렉터리 기준** 상대 UTF-8 파일. 예: `prompts/verifier.md`.

추가 extension 코드는 설치 디렉터리의 `extensions/` 등에 별도로 배치한다. 설정 로더 자체는 코드를 import하지 않지만 runner entry는 시작 직전에 기록된 SHA-256을 다시 확인한 뒤 core 및 role extension을 Pi에 명시적으로 `-e` 전달한다. 자동 탐색은 꺼 둔다. 추가 extension은 Pi host process와 같은 권한을 갖는 **trusted deployment code**이므로 model tool처럼 취급하면 안 된다. 기존 OMA 공통 extension의 프로토콜/검증 코드를 역할별로 복제하지 않는다. 모델 프로필에는 `provider`, `model`, `inferenceTimeoutSeconds`와 선택 `thinking`만 있다. 가격·codec·token 한도·credential 참조는 동봉 엔진이 소유하며 OMA 설정 schema에 없다(INF-001). OMA는 가격을 계산하거나 비용을 집행하지 않으며, API key는 설정 파일에 넣는 자리가 아니다.

기록한 SHA-256과 시작 전 재검증은 관측한 자산 식별 정보다. 같은 UID가 검증 뒤 파일을 바꾸는 경합 전체나 trusted deployment manifest/Pi executable 승인을 대신하지 않는다.

## 적용 방식

기존 inline `config.json`도 계속 지원한다. broker와 runner의 기존 `--config`에 새 index 파일을 지정할 수 있다. 기본 경로를 유지하려면 원본을 별도로 백업하고, 생성된 파일 묶음을 기존 설정 디렉터리에 배치한다. **broker와 runner가 같은 설정 경로를 사용하도록 맞춘 뒤 재시작**한다. 실행 중 watcher/reload는 없으며 이미 읽은 설정·수락된 ledger/plan/cache를 다시 쓰지 않는다.

실제 모델·역할 정책을 바꿀 때는 `host.json.integration.policyRevision`도 새 값으로 갱신한다(CFG-005). 기존 accepted plan은 보존되지만 outstanding integrate는 새 policy와의 일치 여부를 다시 검사한다.

설정 로더는 문서당 16 MiB, source closure 최대 4096개 파일/64 MiB, role 최대 64개, role별 extension 최대 16개를 허용한다. 실제 정의는 [operations.ts](../packages/config/src/operations.ts)의 상수가 소유한다. 누락·미등록 model·중복 소유·알 수 없는 필드·경로 이탈·참조 파일의 symlink·비정상 파일을 거절한다. host가 지정한 최상위 config 경로의 symlink는 실제 파일 위치로 해석한다. 상대 참조는 `..`, 절대 경로, URL을 허용하지 않는다. 설정 묶음은 host가 관리해야 하며 이 경로 검사가 전체 same-UID 경합 방어 또는 다중 파일 원자적 배포를 보장하지 않는다. 설정을 갱신하는 동안 새 프로세스를 시작하지 않는다.

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
  `LIMIT_EXCEEDED`로 거절한다. 설정 로더가 읽을 수 있는 범위와 generation 보존 예산은 다르다. 정리는 `oma`가 society를 소유하고 broker가
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

DR49: foreground broker가 공통 Resident owner와 execution journal을 소유한다.
수락된 실행 입력·config/state/run 위치를 private spawn 경로로 전달하고, 종료 시 모든
실행 작업·독립 scope 종료·FD completion을 기다린 뒤 Store를 닫는다. user systemd와
unit 설치·manager runtime directory는 실행 조건이 아니다. namespace/peer/file primitive가
없거나 이전 scope가 unknown이면 시작하지 않는다.
DR37/DR46에서 저장량·실행 자원·agent count quota는 제거했다. 실제 ENOSPC·권한·I/O 실패까지 없어지는 것은 아니다.

## 현재 실행 제한

로딩 결과는 현재 closed `HostConfig` schema 4로 검증한다(DR49). 이전 설정과 journal 형식은 자동 변환하지 않으며 새 개발 상태 디렉터리를 사용한다. 이 설정 전환은 broker wire 형식과 별개다. Resident runner는 수락된 modelProfile 참조와 역할 prompt/extension snapshot을 고정된 native launch 입력으로 받는다. 역할의 참조 편집으로 기존 Agent의 수락 참조를 바꾸지 않는다. `provider=pi, model=current`는 `--model`을 생략해 현재 Pi 연결을 사용하며, 그 외 값은 `provider/model`로 Pi에 요청한다. terminal boundary의 pinned durable receipt가 일치해야 batch를 completed/presented로 commit한다.

Worker는 bwrap 안의 shell과 자기 작업공간을 사용한다. Society Principal은 shell·직접 write/edit를 제외하고 읽기·메일·허용된 관리/승인 도구를 사용한다. Personal은 별도 Human 모드다. 실제 허용은 tool 이름 표시만이 아니라 역할·provenance·workspace·sandbox·broker capability로 검사한다. Society는 자동 발견 대신 선택·검증한 확장과 자원을 엔진에 전달한다. 추가 role extension은 trusted code이므로 배포 시 별도 검토한다.

DR37 이후 OMA는 storage/agent count, memory/tasks/CPU/tmp/workspace/staging/check-timeout 상한을 admission이나 systemd property로 집행하지 않는다. DR46에서 제거한 `quota`와 과거 resource 필드는 현재 HostConfig 4에서도 거절하며 구버전 설정을 자동 변환하지 않는다. 실제 디스크 부족·권한·호스트 자원 고갈은 실패할 수 있다. stream의 선언 크기·해시 일치 검사는 계속 수행한다. S-03의 run 중 steer는 v1에 없다([DR18](design-revisions.md)). 가격·usage·error/cancel codec은 동봉 엔진이 소유하며 OMA에는 비용 상한이 없다.

### Resident의 현재 run 양보

Resident sandbox의 `oma agent wait`는 실행 중인 도구의 결과가 기록된 안전한 경계에서
다음 모델 호출 없이 현재 run을 끝낸다. `oma agent wait --observe true`는 그 run의
요청 여부만 JSON으로 읽는다. 이는 작업 완료·ACK·Worker 강제 중지가 아니다.
이미 명시적으로 수행한 ACK는 그대로이고, 나머지 메일과 prepared batch는 다음 활성화에
남는다. 새 incarnation과 broker 재시작에는 wait flag가 넘어가지 않는다.
조회 실패는 unconfirmed로 남기며, Principal은 이 개별 Worker 양보 명령을 사용하지 않는다.

## 봉인된 Resident의 provider 경로

현재 Linux Society의 Resident는 bwrap namespace 안에서 실행된다. Linux 어댑터는 소유한 state root 아래에 rootfs를 만들며(`SB-007`, [DR60](design-revisions.md)), 빈 mount target 위에 host 운영체제의 `/usr` 등을 RO로 겹친다. provider credential은 sandbox에 전달하지 않는다. DR37에 따라 `--share-net`으로 host 네트워크를 공유하며 일반 egress는 제한하지 않는다. credential을 사용하는 엔진 요청은 trusted runner가 소유하는 relay를 통해 provider에 닿는다(`INF-005`/`INF-006`).

- credential은 runner가 동봉 엔진으로 OMA 소유 agent directory에서 해석하고 한 delivery 동안만 relay에 둔다(`INF-008`). 로그인은 `oma login`으로 엔진 자체 흐름을 한 번 연다([DR18](design-revisions.md)).
- sandbox의 엔진은 진짜 key와 같은 모양의 자리표시자를 받는다. relay는 나가는 길에 인증 header(`authorization`, `x-api-key`, `api-key`, `x-goog-api-key`)와 `key` query parameter에서만 진짜 key로 바꾼다. 그 밖(request path, 다른 header·query)에 자리표시자가 있으면 요청을 거절하고, 응답에 진짜 key의 바이트가 나타나면 sandbox에 닿기 전에 끊는다(INF-007, INF-008).

- relay는 stream을 해석하지 않는다. 헤더에 진짜 credential을 끼우고 바이트를 그대로 넘긴다. 가격·token·재시도는 계속 엔진의 것이다.
- 목적지는 model profile이 선언한 provider endpoint 하나다. 그 경로를 벗어나는 요청은 provider에 닿기 전에 거절된다.
- sandbox 안의 provider 설정에 들어가는 key는 자리표시자다. 운영자가 sandbox 안에서 `/login`을 실행하면 진짜 토큰이 sandbox 안에 쓰여 이 모델이 무너진다. 하지 않는다.
- 현재 HostConfig 4에는 `installation.rootfs`가 없다. 이전 버전과 폐기된 rootfs/mount/backend 필드는 설정 오류로 거절하며 원본 파일을 변환하지 않는다. Linux rootfs 경로와 OS mount 목록은 어댑터가 선택하고 private state를 노출하는 system mount는 거절한다. bwrap/user namespace가 없거나 spawn이 실패해도 host 실행으로 대체하지 않는다([DR31](design-revisions.md)). `oma login`과 `oma pi`의 대화형 엔진은 Resident가 아니며 이 sandbox 계약을 적용하지 않는다.
- Resident 환경은 host 환경을 상속하지 않는다(`--clearenv`). `LANG`/`LC_ALL=C.UTF-8`, `TZ=UTC`, `TERM=xterm-256color`, `TMPDIR=/tmp`, `SHELL=/bin/sh`, `USER`/`LOGNAME=agent`를 설정한다. `XDG_DATA_HOME=/home/agent/.local/share`, `XDG_RUNTIME_DIR=/home/agent/.run`은 confined home의 private 디렉터리다. PATH는 pinned OMA/Node, confined home의 `.local/bin`, `/usr/bin`, `/bin` 순서다.
- 존재하는 DNS/NSS/hosts/timezone 파일과 CA 디렉터리만 RO bind한다. 없는 파일(깨진 symlink 포함)은 mount 계획에서 제외하며 `/etc` 전체를 노출하지 않는다. filesystem/pid/user 격리는 유지하고 네트워크는 공유한다.
- 과거 guest 환경은 현재 실행 계약이 아니다. Darwin은 검증된 native backend가 연결되기 전
  Linux 환경 값을 빌려 실행하지 않으며, 과거 VM 설정으로 fallback하지 않는다.

## Dashboard 관측

broker는 `status.get`과 같은 답을 state root의 `status.json`(`0600`)으로 게시하고 5초마다 다시 쓰며 멈출 때 지운다(`TUI-021`). TUI는 이 파일을 읽는다. 20초 넘게 갱신되지 않은 파일은 오래된 값으로 보이지 않고 `unknown`과 마지막 관측 시각으로 보인다.

## 첫 시작

`oma`의 최초 Society 실행은 현재 프로젝트의 작업 트리를 snapshot으로 가져와 canonical `main`을 만든다(DR27). Git 저장소에서는 커밋된 이력과 함께 **미커밋 tracked 변경·삭제 및 ignore되지 않은 untracked 파일**을 포함한다. Git 저장소가 아니거나 첫 커밋 전이어도 현재 파일을 가져오며, 포함할 파일이 없을 때만 빈 root commit으로 시작한다. Human의 HEAD·index·작업 파일은 바꾸지 않는다. 이후 시작은 기존 canonical 이력을 유지하며 원본 디렉터리의 새 변경을 자동 반영하지 않는다. 읽기 실패·손상은 빈 저장소로 대신하지 않고 시작을 멈춘다.

과거 Mac VM의 bundle import/export·guest 동기화는 폐기했다. 기존 VM의 import 기록이나
accepted bundle을 새 native 초기화로 재해석하지 않는다. native 첫 시작은 위 공통 snapshot
owner를 사용하며 Darwin 제품 실행은 선행 gate가 해결되기 전까지 차단한다.

### 프로젝트 식별과 바인딩 (D05, WP16)

기본 society 이름은 프로젝트 디렉터리의 실제 경로(realpath)에서 만든다: 디렉터리 이름의 ASCII slug 최대 15자(없으면 `project`) + `-` + 그 경로 SHA-256의 앞 16자. 이름이 같은 다른 프로젝트는 다른 society가 되고, symlink로 들어와도 같은 프로젝트면 같은 society다.

처음 시작할 때 `<state root>/project-binding.json`(0600, `kind: oma-project-binding-v1`, `society`, `canonicalProjectPath`)을 private temp→fsync→no-replace link→parent fsync로 게시한 뒤에야 설정·provisioning을 한다. 이후 모든 실행은 무엇을 쓰기 전에 이 파일의 전체 경로를 현재 프로젝트와 비교하고, 다르면 `--society`를 줘도 거절한다. 이 파일은 quiescent backup/restore에 포함하는 host 메타데이터이며, 이것을 모르는 이전 바이너리는 이를 강제하지 못하므로 승격 뒤 writer로 쓰지 않는다.

이전 버전이 디렉터리 이름만으로 만든 society는 자동으로 이름을 바꾸거나 새 프로젝트에 묶지 않는다. 기본 이름으로 실행했는데 그런 society가 있으면 새 society를 만들지 않고 안내만 한다. 그 society가 이 프로젝트의 것임을 확인했다면 `oma --society <이전 이름> --bind-project`로 한 번 실행해 바인딩을 기록한다. state root 이동은 lease와 수락된 경로가 그 위치를 가리키므로 단순 rename으로 하지 않는다.

## Pi 엔진

OMA는 Pi 엔진을 함께 배포하고 그것만 실행한다. `PATH`에서 Pi를 찾지 않으며, 엔진이 없는 설치본은 대체 경로로 물러서지 않고 `UNSUPPORTED_PROFILE`로 실패한다. 엔진 entry는 동봉 패키지가 선언한 `bin`에서 읽는다.

엔진에는 `PI_CODING_AGENT_DIR`로 society state root 아래의 OMA 소유 디렉터리를 지정한다. 지정하지 않으면 엔진이 운영자 계정의 `~/.pi` 설정·extension·session을 공유하므로, 별도로 설치한 Pi와 상태가 섞인다. 이 디렉터리는 backup/restore 범위에 포함된다.

`OMA_PI_COMMAND`는 일부 관리·로그인 경로에서 절대 경로의 엔진을 명시하는 운영자용 override다. Society 대화형 UI는 동봉 엔진만 허용하고 이 override를 거절한다. Personal도 동봉 엔진을 사용하며 이 환경 변수의 override를 전달하지 않는다. 존재하지 않거나 상대경로인 실행 파일도 거절한다. 일반 제품 설치 방법으로 사용하지 않는다.

동봉 엔진은 수정하지 않는다. 제품 동작은 신뢰된 core extension이 소유한다.

## Tool 표면 (OMA 내부 정책)

Tool 표면 투영은 더 이상 role 설정이 아니다(D23). 모델에게 보이는 tool 집합의 표현은 OMA가 소유하는 정책이고, 신뢰된 core extension만이 `OMA_TOOL_SURFACE` 환경 변수의 인코딩된 계획을 읽어 적용한다. 어떤 role 파일 필드도 이 표면을 선언할 수 없으며, 선언된 필드가 있으면 설정 로드가 거절된다. production 생산자는 broker의 native Resident launch owner다. 고정한 계획을 `OMA_TOOL_SURFACE_HEX`로 전달하고 runner entry가 decode해 engine spawn plan의 `OMA_TOOL_SURFACE`로 전달한다(현재 계획은 두 role 모두 code_intel group 경계를 선언한다). Resident extension은 변수가 없거나 malformed이면 fail closed한다.

표면 계획 자체는 변하지 않았다: `defaultMode`(`DIRECT`/`DISABLED`), `direct`/`disabled` 이름 목록, tool과 하위 group의 명시 참조로만 이루어진 `groups`, 진입점 `roots`. 모델이 group을 열면 **직계 자식만** 추가로 활성화된다. 열기는 활성화이지 실행이 아니며, 드러난 tool은 Pi가 자기 pipeline으로 직접 실행한다.

엔진 안에서는 시작 시점 검증이 최종 게이트다. 선언된 이름이 registry에 없거나, group 이름이 등록된 tool과 충돌하거나, 활성화가 지시한 대로 적용되지 않으면 세션은 시작되지 않고 엔진이 명시적으로 종료된다(#5). 침묵하는 축소 적용은 없다. 한편 그 호출 경계는 어떤 tool이 실제로 실행될 수 있는지를 이름이 아니라 출처로 판정한다(D25): builtin이거나, 기록된 SHA-256을 다시 확인한 뒤 spawn argv가 고정한 확장 파일에서 온 tool만 허용된다.

표면 표현은 권한이 아니다. 실제 권한은 sandbox mount/FD/network와 capability가 정한다. extension 파일 자체의 신뢰·SHA-256 재검증 요구는 그대로 적용된다. Society Principal은 [DR29](design-revisions.md#dr29--complete-candidate-checks-and-apply-principal-roles-at-execution-boundaries)의 role 제한을 먼저 적용하고 실행 시에도 검사한다.

## 지원과 업그레이드

현재 실행 환경의 검증 범위와 미실행 항목은 [validation](implementation/validation.md)을 확인한다. 플랫폼의 요구 조건은 [Core 계약](implementation-spec.md)과 [macOS 계약](macos-platform.md)을 따른다. 이전 WP31 지원 조합·lockfile 수정 기록은 [과거 qualification 기록](archive/qualification-before-consolidation.md#운영-문서의-wp31-지원-checkpoint)에 보존했다.

HostConfig schema 3·DB schema 4·설정 journal committed-v2를 유지한다. DR52의 새 create
plan은 v3의 `execution: "native"`를 기록한다. 과거 v2 plan/terminal receipt는 원래 bytes와
의미로 읽으며, unit 설치가 필요한 미완료 v2 intent를 native 완료로 정산하지 않는다.
execution journal v1은 별도의 관측 기록이며 accepted plan이나 권한의 원본이 아니다.
host/guest protocol은 폐기했다. 기존 형식을 자동 변환·덮어쓰기·삭제하지 않는다.

Mail 화면은 society 전체의 공개된 메일을 개별 행으로 보여 준다. Principal이 보낸 GOAL·작업 지시, Worker 간 메일과 응답도 포함한다. 발신자는 실제 이름을 사용하고 자동 merge 완료 공지는 `OMA / notice`, 요청자는 상세의 `Requested by`에 표시한다. `●`는 Principal 전달 대기이며 화면에서 여는 동작은 ACK를 보내지 않는다.
