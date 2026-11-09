# 프로젝트 코드 감사 — 2026-11-09

요청 범위는 모듈 내부와 모듈 사이의 계약·오류·취소·자원 수명 전체다. macOS 전용 구현과 공통 파일의 macOS 전용 분기는 변경하지 않는다. 아래 수정은 이번 작업의 변경이며, 정적 검토가 무결함이나 모든 실행 순서의 검증을 뜻하지는 않는다. 실제 실행 결과는 [현재 검증 상태](validation.md)에 기록한다.

## 검토 범위와 증거

앱 조립, 설정, 도메인·계약, 프로토콜·클라이언트, Broker, Mail, Git·Review, 저장소·복구, 실행·Linux 격리, 엔진·확장·TUI, 도구와 도구 생성기를 나누어 읽는다. 모듈 경계에서는 DTO 해석, 순서·단위 차이, 실패와 정리 오류의 결합, 취소 전후 등록, 생성 코드와 생성기의 일치를 함께 확인한다. vendored 도구의 실제 runtime도 검토 대상이다.

설치된 `node_modules`, vendored 하위 의존성 전체를 사람이 한 줄씩 검토했다는 주장은 하지 않는다. upstream 보관본·생성 선언·runtime 중복과 실제 실행 코드는 구분한다. 직접 검토한 목록은 838개 파일이다(제품 소스 532, vendored runtime 226, 스크립트 74, CI 2, schema 2, 설정 asset 1, 선언 1). 개별 파일의 검토 범위는 [파일별 검토 목록](project-audit-2026-11-09-files.tsv)을 기준으로 한다. OMA 작성 제품 소스·공통/Linux 스크립트·CI와 vendored 도구의 실제 실행 코드를 읽었다. macOS 전용 파일과 분기는 수정하지 않았다. 테스트 코드는 변경 경로·회귀 중심으로 읽었으며 전체 테스트 파일을 한 줄씩 수독했다는 뜻은 아니다.

## 수정한 결함

