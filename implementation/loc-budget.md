# Core production LOC budget — 공백·주석 제외

**MUST [LOC-001]** 8,000 이하 목표, 10,000 초과 architecture review, tests 제외를 유지한다. 측정량은 physical source의 code lines다. 빈 줄과 comment-only 줄은 0, code+inline comment 줄은 1이다. comment syntax처럼 보이는 문자열 내용은 임의 정규식으로 제거하지 않는다. 이 정의가 종전 '주석 포함 nonempty lines' 정의를 대체한다.

**MUST [LOC-002]** 계산 도구는 cloc 2.08과 [cloc-systemd.lang](cloc-systemd.lang)의 language-aware 집계로 pin한다. 기본 INI filter가 systemd의 # comment를 code로 세므로 unit만 전용 filter로 보정한다. 도구 변경은 같은 fixture suite의 분류 차이와 전체 budget 영향을 review한 뒤 명시적으로 pin을 바꾼다. version을 기록하지 않은 임의 cloc/scc/grep/wc 값을 최종 수치로 사용하지 않는다. cloc의 heuristic 한계가 발견되면 fixture와 차이를 보고하고 숫자를 줄이는 쪽으로 조용히 분류하지 않는다.

**MUST [LOC-003]** production manifest는 repository-relative 원본 파일을 한 줄 하나로 열거한다. source closure에 TS, SQL/migration, systemd template, shell/native glue, 직접 작성한 runtime config/template를 포함한다. emitted JS/동일 source에서 생성한 산출물은 중복 제외하고 code generator 자체와 직접 작성한 생성 입력은 포함한다. 수정하지 않은 upstream dependency·lockfile·문서·tests는 제외한다. test helper가 production에서 import되면 production으로 포함한다. 직접 수정한 vendor/fork code를 dependency로 숨기지 않는다.

**MUST [LOC-004]** manifest의 동일 path 중복은 거절하지만 내용이 같은 서로 다른 production source 파일은 각각 센다. cloc --skip-uniqueness로 content-dedup을 끈다. symlink로 다른 source를 중복 계산하거나 제외하지 않게 canonical source identity를 검사한다. unrecognized/ignored language 또는 존재하지 않는 파일이 있으면 0으로 누락하지 말고 gate 실패다. production package/entrypoint dependency inventory와 manifest를 대조한다.

**MUST [LOC-005]** 아래 명령을 실제 source root에서 실행하고 `SUM.code`를 최종 LOC로 사용한다. file별 language/code/comment/blank와 manifest/content hash도 기록한다. 아래 path는 build 검증 산출물이며 runtime S/R allowlist를 확장하지 않는다.

```sh
cloc --version
cloc --list-file=production-files.txt --by-file --skip-uniqueness \
  --read-lang-def=implementation/cloc-systemd.lang \
  --json --out=production-loc.json
```

**MUST [LOC-006]** 위 전용 언어의 `in` mapping은 manifest에 포함한 systemd .in template에만 적용한다. 다른 종류의 .in 입력은 올바른 언어로 별도 분류·집계하고 합계를 대조한다. systemd의 section/directive는 code이고 독립 #/; comment는 comment다. code와 주석의 혼합 줄, block comment, 문자열 내 comment-like text, SQL/unit template, 동일 내용 두 source의 fixture를 유지한다. unknown language를 전체 text로 세거나 파일을 누락하는 fallback은 금지한다.

**MUST [LOC-007]** minify·세미콜론으로 한 줄에 몰기·큰 source를 문자열 데이터로 숨기기·manifest 누락으로 budget을 회피하지 않는다. formatter/style을 유지한다. 8,001–10,000이면 사유를 기록하고 10,001 이상이면 architecture review 전 release하지 않는다. 실제 production repository를 측정하지 않았는데 spec 선언/예제의 LOC를 Core 구현 LOC로 보고하지 않는다.

**MUST [LOC-008]** 재현 fixture는 [tests/loc-fixtures](tests/loc-fixtures)에 있다. 해당 디렉터리에서 `cloc --list-file=files.txt --by-file --skip-uniqueness --read-lang-def=../../cloc-systemd.lang --json`을 실행하면 4개 파일의 SUM.code=7이어야 한다. 이 수치는 production LOC가 아니다.

## 현재 측정 상태 — 비규범적 기록

현재 수치는 [validation.md](validation.md)가 소유한다. 이 절에 수치를 중복 기입하지 않는다.

이전 판의 "현재 LOC는 NOT_RUN / 미측정"이라는 서술은 stale이었다. `scripts/loc.mjs`가 실행되어 `production-loc.json`에 source-bound 결과가 있으며, 그 값은 LOC-001의 10,000행 architecture review gate를 넘는다. 과거 9,774 code lines와 non-empty physical line 기록은 당시 snapshot일 뿐 현재 판정의 근거가 아니다.

`scripts/loc.mjs`는 선언된 `production-manifest.json` 범위를 실제로 순회하고 pinned cloc로 산출물을 생성하는 경로로 유지한다. 파일 목록·합계·내용 hash를 사람이 새 측정처럼 손으로 재작성하지 않는다. `src/process/*`, `src/git/*`, `src/lifecycle/*`, `src/units/*`를 옛 flat-file 목록에서 누락한 상태로 수치를 계산해서는 안 된다.

TUI 및 제품 표면 source도 TUI-015에 따라 같은 manifest와 같은 budget으로 계산한다. 제품 표면이라는 이유로 별도 manifest를 만들어 Core 수치에서 제외하지 않는다.

새 compliance 검사는 실제 source/test/tool closure를 함께 확인하여 stale generated inventory만으로 누락된 dependency를 정당화하지 못하게 한다. 이는 production LOC의 tests 제외 정책을 바꾼 것이 아니다. proof source closure와 LOC 집계 대상은 서로 다른 집합이다. 실제 재측정에서 budget을 넘으면 위 review gate를 그대로 적용한다.
