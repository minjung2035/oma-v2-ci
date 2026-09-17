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

각 role 파일은 정확히 다음 세 필드를 가진다:

- `agentProfile`: 기존 host 설정의 동일 프로필 객체. `modelProfile`로 `models.json`의 모델을 선택한다. capabilities/delegable/childProfile/resources는 기존 필수 계약을 유지한다.
- `extensions`: 설치 `installation.libdir` 아래의 상대 JS/TS 파일 목록. 첫 항목은 항상 `dist/src/pi-extension.js`이며 생략·중복·자동 탐색은 허용하지 않는다. 예: `["dist/src/pi-extension.js", "extensions/verifier.js"]`.
- `promptFile`: **config.json이 있는 디렉터리 기준** 상대 UTF-8 파일. 예: `prompts/verifier.md`.

추가 extension 코드는 설치 디렉터리의 `extensions/` 등에 별도로 배치한다. 설정 로더 자체는 코드를 import하지 않지만 runner entry는 시작 직전에 기록된 SHA-256을 다시 확인한 뒤 core 및 role extension을 Pi에 명시적으로 `-e` 전달한다. 자동 탐색은 꺼 둔다. 추가 extension은 Pi host process와 같은 권한을 갖는 **trusted deployment code**이므로 model tool처럼 취급하면 안 된다. 기존 OMA 공통 extension의 프로토콜/검증 코드를 역할별로 복제하지 않는다. 모델 이름을 바꿀 때는 해당 codec·가격 revision·한도도 운영자가 함께 검토한다. credentialRef는 참조이며 API key를 파일에 넣는 자리가 아니다.

기록한 SHA-256과 시작 전 재검증은 관측한 자산 식별 정보다. 같은 UID가 검증 뒤 파일을 바꾸는 경합 전체나 trusted deployment manifest/Pi executable 승인을 대신하지 않는다.

## 적용 방식

기존 inline `config.json`도 계속 지원한다. broker와 runner의 기존 `--config`에 새 index 파일을 지정할 수 있다. 기본 경로를 유지하려면 원본을 별도로 백업하고, 생성된 파일 묶음을 기존 설정 디렉터리에 배치한다. **broker와 runner가 같은 설정 경로를 사용하도록 맞춘 뒤 재시작**한다. 실행 중 watcher/reload는 없으며 이미 읽은 설정·수락된 ledger/plan/cache를 다시 쓰지 않는다.

실제 모델·역할 정책을 바꿀 때는 `host.json.integration.policyRevision`도 새 값으로 갱신한다(CFG-005). 기존 accepted plan은 보존되지만 outstanding integrate는 새 policy와의 일치 여부를 다시 검사한다.

읽기는 파일당 1 MiB, role 최대 64개, role별 extension 최대 16개로 제한된다. 누락·미등록 model·중복 소유·알 수 없는 필드·경로 이탈·참조 파일의 symlink·비정상 파일을 거절한다. host가 지정한 최상위 config 경로의 symlink는 실제 파일 위치로 해석한다. 상대 참조는 `..`, 절대 경로, URL을 허용하지 않는다. 설정 묶음은 host가 관리해야 하며 이 경로 검사가 전체 same-UID 경합 방어 또는 다중 파일 원자적 배포를 보장하지 않는다. 설정을 갱신하는 동안 새 프로세스를 시작하지 않는다.

## 현재 실행 제한

로딩 결과는 기존 closed `HostConfigV1`으로 검증되므로 wire/DB/persisted v1 schema를 바꾸지 않는다. Production runner는 profile의 model/provider와 prompt/extension snapshot을 새 RPC session에 전달한다. `provider=pi, model=current`는 `--model`을 생략해 현재 Pi 연결을 사용하며, 그 외 값은 `provider/model`로 Pi에 요청한다. terminal boundary의 pinned durable receipt가 일치해야 batch를 completed/presented로 commit한다.

Core extension은 shell/powershell tool을 거절하고 built-in file tool을 agent workspace 안으로 제한하며 OMA mail read/send/ack/status만 고정 argv로 노출한다. Pi project extension/skill/prompt/context 자동 탐색은 끈다. 추가 role extension은 이 제한 밖의 trusted code가 될 수 있으므로 운영자가 별도 검토해야 한다.

Broker는 `quota.storageBytes`가 유효하면 시작하고, 시작 및 각 public/internal admission에서 owned state tree 사용량을 관측한다. streamed body의 선언 bytes와 role별 workspace write/edit도 사전 제한한다. 따라서 S-01/S-03의 unconditional `SPIKE_UNRESOLVED` 차단은 없다. 실제 systemd/READY, 외부 same-UID writer에 대한 kernel filesystem quota, S-03 steer·concurrency·전체 kill matrix와 S-04 가격·usage/error/cancel codec은 별도 release-hardening 범위다.