| 경계 또는 모듈 | 재현한 문제와 수정 | 회귀 검증 위치 |
|---|---|---|
| 질문 확장 → 이벤트 → TUI | dispatch 도중 취소가 유실되거나 listener 예외로 열린 질문이 남았다. 취소 등록을 앞당기고 예외 정리, 늦게 생성되는 UI의 취소 상태를 보존했다. | `test/ask-user-question.test.ts` |
| 질문 DTO → 응답 생성 | `preview: null` 등 잘못된 선택지 필드가 검증을 통과해 응답 생성에서 실패했다. preview와 multiSelect 형식을 검증한다. | `packages/domain/test/questionnaire.test.mjs` |
| TUI → 제출 | 제출 호출 예외 때 입력이 사라졌다. 전달 여부를 단정하지 않고 초안을 복원하며 자동 재전송하지 않는다. | `test/tui-app.test.ts` |
| TUI → 메일 조회 | 일시적인 본문 읽기 실패가 영구 캐시돼 새로고침해도 재시도하지 않았다. 명시적 새로고침 때 실패 캐시만 비운다. | `test/tui-app.test.ts` |
| 설정 출판 → 재로딩 | 역할 객체의 키 순서만 달라도 같은 설정의 저장이 실패했다. 객체 키 순서에 독립적인 비교를 사용하고 배열 순서는 유지한다. | `test/config-generations.test.ts` |
| tar → 패키지 staging | 일반 tar의 루트 `./` 항목과 자식 뒤에 나오는 명시적 디렉터리 항목을 거절했다. 정상 디렉터리 선언은 수용하고 중복 파일·형식 충돌은 계속 거절한다. | `test/pi-packages.test.ts` |
| 패키지 staging 실패 | 중간 디렉터리 열기 실패와 디렉터리 flush 실패에서 FD가 누수됐다. 획득 직후부터 반환 범위에 넣었다. | `packages/storage/test/package-staging.test.mjs` |
| fd 검색 → 결과 행 | UTF-8 분할, 파일명 안의 개행, 청크 경계에서 경로와 limit 계산이 깨졌다. NUL 구분자로 완성된 파일명 단위 처리하며 fd 오류 종료를 성공으로 삼지 않는다. | `test/contained-search-header.test.ts` |
| 복구 알림 → 실행 lane | 마지막 작업과 finally 사이에 도착한 알림이 유실됐다. 활성 소유권의 반환과 재검사를 같은 실행 흐름에서 처리한다. 닫힌 lane의 대기 작업도 실행하지 않는다. | `packages/reconcile/test/lane.test.mjs` |
| Review 수정 → 중복 판정 | 수정된 제안의 현재 source 대신 처음 open한 source로 중복을 비교했다. 최신 revise source와 tier를 사용하며 준비된 통합 후보와 혼동하지 않는다. | `packages/review/test/authority.test.mjs`, `test/review-concurrency.test.ts` |
| 엔진 준비 → 모델 검증 | 확장·서비스 획득 후 모델이나 thinking 검증이 실패하면 자원이 반환되지 않았다. 획득 이후 검증 전체를 정리 범위에 넣었다. | `packages/engine/test/interactive-thinking.test.mjs` |
| Runner → 프록시·relay | 프록시 정리 실패가 relay 정리를 건너뛰고 원래 실행 오류도 덮었다. 각각의 소유자를 중첩 정리하고 두 오류를 보존한다. | `test/runner-cleanup.test.ts` |
| 엔진 큐 → 터미널 | 문자열 길이로 자르면서 한글·이모지 표시 폭을 넘기거나 surrogate를 잘랐다. 기존 셀 폭 유틸로 자르고 wire 문자열에는 ANSI를 남기지 않는다. | `packages/engine/test/queue-width.test.mjs` |
| 로컬 테스트 실행기 | URL pathname을 실행 경로로 써 공백·한글이 있는 checkout에서 하위 실행기가 없다고 실패했다. `fileURLToPath`로 변환한다. | `test/native-test-policy.test.mjs` |
| 요청 freeze → 캐시 read | 자신의 metadata 한도를 넘긴 요청도 저장 성공을 반환한 뒤 곧바로 손상으로 읽었다. body·metadata 출판 전에 크기를 검사한다. | `test/request-cache.test.ts` |
| 검사 pipeline → 출력 소유자 | 두 번째 출력 획득 실패, step-end/finish의 첫 출력 flush 실패가 형제 출력 FD를 남겼다. 획득 실패를 반환하고 모든 출력의 종료를 시도한다. | `test/architecture-boundaries.test.mjs` |
| Mail → mailbox 정리 → 복구 | 정리 오류가 `STORE_CORRUPT`를 덮거나 결합 오류 속 손상이 일시 오류로 삼켜졌다. 원인과 정리 실패를 함께 보존하고 기존 오류 분류기를 사용한다. | `packages/mail/test/materializer-failures.test.mjs` |
| Review 알림 → 모델 도구 | 현재 발행하는 리뷰 안내에 제거된 status/diff/respond 도구 이름이 남아 있었다. 현재 기록 경로와 `oma_review` 호출로 안내한다. | `packages/domain/test/review-instructions.test.mjs` |
| LSP → 경로 containment | `..note` 같은 정상 이름을 상위 경로 탈출로 오판했다. `..` 경로 요소만 거절한다. | `packages/tool-lsp/test/lsp-upstream.test.mjs` |
| LSP 응답 → 파일 편집 | 음수·분수·역순 범위나 누락된 newText가 중복 텍스트 또는 `undefined`를 만들었다. 실제 쓰기 전에 편집 구조와 위치를 거절한다. | 같은 파일 |
| 웹 저장 내용 → 검색 발췌 | Unicode 소문자 변환으로 길이가 달라지면 원문과 다른 위치를 발췌했다. 원문에서 직접 대소문자 무시 검색을 한다. | `packages/tool-web/test/content-find.test.mjs` |
| 프록시 → HTTP 응답 | curl이 전송 실패와 HTTP metadata를 함께 내면 잘린 본문이 성공으로 반환됐다. 비정상 종료를 실패로 보존한다. HEAD도 실제 HEAD로 전달한다. | `packages/tool-web/test/proxy-transport.test.mjs` |
| Gemini → HTTP redirect | 다른 origin으로 redirect될 때 사용자 정의 API key 헤더가 따라갔다. 기존 provider redirect 도우미로 같은 origin에서만 인증 헤더를 유지한다. | `packages/tool-web/test/gemini-redirect.test.mjs` |

