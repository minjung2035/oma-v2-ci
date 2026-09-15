# P24 감사 후속 — 배포 gate와 recovery 경계

기준: `48d3f4081522d54c73b5be131a124e24db8eae7d` 이후 working tree. 기존 wire/durable 계약, DB schema, physical ordering과 SPIKE OPEN 조건을 바꾸지 않는다. 실제 실행 결과는 [현재 검증 상태](../../implementation/validation.md) 한 곳에 기록한다. 앞선 [filesystem containment](p24-filesystem-containment.md)의 비보장 범위도 유지한다.

## Production 변경

- **P01 / storage:** `quota.storageBytes`를 enforcement 없이 지원한다고 취급하지 않는다. 실제 broker entry는 Store 생성·unit 설치·socket listen보다 먼저 `SPIKE_UNRESOLVED`로 거부한다. 현재 지원된 filesystem quota profile은 **없다**. runtime 우회 flag나 sampled directory-size accounting은 추가하지 않았다. ENOSPC/EDQUOT/SQLite FULL은 `STORAGE_FULL`로 정규화하고 원인을 보존한다. accepted operation의 pending/unknown을 공간 부족만으로 terminal failure로 바꾸지 않는다. 이 gate는 quota 구현·실제 ENOSPC certification의 대체가 아니다.
- **P02 / deployment:** host config의 digest는 lowercase SHA-256만 허용하며, 아래 canonical inventory와 startup에서 비교한다. mismatch·누락·관측 불가·지원하지 않는 layout은 `UNSUPPORTED_PROFILE`이고 SQLite를 열지 않는다.
- **P03 / observation:** immutable file 관측을 present/absent/unavailable/corrupt로 구분한다. accepted source의 ENOENT는 corruption, EACCES/EIO 등 관측 불가는 transient failure다. derived archive의 입증된 부재는 pending을 유지한다. recovery는 available source를 재사용하며 operation id와 frozen plan을 바꾸지 않고 오류 code를 진단에 남긴다.
- **P04 / Maildir:** 최초 `cur/` 생성뿐 아니라 이전 flush 실패 후 retry에서도 `cur/`와 그 부모를 flush한 뒤 `new/` 이름을 제거한다. parent flush 실패 시 prepared batch와 source는 남는다. power-loss 인증이 아니라 ordering/fault 회귀다.
- **P05 / host layout:** configured state/runtime/LIBDIR/rootfs의 기존 ancestor는 real directory여야 한다. benign symlink도 현재 지원하지 않으며 startup에서 `UNSUPPORTED_PROFILE`로 분류한다. 실제 파일 primitive의 no-symlink traversal을 완화하지 않았다.
- **P06 / staging:** 일반 send도 기존 `freezeObject` 경로를 사용한다. 성공한 요청은 shared `staging/mail-objects/` 아래 자기 임시 alias만 정리하고 per-request directory를 만들지 않는다. crash orphan/accepted object 전체 GC를 새로 구현한 것은 아니다.
- **P07 / Git:** quarantine에서 canonical repository로 objects만 가져오며 scratch ref/FETCH_HEAD를 남기지 않는다. accepted immutable publication ref는 기존 coordinator가 소유한다. main CAS와 SHA-1/SHA-256 지원은 유지한다.
- **P08 / activation:** Lifecycle/Reconcile의 activation callback은 필수이고 JavaScript caller의 누락도 constructor에서 거부한다. fail-open default는 없다. 모든 production consumer는 BrokerLifetime의 live gate를 받는다.
- **A01/A02:** 호출되지 않는 CLI cache-flow와 legacy process-global flock registry를 삭제했다. lock descriptor 수명은 `ProcessLock` 하나가 소유하며 같은 프로세스의 두 번째 open도 첫 lock을 빌리지 못한다.

## deploymentDigest v1 byte codec

Owner: `src/runtime/deployment-manifest.ts`. trusted installer가 설치를 완료한 뒤 별도의 신뢰된 host config에 expected digest를 기록한다. writable manifest 파일 자체를 신뢰하지 않는다.

1. `dist/src/`, `dist/implementation/`, `implementation/systemd/` 아래 **모든 regular file**을 재귀적으로 포함한다. extension filter는 없다.
2. `implementation/schema-v1.sql`, `package.json`, `package-lock.json`을 포함한다.
3. 각 file record의 key order는 `{path, bytes, sha256}`다. `path`는 설치 root 상대 POSIX 경로, `bytes`는 byte length, `sha256`는 file byte digest다. 경로를 JavaScript code-unit 오름차순으로 정렬한다.
4. 최상위 `{version: 1, files: [...]}`를 `JSON.stringify`로 직렬화한 UTF-8 bytes의 SHA-256을 사용한다. trailing newline은 없다.
5. directory/file 합계 4096 entries, 총 file bytes 256 MiB, tree 깊이 32를 초과하면 지원하지 않는다. symlink·special file·읽기 실패·읽는 동안 바뀐 file을 거부한다. root 위치나 directory 열거 순서는 digest에 들어가지 않는다.

이 digest는 Node/Git/systemd/kernel/rootfs/Pi/provider 또는 설치된 `node_modules` 전체의 attestation이 아니다. lockfile bytes pin은 installed dependency bytes pin과 다르다. 정상적인 trusted/immutable installation의 drift 검사이며, 이미 host 권한으로 변조된 실행 코드의 사전 실행을 막는 서명 loader도 아니다. 이러한 신뢰 경계와 S-01/S-04/S-08/S-10 release qualification은 별도로 남는다.

## Verification 변경과 범위

- V01/V04: default `npm test`는 local suite다. user-manager를 쓰는 파일은 명시적인 systemd lane으로 분리한다. cleanup은 fixture 소유 definition의 정확한 이름과 manager FragmentPath를 먼저 검증하며, 광범위한 unit glob 삭제를 하지 않는다. cleanup 실패 시 임시 root를 지우지 않아 증거를 남긴다.
- V02/V05: 승인·pending과 eventual success, 거부와 timeout을 서로 다른 사실로 검사한다. live manager/provider 환경이 없으면 해당 lane은 NOT_RUN/BLOCKED이며 local PASS에 포함하지 않는다.
- V03: `p24-owner-guards.test.ts`는 workflow의 중복 검증에 기대지 않고 spec digest, durable capability, retired transition owner를 각각 직접 검사한다. 단일 owner assertion은 downstream guard의 통과로 대체하지 않는다.
- 기존 composition test의 qualification callback은 의도적인 대역이다. 실제 gate 순서·SQLite 미생성은 설치 tree 복사본에서 broker subprocess를 실행하는 별도 `p24-deployment-gates.test.ts`가 검사한다.
- 기존 회귀를 약화하지 않고 바뀐 실제 seam에 연결했다. mail facet fixture는 실제 bytes에 맞는 digest를 사용하고, stage crash checkpoint는 현재 shared staging 경로를 대상으로 한다.

실제 전원 차단, filesystem quota, provider 과금/encoding, disposable user-systemd cleanup 완결성, same-UID in-place mutation 및 전체 Git/SQLite VFS 보장은 로컬 테스트 결과에서 추론하지 않는다.
