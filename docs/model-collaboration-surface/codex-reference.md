# Codex CLI reference — 고정 source와 OMA 적용 범위

[총괄 spec](../model-collaboration-surface-spec.md)의 외부 reference 기록이다. **공개 Codex CLI source**를 직접 확인했다. 비공개 system prompt나 특정 서비스의 배포 설정을 추측한 문서가 아니다.

## MCS-C01 — 조회 기준

Repository: [openai/codex](https://github.com/openai/codex).

고정 commit: [`67f0994b532b8740f14b5b738af7b7b2a915b1d6`](https://github.com/openai/codex/tree/67f0994b532b8740f14b5b738af7b7b2a915b1d6).

`main`은 변하므로 아래 링크는 모두 이 commit에 결박한다. 조사 시작 때 추측했던 `codex-rs/core/prompt.md`, `core/src/tools/spec.rs`, `core/templates/collaboration_mode/default.md`는 해당 조회에서 정상 source를 얻지 못했다. 그것을 읽은 근거로 인용하지 않고 실제 tree에서 확인한 경로를 사용했다.

| 고정 source | 확인한 부분 | OMA와의 관계 |
|---|---|---|
| [models-manager/prompt.md](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/models-manager/prompt.md) | 역할·AGENTS scope·진행·planning·task execution·검증·최종 전달의 section 구성 | 역할 행동과 task outcome을 설명하는 구조 |
| [core/gpt_5_codex_prompt.md](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/core/gpt_5_codex_prompt.md) | dirty worktree 보존, 관련 변경만 수행, review findings·검증 gap, 간결한 전달 | Worker의 기존 작업 보존과 증거 기반 보고 |
| [context/developer_instructions.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/core/src/context/developer_instructions.rs) | DeveloperInstructions의 content metadata/kind와 developer role | authored 지침과 다른 context의 출처 분리 |
| [context/environment_context.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/core/src/context/environment_context.rs) | FileSystemContext, permission profile rendering, push_xml_escaped_text | 환경 사실의 별도 표현·escaping; OMA는 자체 actual roots 사용 |
| [handlers/shell_spec.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/core/src/tools/handlers/shell_spec.rs) | exec_command/write_stdin의 목적, field help/default, required/closed schema, output 의미 | description/parameter/result를 나누는 작성법 |
| [handlers/apply_patch_spec.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/core/src/tools/handlers/apply_patch_spec.rs) | freeform grammar와 JSON으로 감싸지 말라는 도구별 입력 설명 | 도구 실제 형식을 정확히 설명해야 한다는 사례. 형식 자체는 가져오지 않음 |
| [handlers/tool_search_spec.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/core/src/tools/handlers/tool_search_spec.rs) | metadata 검색, 다음 model call 노출, source listing과 parameter defaults | discovery와 execution 분리. OMA는 고정 group entry 선택 |
| [tools/spec_plan.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/core/src/tools/spec_plan.rs) | build_tool_router의 core/MCP/extension/dynamic source 구성 및 policy 연결 | 선언과 실제 runtime의 일치 검사를 설계할 참고 |
| [tools/registry.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/core/src/tools/registry.rs) | CoreToolRuntime, ToolExecutor/ToolExposure, original invocation·hook selector 보존 | metadata·노출·실행을 같은 도구 identity에 연결하는 참고 |

추가 tree 확인: `codex-rs/protocol/src/prompts/base_instructions/default.md`는 이 commit의 tree에서 models-manager/prompt.md와 같은 blob `907ff8b877026871b088f01f4366cea36e1f02cd`를 가리킨다. 이는 그 두 파일의 byte identity 근거이지 모든 Codex 모델/세션의 최종 system prompt가 같다는 증거는 아니다.

## MCS-C02 — 실제 source에서 얻은 작성 원칙

### 1. 역할 prompt는 작업 수행의 판단 기준을 설명한다

공개 base prompt는 역할, task completion, relevant testing, 보고 방법을 별도 section으로 조직한다. model-specific prompt는 dirty worktree와 review 행동을 별도로 다룬다. OMA도 Worker/Principal이 무엇을 달성해야 하는지부터 적고, 내부 operation 단계와 필드 목록은 tool/implementation contract로 옮긴다.

그대로 복사하지 않는 부분도 있다. Codex base의 mandatory planning-tool 절차, 매 tool call 전 preamble, 특정 editing 명령, approval mode별 테스트 대기 규칙은 OMA의 독립 Worker 협업에 그대로 맞지 않는다. OMA는 필요한 경우 계획하고 유용한 변화만 mail로 전달하도록 적는다. 말투 규칙을 durable-message 폭증 규칙으로 만들지 않는다.

### 2. 도구 설명은 동작과 중요한 결과 경계를 먼저 말한다

shell spec의 짧은 목적 설명은 실행 뒤 output 또는 ongoing session ID를 받을 수 있음을 먼저 밝힌다. `workdir`, wait duration, output budget의 default는 각 property help에 있다. OMA는 이 **배치 방식**을 가져와 목적/사용 상황을 description에, 생략 의미와 exact target을 field help에, accepted/pending/applied 구분을 result에 둔다.

OMA `oma_merge`의 existing proposal에서 생략한 change가 HEAD가 아니라 frozen source라는 점은 목적 선택에 영향을 주므로 description에도 둔다. 반면 broker transaction의 세부 순서를 모델 description에 모두 넣지 않는다.

### 3. 형식 지침은 실제 serializer와 맞아야 한다

apply_patch spec은 자유 형식과 grammar를 명시한다. shell spec에는 `strict:false`이면서 object의 추가 field를 제한하는 구성도 있다. 따라서 Codex를 참고했다는 이유로 모든 도구가 strict provider schema라고 일반화하지 않는다.

OMA는 JSON tool의 closed schema/optional semantics를 Pi의 실제 serializer를 통해 검증한다. hashline은 hashline 원래 계약을 유지한다. Codex patch grammar로 바꾸거나 OMA에 없는 patch 도구를 prompt에 쓰지 않는다.

### 4. 발견 결과는 다음 호출의 공개와 연결된다

tool-search description은 다음을 명시한다.

> exposes matching tools for the next model call

이는 발견과 실행이 다른 단계라는 명확한 모델 mental model의 예다. OMA는 모든 도구를 검색하는 BM25/tool-search를 새로 만들지 않고 `lsp_tools`/`web_tools`의 좁은 두 그룹을 사용한다. **누적 활성화**는 OMA의 요구이며 이 source에서 OMA와 같은 restore/union 계약이 검증되었다고 주장하지 않는다.

Codex의 MCP discovery 지침도 그대로 복사하지 않는다. OMA의 기존 vendor `mcp`가 해당 기능의 owner다.

### 5. 환경과 지침은 출처를 유지한다

DeveloperInstructions는 metadata와 role을 명시하고, filesystem context는 실제 permission profile과 workspace roots를 별도로 렌더한다. OMA에서는 `oma_authority`, `oma_environment`, role text, tool snippets, project task data를 구분한다. 경로 문자열의 escape도 실제 전달 format에 맞춰 구현한다.

이 구조는 prompt injection을 자동 해결한다는 증거가 아니다. OMA는 실제 broker identity/capability·Principal containment·exact review target을 enforcement로 유지한다. mail의 `SYSTEM` 문자열은 role message가 되지 않는다.

### 6. registry와 prompt는 같은 실제 tool을 가리켜야 한다

확인한 router/registry 선언은 core, MCP, extensions, dynamic tools를 policy·exposure·runtime에 연결한다. OMA에서도 공개 이름만 고치는 것이 아니라 등록 metadata·next-call definitions·execution authority·guidance를 같이 검사한다. 하지만 Codex의 전체 runtime을 OMA 안에 복제하지 않는다. 기존 Pi 접점과 OMA tool-runtime이 owner다.

## MCS-C03 — 가져오지 않는 것

| Codex source에 존재하는 요소 | OMA가 가져오지 않는 이유 |
|---|---|
| exec_command/write_stdin의 PTY/session 의미 | OMA bundled bash의 실제 수명·결과 방식과 다름 |
| apply_patch freeform grammar | hashline/writer 계약 유지 요구 |
| update_plan 도구와 plan lifecycle | 모델 협업에 새 task protocol을 강요할 필요 없음 |
| request_permissions·sandbox escalation | OMA actor/capability/sandbox를 우회하는 새 허가 경로가 아님 |
| Codex child-agent wait/resume/control | OMA Worker는 독립 clone·durable mail·고유 lifecycle의 동료 |
| BM25/deferred-tool 검색과 MCP discovery 지침 | 고정 LSP/web 그룹과 vendor MCP면 충분하다는 설계 판단 |
| provider별 schema/cache/latency 최적화의 이식 | OMA 실제 provider/Pi 입력에서 별도 측정해야 함 |
| 모든 base/model prompt의 합본 | 서로 다른 변형을 하나의 실제 배포 prompt라고 볼 수 없음 |

## MCS-C04 — 근거와 가설의 구분

- **Source-supported observation:** 위 source에 목적/field help/default/schema가 구분되어 있고, tool discovery의 next-call 의미, context role·metadata·escaping, 관련 작업/검증/보고의 section이 존재한다.
- **OMA 설계 판단:** 파일 관측과 9개 OMA 행동, explicit exact target, host recovery, 고정 누적 그룹, 개별 lifecycle의 Human 이관이 이 제품의 모델 부담을 줄일 것이라는 선택이다.
- **아직 측정하지 않은 주장:** task 성공률·latency·token/cost·duplicate 감소·Human 개입 감소. Codex source를 읽었다는 사실이나 43→29라는 이름 수로 입증되지 않는다.

다른 외부 근거와 file-outbox 비교는 [세 번째 제안의 연구 표](../archive/design-drafts/intent-first-collaboration-surface.md#2-무엇을-근거로-바꿨는가)에 보존한다. Codex reference는 그 실험들을 대체하지 않고 이 spec의 **모델에게 정보를 배치하는 방식**을 더 구체화한다.