| 질문 TUI → 붙여넣기 | bracketed paste의 ESC 시작을 취소 키로 오인해 붙여넣기를 버렸다. 완성된 paste 프레임은 입력으로 전달한다. | `test/ask-user-question.test.ts` |
| Git 관측 → spool 한도 | Unicode 문자열의 문자 수를 byte 한도와 비교해 정상 관측을 너무 일찍 거절했다. UTF-8 byte 수로 계산한다. | `packages/git/test/observation-boundary.test.mjs` |
| hashline → 변경 감지 | 표시용 anchor의 앞 500byte/공백 정규화를 stale 검사에도 사용해 뒤쪽 수정이나 공백 변경을 덮어썼다. 변경 감지는 전체 원문으로 계산한다. | `packages/tool-hashline/test/bundle.test.mjs` |
| 저장소 → 오래된 임시파일 정리 | 임시파일 이름과 일치하는 FIFO를 열다가 출판이 멈췄다. 비차단으로 열고 일반 파일인지 확인한다. | `packages/storage/test/publication-temporaries.test.mjs` |
| 웹 provider → redirect | Parallel·Serper·TinyFish·Valyu 및 xAI·Kimi의 사용자 정의 인증 헤더가 다른 origin으로 전달됐다. 인증 헤더를 origin에 결박한다. | `packages/tool-web/test/provider-redirect.test.mjs` |
| OAuth → token POST | MCP OAuth와 웹 ADC의 307/308 응답이 본문의 refresh token·secret·서명 assertion을 다른 주소로 전달했다. 인증 form 요청의 redirect를 거절한다. ADC는 현재 OMA에서 비활성이다. | `packages/tool-mcp/test/auth-boundaries.test.mjs`, `packages/tool-web/test/adc-redirect.test.mjs` |
| MCP 명시적 HTTP 인증 → SDK | OAuth를 끈 서버의 정적 인증 헤더가 redirect를 따라갔고 SSE는 SDK requestInit의 redirect 정책도 무시했다. 두 transport 모두 origin을 확인하는 기존 fetch 경계로 인증을 전달한다. | `packages/tool-mcp/test/auth-boundaries.test.mjs` |
| MCP 명령형 인증 → HTTP | 요청별 서명·사용자 정의 인증 헤더가 redirect에 재사용됐다. 명령이 헤더를 생성한 요청은 redirect를 거절한다. | `packages/tool-mcp/test/auth-boundaries.test.mjs` |
| OAuth callback → HTTP listener | 잘못된 Host/URL이 handler 밖으로 예외를 던졌다. 고정 loopback 기준으로 파싱하고 잘못된 URL에 400을 반환한다. | 같은 파일 |
| 웹 설정·오류 → 화면 | JSON 구문 오류에 설정 원문 일부가 포함돼 secret이 보였고, Firecrawl 오류를 자른 뒤 지워 secret 일부가 남았다. 구문 오류는 원문을 생략하고 secret을 먼저 지운다. | `packages/tool-web/test/config-error-redaction.test.mjs`, `firecrawl-error-redaction.test.mjs` |
| 웹 fetch → 응답 수명 | redirect·HTTP 오류·정책 거절 시 읽지 않은 본문이 남았다. 원래 결과를 보존하면서 body 취소를 시도한다. | `packages/tool-web/test/http-response-cleanup.test.mjs` |
| OpenAI 검색 → SSE/JSON | 일부 출력 뒤 실패하거나 종료 이벤트가 없는 응답을 성공으로 반환했다. 성공한 최종 응답을 요구하고 SSE의 여러 data 행·선택적 공백을 처리한다. | `packages/tool-web/test/openai-response.test.mjs` |
| 웹 답변 → 저장·이어보기 | 답변 offset으로 원문을 읽거나 다중 URL 답변을 조회할 방법이 없었다. 답변에 별도 ID를 부여하고 올바른 저장 내용으로 안내한다. 취소된 source_check도 결과를 출판하지 않는다. | `packages/tool-web/test/fetch-answer-boundary.test.mjs` |
| GitHub clone → README 읽기 | README symlink만 containment 검사를 우회해 clone 밖 파일을 읽었다. README도 기존 저장소 경계 검사로 해석한다. | `packages/tool-web/test/github-readme-boundary.test.mjs` |
| 웹 curator → HTTP 요청 | 청크 중간 UTF-8 문자가 깨지고, falsy JSON 요청은 응답 없이 남았으며 UI의 SerpApi 선택을 서버가 거절했다. byte를 모아 해석하고 객체를 검증하며 provider를 일치시킨다. | `packages/tool-web/test/curator-request-boundary.test.mjs` |
| 웹 curator → 설정 저장 | UI에서 고른 provider를 낮은 우선순위의 옛 키에 저장해 재시작 시 되돌아갔다. 현재 searchProvider 키로 저장한다. | `packages/tool-web/test/curator-provider-config.test.mjs` |
| 웹 curator → 생성된 브라우저 코드 | template 문자열에서 정규식 escape가 사라져 정상 링크·이미지·출처 URL이 정규식 문자열로 바뀌었다. 생성 후에도 의미가 같은 URL 검사를 사용한다. | `packages/tool-web/test/curator-markdown-boundary.test.mjs` |
| 웹 curator → Markdown HTML | SVG의 namespaced javascript 링크가 sanitizer를 통과했다. SVG·MathML을 제거해 HTML 링크 검사 우회를 막고 일반 안전 링크는 보존한다. | `packages/tool-web/test/curator-markdown-boundary.test.mjs` |
| MCP → 경로 해석 | `..cache` 하위 경로와 `..notes` skill을 탈출로 오판했다. 실제 상위 경로 요소와 외부 symlink만 거절한다. | `packages/tool-mcp/test/path-containment.test.mjs` |
| MCP → 종료 | 진행 중 수렴 작업의 오류가 연결 정리를 건너뛰었다. 모든 진행 작업의 결과를 수집하고 연결을 닫은 뒤 원인·정리 오류를 보존한다. | `packages/tool-mcp/test/lifecycle-cleanup.test.mjs` |
| MCP → 목록 페이지 | 서버가 커서를 반복하면 metadata 조회가 끝나지 않았다. 반복 커서를 감지해 종료하고 기존 실패 계약으로 전달한다. | `packages/tool-mcp/test/catalog-pagination.test.mjs` |
| 변경 범위 측정 | workspace의 test 파일을 metadata로 집계했다. 앱·패키지 소유 test 경로를 tests로 분류한다. | `test/change-locality.test.mjs` |

