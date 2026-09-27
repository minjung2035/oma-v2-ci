# oma-vmhelper

상태: **NOT_BUILT.** 이 source는 Linux 개발 host에서 빌드하거나 실행하지 않았다. Mac(Apple Silicon, macOS 14 이상)에서 `swift build -c release`로
빌드하고, Developer ID로 서명하고(hardened runtime, `oma-vmhelper.entitlements`), mac-unit·mac-vm lane에서 시험하기 전까지는 동작한다고 말하지 않는다.

하는 일(macos-platform §2.1): Virtualization.framework로 guest VM을 구성·시작·정지하고, guest의 vsock port를 unix socket으로 잇고(vfkit의
connect mode), Keychain item을 읽고 쓰고(MAC-701), 절전·깨어남을 알린다.

`omahostd`와의 규약은 descriptor 3의 JSON 줄이다. Node 쪽 구현과 그 시험이 규약의 원본이다: `src/platform/host/vz-driver.ts`,
`test/platform-vz-driver.test.ts`, 같은 규약을 말하는 시험용 helper `test/fixtures/fake-vmhelper.mjs`.

| 방향 | message |
|---|---|
| → | `{ op: "start", id, config: { kernel, initrd, cmdline, disks: [{ path, readOnly }], cpus, memoryBytes, consoleLog, ports, socketDir } }` |
| → | `{ op: "forceStop", id }` |
| → | `{ op: "keychain.get", id, account }`, `{ op: "keychain.put", id, account, value }` |
| ← | `{ id, ok: true, ... }` 또는 `{ id, ok: false, error }` |
| ← | `{ event: "stopped", cause: "guest" \| "error", message? }`, `{ event: "sleep" }`, `{ event: "wake" }` |

descriptor 3이 닫히면(부모가 끝남) VM을 멈추고 끝난다(§9.3).

환경: `OMA_KEYCHAIN_SERVICE`(기본 `com.vendor.oma.provider`), `OMA_KEYCHAIN_GROUP`(access group 전체 이름). vendor와 Team ID는 배포
주체가 정한다(§13 Q4).
