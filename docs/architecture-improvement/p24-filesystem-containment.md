# P24 — Filesystem pathname-race containment

기준: `a9bf98d` 이후 working tree. 기존 architecture/spec, wire·durable 계약, DB schema, transaction/recovery 정책과 SPIKE OPEN 상태를 대체하지 않는다. 실제 실행 결과는 [현재 검증 상태](../../implementation/validation.md)에 기록한다.

## 적용 범위

- `src/storage/contained-fs.ts`가 Linux x64/arm64의 `openat2(RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS)`와 fd 기반 `linkat`를 소유한다. 기존 Koffi를 사용하며 dependency를 추가하지 않는다. 지원되지 않으면 fail-closed하며 pathname/lstat fallback은 없다.
- 디렉터리 생성·파일 생성·flush·publication·임시 파일 정리의 해당 primitive 수명 동안 parent/child dirfd를 유지한다. 개별 entry 경로를 사용할 때는 보유한 fd 아래의 단일 이름만 허용한다. 저장소 전체의 서비스 수명 dirfd 관리나 새로운 VFS를 구현한 것은 아니다.
- regular file은 `O_PATH`로 유형을 확인한 뒤 그 fd를 통해 I/O용으로 연다. namespace 교체로 FIFO/device를 열거나 symlink를 따라가는 것을 거부한다. context/bundle의 single-link 및 기존 digest/size/inode 검증은 유지한다.
- immutable publication은 검증한 source fd에서 링크한다. EXDEV 경로도 검증한 bytes를 destination-side 임시에 쓰고 그 fd로 게시한다. 소비자는 검증한 bytes를 사용하며 pathname을 재개방하지 않는다. chmod도 확인한 fd에 적용한다.
- submit bundle은 기존 frozen plan의 메타데이터로 검증한 fd를 quarantine 자식에게 전달하고 자식 실행이 끝날 때까지 보유한다. 자식은 그 fd를 기존 크기 제한 private tmpfs로 복사하여 read-only import 입력을 만든다. 이 복사는 기존 `quarantineTmpBytes` 예산을 사용하므로 공간 부족은 이전보다 일찍 발생할 수 있으며 fail-closed한다. 예산을 늘리거나 제한을 우회하지 않는다.
- context candidate 생성은 checked bytes를 Git `hash-object --stdin`에 전달한 뒤 정확한 mode/OID/path를 index에 넣는다. 검증 후 `git add`가 worktree pathname을 다시 읽는 경로를 제거했다. candidate에 대한 기존 canonical 검증은 유지한다.

## 보장하지 않는 것

이 변경은 선택한 staging/파일 handoff 경계의 namespace race 보강이다. fd는 inode identity를 고정하지만 같은 inode의 내용을 불변으로 만들지 않는다. trusted procfs, 프로세스 내부 fd ownership, 처음 취득한 디렉터리 authority를 전제로 한다.

같은 UID의 기존 writable fd·chmod·in-place write, process memory/ptrace, mount namespace 또는 procfs 자체의 변조, 모든 Git 내부 경로와 SQLite VFS/DB/WAL에 대한 완전한 hostile-filesystem 방어는 이 변경의 보장이 아니다. dirfd를 새로 취득하는 각 호출 사이까지 하나의 영구 directory identity를 주장하지 않는다. 따라서 S-05/S-06 및 실제 배포 attestation/release gate는 계속 별도 검증 대상이다.

## 회귀 검사와 발견한 ABI 결함

`test/filesystem-containment-race.test.ts`는 실제 별도 worker의 rename/symlink 교체, immutable source 교체, context metadata fd 전달, parent 교체 중 생성, 실제 자식의 bundle fd 소비를 검사한다. 외부 대상의 inode/bytes/mode 및 기존 검증 거부 조건을 확인한다.

개발 중 `syscall` 호출에서 생략한 인자 때문에 간헐 SIGSEGV가 발생했다. GDB에서 glibc `syscall+22`의 `mov 0x8(%rsp),%r9`가 Koffi foreign stack 바로 다음 unmapped 주소를 읽는 것을 확인했다. glibc가 여섯 syscall 인자 슬롯을 모두 읽으므로 사용하지 않는 마지막 두 슬롯도 명시적으로 전달한다. 새 regression은 32개 독립 프로세스에서 native directory open을 반복한다. BigInt buffer/variadic 선언 변경만으로 해결됐다고 판단하지 않았다.

기존 crash/fault 테스트의 assertion은 줄이지 않았다. 이제 사용하지 않는 `fs.linkSync` 대역 대신 실제 publication 이후 target-fd 관측과 기존 durability fault seam에 주입 지점을 연결했다. 새 syscall owner는 기존 K2 목록에 명시하고 kernel 분류 규칙 자체는 완화하지 않았다.