생성된 hashline·LSP·MCP·웹 코드는 upstream 보관본을 직접 수정하지 않고 선언된 생성기 차이와 manifest를 함께 갱신한다.

## Codex를 기준으로 본 사용자 마찰

Codex의 [승인과 보안 안내](https://learn.chatgpt.com/docs/agent-approvals-security)는 파일·네트워크 실행 범위인 sandbox와 범위를 넘을 때의 승인 정책을 구분한다. [sandbox 안내](https://learn.chatgpt.com/docs/sandboxing)는 실행 환경·사용자 설정·관리 정책에 따라 권한을 조절하는 흐름을 설명한다. 따라서 비교 기준은 모든 작업의 무조건 허용이 아니라, **현재 작업이 왜 막혔는지 보이고 사용자가 허용 범위를 선택할 수 있는지**다. Codex의 모든 배포 환경이 같은 기본 권한을 가진다고 가정하지 않는다.

아래는 확인한 현재 선택·제약이다. 모두 버그라는 뜻은 아니며, 권한을 일괄 완화하지 않았다. 개선 제안은 설계·UI 검토 대상으로 남긴다. 현재 웹 도구는 로컬 네트워크와 명시적 프록시를 허용하므로 이를 전면 차단으로 기록하지 않는다.

| 항목 | 일반 사용자가 겪는 상황 | 현재 근거와 후속 검토 |
|---|---|---|
| 대표 에이전트의 권한 | Society Principal에게 직접 수정·실행·Worker 생성이나 로그 확인을 요청해도 안 되는 경로가 있다. 도구 추가만으로 권한이 생기지 않는다. | `protocol/src/methods.ts`, `extension/src/index.ts`. 실제 노출된 협업 도구와 backend method 제한을 구분해 설명하고 Personal 전환·위임 경로를 UI에 표시할 필요. |
| Personal/Society 차이 | 같은 앱에서 모드에 따라 도구·쓰기·설정·로그 접근 범위가 크게 달라진다. | `engine/src/interactive-commands.ts`, `domain/src/session-mode.ts`. 모드별 능력과 제한을 시작 화면·오류에 연결. |
| 모드 전환 | 진행 중 대화에서는 모드를 바로 바꾸지 못하고 새 세션 흐름을 요구한다. Society의 `/trust`, `/import`도 제공되지 않는다. | `engine/src/interactive-commands.ts`. 전환 시 보존되는 이력과 실행 중 작업을 함께 안내. |
| 상위 공통 지침 | 부모 디렉터리 AGENTS.md나 APPEND_SYSTEM.md에 쓴 지침이 Society에 적용되지 않을 수 있다. | `extension/src/prompt-boundary.ts`. 실제 포함/제외 지침 목록과 신뢰된 추가 지침의 명시적 선택 필요. |
| 이미지 입력 | 붙여넣은 이미지가 인터랙티브 입력에서 거절된다. | `engine/src/interactive-extension.ts`. 텍스트 전용임을 입력 전에 표시하거나 별도 첨부 경로 설계. |
| 링크 경로 | workspace 내부를 가리키는 정상 symlink도 도구 경로 검사에서 거절될 수 있다. hardlink 읽기도 거절된다. | `tool-runtime/src/workspace-guard.ts`, `tool-files/src/descriptor-files.ts`. 실제 containment를 유지하는 링크 지원은 별도 설계. |
| 언어 서버 권한 | Principal은 읽기용 진단을 요청해도 LSP 프로세스가 캐시를 쓸 수 있어 실행이 거절된다. | `tool-lsp/src/index.ts`. 전용 scratch/제한 프로세스에서 진단을 제공할 수 있는지 검토. |
| 언어 서버 환경 | 서버 설정에 GOPRIVATE·JAVA_HOME·사용자 토큰을 명시해도 allowlist 밖이면 전달되지 않는다. | `tool-runtime/src/child-env.ts`, `tool-lsp/src/index.ts`. 제거된 변수 이름과 필요한 권한의 명시적 설정 경로 필요. 값은 진단에 노출하지 않음. |
| 언어 서버 캐시 | 호출마다 서버와 HOME/XDG scratch가 새로 만들어져 인덱싱이 반복된다. | `tool-lsp/src/lsp-call-scope.ts`. 세션 수명에 결박된 캐시/서버 재사용은 별도 설계. |
| Linux 도구 설치 위치 | 홈에 설치한 언어 도구가 제한된 rootfs 안에서는 보이지 않을 수 있다. | `platform-linux/src/resident-rootfs.ts`. 지원 도구 mount 선택과 실제 실행 PATH 진단 필요. |
| Linux 실행 전제 | bubblewrap·user namespace·커널 기능·AppArmor 상태에 따라 시작부터 거절될 수 있다. | `platform-linux/src`, `native/src/linux.ts`. 사전 점검이 실패 원인과 실제 환경 수리 경로를 제시해야 함. |
| 장기 shell 작업 | shell 세션 ID·stdin 재개 방식이 없으며 activation이 끝나면 background server도 사라질 수 있다. | `tool-runtime/src/contained-tools.ts`, `process/src/resident-runtime.ts`. 지속 프로세스는 별도 소유권과 종료 정책 필요. |
| 기다리기 의미 | `oma_wait`는 살아 있는 프로세스에서 blocking receive하는 동작이 아니다. | `extension/src/collaboration-help.ts`. yield 이후 임시파일·실행 상태의 수명을 설명. |
| Worker 작업 공유 | Worker는 정확한 commit을 독립 clone으로 받는다. 아직 커밋하지 않은 작업을 즉시 병렬 공유하기 어렵다. | 같은 파일, `lifecycle/src/create.ts`. snapshot 지원 여부와 사용자 기대를 검토. |
| Worker 수와 생성 | 기본 maxWorkers, idle/waiting의 자리 점유, GOAL 선행 조건, 진행 중 생성 조정 때문에 새 작업이 거절될 수 있다. | `config/src/defaults.ts`, `lifecycle/src/create.ts`. 현재 점유·선행 조건·해제 방법을 오류에 표시. |
| 재개 권한 | Principal은 모든 종류의 중단을 임의로 재개할 수 없다. | `lifecycle/src/policy.ts`. 중단 원인과 재개 주체를 한 화면에서 확인. |
| context 형식 | 공유 context가 GOAL.md·RATIONALE.md·decisions/*.md로 제한된다. | `domain/src/context-policy.ts`. 일반 자료의 첨부·참조 경로를 명확히 할 필요. |
| submodule | 후보 tree에 gitlink가 있으면 변경하지 않은 submodule도 거절될 수 있다. | `git/src/candidate-check.ts`, `apps/oma/src/runtime/candidate-checks.ts`. 지원 범위/대체 작업 방식 안내와 격리된 submodule 처리 설계. |
| 관측 기록의 신선도 | 파일을 읽었다고 refresh·ACK가 된 것은 아니며 파일 존재가 최신 상태를 뜻하지 않는다. | `apps/oma/src/views/collaboration-*.ts`. 관측 시각·health·현재성 표시 통합. |
| 리뷰의 가시성 | Principal에게 공개되지 않는 Worker roster/log/material이 있고 리뷰도 역할별로 보이는 범위가 다르다. | `apps/oma/src/views/collaboration-review*.ts`. 거절과 기록 부재를 구별하고 공개 가능한 요약 검토. |
| 모호한 제출과 복구 | 원본 freeze/cache가 손상되면 새 요청으로 자동 재구성하지 않는다. 반복 재시도도 막힐 수 있다. | `apps/oma/src/request-cache.ts`, `client/src/request-service.ts`. 중복 효과 방지 근거는 유지하되 사용자가 실행할 수 있는 복구 절차 필요. |
| 큰 receipt | 전송을 여러 frame으로 나눠도 재조립 전체에는 64MiB 한도가 있다. | `protocol/src/receipt-chunks.ts`. 저장 참조·stream 관측으로 대체할지 검토. |
| 질문 형태 | 1~4개 질문, 각각 2~4개 선택지가 필요해 단순 자유서술 질문에도 선택지를 붙여야 한다. | `domain/src/ask-user-question/questionnaire.ts`. 자유서술 전용 질문과 UI 부재시 대화 fallback 검토. |
| 입력과 화면 크기 | prompt/paste 및 transcript에 별도 byte·행 한도가 있다. | `domain/src/surface-bounds.ts`. 초과 시 남은 내용을 잃지 않는 파일 입력·이어보기 경로 필요. |
| 설정 적용 시점 | 어떤 설정은 다음 activation, 어떤 설정은 세션/Broker 재시작 뒤 적용된다. 관리 generation 수도 제한된다. | `config/src/generations.ts`, `apps/oma/src/application/settings.ts`. 저장 화면에서 실제 적용 시점과 재시작 필요를 표시. |
| 수동 제어 | `/control`로 Principal을 끝낸 뒤 긴 key·incarnation·control ID를 사용해 조작해야 하는 경로가 있다. | `apps/oma/src/runtime/human-controls.ts`. 현재 상태에서 가능한 조작을 선택형 UI로 제공할지 검토. |
| 패키지 범위 | 설치 범위와 Personal/역할별 enable 범위가 달라 설치 성공이 즉시 사용 가능을 뜻하지 않는다. | `apps/oma/src/application/local-packages.ts`, `runtime/personal-settings.ts`. 설치와 활성화 상태를 함께 표시. |
| 패키지 archive | tar의 symlink/hardlink는 거절되지만 directory 설치는 링크를 해석하는 등 입력 방식별 차이가 있다. | `storage/src/package-tar.ts`, `package-staging.ts`. 지원 형식과 거절 대상을 설치 전에 표시. |
| MCP 설정 | resource 노출, directTools/scriptMode, 다른 앱 설정 import/plugin 자동 발견 등에 제한이 있다. | `tool-mcp/src/index.ts`. 지원되는 MCP 기능과 비활성 이유를 서버별로 표시. |
| MCP 상호작용 | sampling·elicitation은 대화형 UI 조건에 영향을 받는다. | 같은 파일과 vendored runtime. 비대화형 실행의 실패/대체 계약 필요. |
| 모델 endpoint | Society inference relay는 HTTPS origin을 요구하고 URL query/fragment, 인증 헤더·키 모양에 제한이 있다. 로컬 HTTP inference와 충돌할 수 있다. | `runtime/inference-relay.ts`, `engine/src/engine-auth.ts`. 신뢰된 로컬 endpoint를 위한 명시적 프로필 검토. |
| 웹 자격 증명 | 브라우저 cookie, 명령형 `!credential`, ADC 자동 발견은 막힌다. 설정 opt-in만으로 열리지 않는 항목이 있다. | `tool-web/src/index.ts`, vendored `credential-source.js`, `gemini-web-config.js`, `gemini-adc.js`. 허용된 인증 방법과 실제 미지원 경로를 분명히 표시. |
| 웹 캐시 | 가져온 내용은 기본 1시간 TTL과 128개/128MiB 캐시 한도에 영향을 받는다. 이력의 responseId가 남아 있어도 본문이 만료될 수 있다. | vendored `storage.js`. 영속 저장 선택과 만료 전 안내 필요. |
| 웹 source_check | 자동 진위 판정이 아니며 현재 관련 구절 추출의 토큰화는 영어·숫자 중심이다. 한글 질의의 구절 추출 품질에 제약이 있다. | vendored `source-check.js`. Unicode 토큰화와 다국어 문장 경계를 별도 검증할 필요. |
| archive·이행 | 특수 파일·메타데이터를 복원하지 못하거나 이전 형식의 상태를 거절하는 경로가 있다. | `storage/src/restic-tar.ts`, `session-storage.ts`, Review 검증. 보존된 hot 상태·암호·원본의 위치와 지원 이행 경로를 설명. |

| MCP UI 도구 | UI resource를 광고하는 도구는 텍스트 결과만 받고 싶어도 호출 자체가 거절된다. | `tool-mcp/src/index.ts`의 ui-session permit 부재와 runtime `proxy-modes.js`. UI가 선택적인 서버의 텍스트 fallback을 따로 설계할 필요. |
| MCP 인증 저장소 | OS keyring을 풀어도 OMA의 keyring 거절은 바뀌지 않는다. Jev·bearer 저장 경로의 안내는 OS 저장소를 고치라고 할 수 있다. | runtime `secure-keyring.js`, OMA authStore 정책. 지원되는 encrypted-file/명시적 인증 경로를 안내해야 함. |
| MCP 출력 최소 한도 | outputGuard를 64byte/1행처럼 작게 설정해도 파일 위치 안내가 약 200byte/3행으로 반환된다. | runtime `mcp-output-guard.js`. 최소값 검증 또는 별도 metadata 안내 계약 필요. 보통 크기의 한도는 지켜짐을 확인. |
| 웹 검색 필터 | provider마다 domain·recency 지원이 다르며 일부는 무시·프롬프트 힌트·결과 후처리로만 적용된다. | runtime provider 모듈들. 기능 지원표와 적용 여부를 결과에 표시할 필요. |
| 웹 도구 설정 | 네 개 도구의 이름·노출은 OMA 표면에 고정되어 upstream의 toolActivation/toolNames/tools 설정 일부가 그대로 적용되지 않는다. | `tool-web/src/index.ts`와 runtime 설정 overlay. 적용한 설정과 무시한 설정을 구분해 표시할 필요. |
| MCP 환경변수 | upstream의 MCP_DIRECT_TOOLS·MCP_OAUTH_*·BROWSER를 shell에서 설정해도 빈 ambient view 때문에 효과가 없다. 서버 HOME/XDG/TMP는 세션 scratch다. | `tool-mcp/src/index.ts`와 runtime `utils.js`. 명시적 설정 경로와 상태 보존 범위 안내 필요. |
| 웹 provider 선택 | 자동 선택은 무료 Exa 등을 우선하며 `all`도 모든 유료 provider를 뜻하지 않는다. Perplexity에는 사용자 요금제와 별개인 로컬 분당 제한이 있다. | runtime `index.js`, `perplexity.js`. 실제 선택·제외 이유와 제한을 표시할 필요. |
| 인증 endpoint redirect | MCP 인증 헤더·요청 서명과 OAuth token form이 있는 요청은 redirect를 거절한다. 같은 origin의 redirect도 최종 URL을 설정해야 한다. | 인증값이 전달되거나 서명이 재사용되는 것을 막는 현재 계약. 안전한 같은 origin 이동 지원은 별도 검증 필요. |
| GitHub branch 이름 | blob/tree URL에서 slash가 들어간 branch 이름을 정확히 구분하지 못할 수 있다. | runtime `github-extract.js`. 실제 refs를 확인하는 URL 해석 설계 필요. |
| 웹 curator 대기 | 기본 idle 시간(로컬 20초·원격 60초)이 지나면 선택을 자동 제출한다. | runtime curator 설정. 검토·요약 생성 중 만료 동작을 명확히 표시할 필요. |
| 로컬 미디어 파일 | 원격 미디어 도구를 쓸 수 있어도 localFileFetch permit이 없어 로컬 파일 가져오기는 거절된다. | 웹 policy. 원격 미디어와 로컬 파일 권한을 별도 안내. |
| GitHub 내용 생략 | 댓글·변경 파일 목록 등이 내부 한도에서 생략되어 get_search_content의 offset을 늘려도 복원되지 않는다. | runtime `github-issue-pr.js`. 저장 전 생략과 화면 pagination을 구분하고 추가 조회를 제공할 필요. |

## 구조 효율성

이번에 작은 범위로 수정한 것은 두 곳이다. `config/src/operations.ts`는 매 문서마다 전체 문서 크기를 합산하던 작업을 누적 합으로 바꿨다. `protocol/src/operation-codec.ts`는 메시지·수신자 관계 검증의 반복 검색을 Map/Set으로 바꿨다. 기존 검증 순서와 오류 판정은 유지한다.

다음은 소유권·캐시 무효화·공개 범위 설계가 필요해 기록하고 유지한다.

| 위치 | 비용 또는 중복 | 별도 작업이 필요한 이유 |
|---|---|---|
| `client/src/index.ts` / `protocol/src/response-codec.ts` | invocationLink 검증 중복 | 두 경로의 오류 계약과 self-resolution 검사가 달라 공통화 시 호환 검증 필요 |
| `extension/src/collaboration-invocations.ts` | 요청마다 branch 전체 scan, 미응답 tool call의 반복 원격 조회 | terminal observation과 재시도 의미를 보존하는 이력 index 필요 |
| `runtime/host-invocations.ts` | 전체 history와 lineage 반복 읽기 | 현재 원본 호출 결박을 유지하는 snapshot index 필요 |
| `views/collaboration-state.ts` | 관측 시각이 generation hash에 포함돼 같은 내용도 새 페이지 생성 | 내용 identity와 관측 metadata, retention을 분리해야 함 |
| `views/collaboration-logs.ts` | actor별 모든 Worker 로그 복제·재검증 | 최악의 경우 Worker 수의 제곱에 비례. 공개 권한을 유지하는 공유 artifact 필요 |
| `views/collaboration-review-materials.ts` / Review | spool 후 patch 전체 메모리 읽기·복사 | UTF-8 검증·hash·복사의 streaming port 필요 |
| `protocol/src/operation-codec.ts` | 조회 사이에서 같은 조상 관계 반복 검증 | 손상 관측과 실패 시 무효화되는 Store snapshot cache 계약 필요 |
| `tool-runtime/src/contained-search.ts` | 검색마다 private snapshot 구성 | 명령의 현재성·파일 교체 검사를 유지하는 snapshot 재사용 설계 필요 |
| `tool-files/src/results.ts` | 페이지마다 결과 파일 전체 hash | 신뢰 가능한 immutable 소유권 또는 검증 snapshot 없이 단순 생략 불가 |
| `runtime/input-effects.ts` | stream 전체 누적 후 다시 Buffer 결합 | freeze·재시도 가능한 원본을 보존하는 spool 인터페이스 필요 |
| `application/local-packages.ts` | gzip 전체 staging 뒤 tar 검사 | 압축 해제 중 한도·취소·부분 write를 다루는 통합 stream 경계 검토 |
| vendored 웹 `storage.js` | 캐시 prune 반복 합산, 검색 결과와 본문의 메모리 보존 | quota·세션 복원·본문 참조 수명 통합 필요 |

| Review attestation | 같은 사실·target을 반복 decode/scan | revision과 권한이 결박된 snapshot index 필요 |
| Store transaction 대기 | busy timeout과 재시도가 동기식 이벤트 루프를 오래 점유할 수 있음 | 재시도·취소·트랜잭션 소유권을 함께 설계해야 함 |
| Mail header 일괄 검증 | 메시지별 전체 agent 목록을 반복 조회 | 동일 Store snapshot에서 재사용할 수 있는 검증 문맥 필요 |
| MCP 설정 preview | unified diff가 줄 수의 곱에 비례하는 LCS 행렬을 생성 | 큰 설정에서 메모리 한도 또는 제한 diff 알고리즘 검토 |
| GitHub clone·웹 UI | 큰 파일을 전체 동기 읽은 뒤 자르며 자체 Markdown sanitizer와 외부 CDN script를 유지 | bounded read, 유지보수되는 sanitizer, 고정 browser asset 도입은 별도 검토 |
| 검증·MCP 명령·Git context | compliance에서 clause마다 전체 source hash, header-command 종료 감시의 반복 전체 ps 조회, 파일별 Git subprocess | snapshot 재사용·프로세스 추적·batch 처리의 수명 계약 검토 |
| 검증·vendor 생성 | 테스트 이름 배열을 수동 동기화하며 작은 변경도 전체 vendor emit·hash·packaging을 반복 | 검증 계약을 보존하는 생성·incremental provenance 설계 필요 |
| 웹 provider 설정 | 여러 provider가 같은 JSON·오류·캐시 로직을 따로 소유 | reload 시점과 형식별 호환성을 유지하는 공통 설정 계층 필요 |

추가 확인 대상으로 LSP oversized frame에서 top-level이 아닌 `id`를 요청 ID로 오인할 가능성을 남긴다. 아직 재현하지 않았으므로 수정·검증 완료 항목에 포함하지 않는다.

검토에서 발견한 제약을 완화하는 작업과 이번 결함 수리는 구분한다. 큰 설계 변경을 작은 버그 수정에 섞어 권한·복구 계약을 바꾸지 않았다.
