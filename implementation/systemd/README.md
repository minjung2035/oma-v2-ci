# Unit renderer 계약

**MUST [UNIT-TPL-001]** 이 7개 `.in` 파일을 [상위 구현 계약](../../implementation-spec.md)의 UNIT 요구와 함께 사용한다. broker당 하나, Resident당 service/path 한 쌍, Principal relay/path 한 쌍, reconcile service/timer 한 쌍이다. Resident service는 path가 시작하며 독립 enable target은 없다.

**MUST [UNIT-TPL-002]** renderer는 user unit directory의 `oma-<society>-...` 이름으로 atomic 설치하고 `systemctl --user daemon-reload` 후 필요한 unit만 enable/start한다. state root는 config와 일치하는 절대 path다. 입력의 systemd `%` 및 ExecStart 인자 escaping을 검증한다. fixed installation Node executable과 compiled TypeScript entrypoints를 사용한다.

**MUST [UNIT-TPL-003]** template에 없는 task service, inference daemon, Git daemon, mail server, supervisor를 추가하지 않는다. host.js는 기존 broker에 host-only IPC를 호출하고 종료하는 entrypoint다. unit 이름을 model이 임의 제공하지 못한다.

**MUST [UNIT-TPL-004]** 실제 설치 전 rendered units에 `systemd-analyze --user verify` 또는 지원 환경의 동등한 verify를 실행한다. ExecStart를 true로 바꾼 검사본은 문법/dependency 검사일 뿐 runtime 통과가 아니다. Type=notify와 SO_PEERCRED/cgroup/종료 경계는 S-01/S-06 실서비스 검증이 필요하다.
