# OMA v2 — 현재 인계

기준일: 2026-10-25. 이번 요청은 **미래 계획을 진행하지 않고 저장소 문서를 정리하는 것**이다. 크로스플랫폼 개편·macOS 네이티브 전환·Principal Bash/권한 변경은 착수하지 않는다.

문서 정리는 완료했다. 현재 안내·계약·실행 판정의 위치를 정리하고 과거 원문은 archive에 보존했다. 검사 결과는 validation이 소유한다.

## 현재 코드와 작업 범위

- 브랜치: `work/code-quality-improvements-20261025`.
- 문서 정리 시작 시 HEAD: `d571645941e621eec6ccd91504cfbdc72389200d`. 해당 코드까지 origin에 push했다.
- 현재 코드는 25개 workspace로 분리돼 있다. 역할과 실제 경로는 [책임 경계](application-boundaries.md)를 따른다.
- 마지막 코드 변경은 DR48의 프로젝트별 Restic 세션 보관·복원이다. 사용법은 [운영 안내](operations.md), 검증 결과와 한계는 [validation](implementation/validation.md)이 소유한다.
- 이번 정리는 현재 안내와 과거 기록을 분리하고 오래된 경로·설정 설명을 고친다. 실행 코드·schema·권한은 변경하지 않는다.
- 측정용 VM과 임시 이미지·키·포트는 정리됐다. VM을 새로 만들거나 측정을 재개하지 않는다.

## 작업 제약

[PRIORITY-0](PRIORITY-0.md)가 최상위다. accepted bytes·terminal·receipt, captured T와 동일 Store gate, 현재 권한, unknown과 부재·죽음, 실제 FD/child/lock 수명을 구분한다.

`docs/architecture.md`와 `implementation/review-notes.json`은 수정하지 않는다. 원칙 문서도 이번 범위에서 변경하지 않는다. 새/변경 코드는 NOT_REVIEWED이며 과거 review를 갱신·자동 승인하지 않는다. 에이전트 위임은 사용하지 않는다.

## 로컬 실행 환경

Node 도구 경로:

```sh
export PATH=/home/dev/.local/share/oma-toolchain/node-v26.0.0-linux-x64/bin:$PATH
```

현재 개발 환경은 Linux이며 managed Restic을 설치했다. 호스트 `/usr/bin/bwrap`은 없고 로컬 시험은 private namespace의 bwrap overlay를 사용했다. user manager가 running이어도 현재 dev 계정은 disposable qualification 계정이 아니다. overlay의 로컬 결과를 실제 서비스/cgroup·Mac/VM·provider·power-loss 검증으로 확대하지 않는다.

작업을 재개할 때는 `git status --short`와 실제 HEAD를 먼저 확인한다. 검증 명령과 이번 문서 정리의 판정은 validation을 따른다. 문서 이동이나 과거 실행 지시는 환경별 실행 허가를 추가하지 않는다.

## 이전 기록

정리 전 인계·검증 전문과 오래된 작업 지시·구현 명세는 [2026-10-25 보관 기록](archive/documentation-cleanup-2026-10-25/README.md)에 있다. 이전 커밋 목록과 중간 실패를 현재 작업 지시로 복사하지 않는다.
