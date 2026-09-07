# 설계 검증 기록

현재 OMA 저장소를 열지 않고 별도 임시 디렉터리에서 수행했다. 이는 아키텍처에 사용하는 기존 도구의 동작 확인이며, OMA runtime 구현 완료를 뜻하지 않는다.

## systemd 설정

- broker, Resident service/path, Principal relay/path, reconcile service/timer 총 7개 초안을 생성했다.
- 임시 사본에서 미구현 ExecStart를 `/usr/bin/true`로 치환했다.
- `systemd-analyze verify --man=no`가 exit 0으로 통과했다.
- 실제 service 설치·시작, path activation timing, systemd user manager 자원 제한은 실행하지 않았다.

## Git

1. 256 KiB의 합성 base 파일을 가진 작은 Git 저장소를 생성했다.
2. central bare repo와 두 개의 독립 clone을 만들었다.
3. A의 commit이 B의 HEAD를 변경하지 않는 것을 확인했다.
4. A의 게시 ref에서 base를 prerequisite으로 제외한 bundle을 만들었다.
5. central에서 bundle을 검증·수입하고 B가 게시 ref를 fetch했다.
6. B가 읽은 파일 내용이 A의 candidate와 일치했다.
7. A의 main CAS 이후 같은 old OID를 사용한 B의 CAS가 거절됐다.

이 합성 사례의 bundle 크기는 증분 413 bytes, 전체 262,767 bytes였다. 이것은 증분 경로가 작동한다는 확인이며 실제 저장소의 절감률 예측이 아니다.

## Maildir 파일 조합

- 동일 원문의 hardlink를 A/B mailbox의 new에 만들었다.
- B의 파일은 cur로 이동했다.
- C에게는 아직 전달하지 않은 상태에서 수신자 snapshot을 재대조했다.
- C에게만 추가 link를 생성했으며 A/B의 메일은 중복되지 않았다.

이는 부분 fanout과 new/cur 확인 규칙의 작은 파일 실험이다. daemon을 실제로 죽이거나 SQLite와 Maildir를 함께 crash-test한 결과는 아니다.

## 아직 구현 단계에서 검증할 것

- Pi의 고정 버전에서 custom notice, steer/followUp, session 기록 경계.
- 실제 systemd.path와 runner의 idle/stop/start-limit 상호작용.
- Linux peer credential과 cgroup/namespace identity 매핑.
- bubblewrap의 전체 tool 격리와 Principal 도구 교체.
- provider stream·quota·unknown usage.
- notmuch index 생성/재생성 및 readonly 조회.
- disk-full, broker crash, filesystem flush, 백업 복원.
- 실제 저비용 society + 고성능 Principal의 품질·비용 비교.
