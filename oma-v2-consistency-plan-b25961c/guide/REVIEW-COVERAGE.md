# Production 검토 범위와 배정 원장

기준은 [S60](SOURCES.md#s60)의 고정 `production-files.txt`다. **220개 경로를 빠짐없이 주 검토 WP에 배정했다. 이것은 220개 파일의 모든 행을 이미 검토했다는 뜻이 아니다.**

| 이번 계획 작성의 근거 상태 | 파일 수 |
|---|---:|
| READ_THIS_PASS — 전체/부분 재조회 범위는 각 Sxx 참고 | 15 |
| READ_PRIOR_SAME_SHA — 이전 동일 SHA 검토 범위 사용 | 41 |
| SCOPE_ONLY — inventory와 담당 배정만 확인 | 164 |

구현 검토 상태는 모든 경로 `NOT_STARTED`, 제품 시험은 `NOT_RUN`에서 시작한다. 기존 감사의 전체/부분 읽기 구분을 지우지 않는다. 주 검토 WP는 실제 파일의 모든 relevant 문장과 호출 관계를 읽고 [FILE-REVIEW](../templates/FILE-REVIEW.md)로 마감한다. [WP32](../workpackages/WP32.md)는 마지막 diff를 다시 확인한다.

## 전체 파일 표

| 경로 | 주 검토 WP | 계획 근거 | 출처 |
|---|---|---|---|
| `implementation/contracts.ts` | [WP29](../workpackages/WP29.md) | SCOPE_ONLY | 미조회 |
| `implementation/schema-v1.sql` | [WP04](../workpackages/WP04.md) | READ_THIS_PASS | [S02](SOURCES.md#s02) |
| `implementation/systemd/broker.service.in` | [WP03](../workpackages/WP03.md) | SCOPE_ONLY | 미조회 |
| `implementation/systemd/principal-relay.service.in` | [WP03](../workpackages/WP03.md) | SCOPE_ONLY | 미조회 |
| `implementation/systemd/principal.path.in` | [WP03](../workpackages/WP03.md) | SCOPE_ONLY | 미조회 |
| `implementation/systemd/reconcile.service.in` | [WP03](../workpackages/WP03.md) | SCOPE_ONLY | 미조회 |
| `implementation/systemd/reconcile.timer.in` | [WP03](../workpackages/WP03.md) | SCOPE_ONLY | 미조회 |
| `implementation/systemd/resident.path.in` | [WP03](../workpackages/WP03.md) | SCOPE_ONLY | 미조회 |
| `implementation/systemd/resident.service.in` | [WP03](../workpackages/WP03.md) | READ_THIS_PASS | [S39](SOURCES.md#s39) |
| `src/authority.ts` | [WP25](../workpackages/WP25.md) | SCOPE_ONLY | 미조회 |
| `src/broker.ts` | [WP21](../workpackages/WP21.md) | READ_PRIOR_SAME_SHA | [S06](SOURCES.md#s06) |
| `src/broker/composition.ts` | [WP21](../workpackages/WP21.md) | SCOPE_ONLY | 미조회 |
| `src/broker/connection.ts` | [WP26](../workpackages/WP26.md) | READ_PRIOR_SAME_SHA | [S61](SOURCES.md#s61) |
| `src/broker/internal-dispatcher.ts` | [WP21](../workpackages/WP21.md) | READ_PRIOR_SAME_SHA | [S63](SOURCES.md#s63) |
| `src/broker/logs.ts` | [WP23](../workpackages/WP23.md) | SCOPE_ONLY | 미조회 |
| `src/broker/peer-authenticator.ts` | [WP25](../workpackages/WP25.md) | SCOPE_ONLY | 미조회 |
| `src/broker/peer-pin.ts` | [WP25](../workpackages/WP25.md) | SCOPE_ONLY | 미조회 |
| `src/broker/principal-endpoint.ts` | [WP06](../workpackages/WP06.md) | SCOPE_ONLY | 미조회 |
| `src/broker/process-ancestry.ts` | [WP25](../workpackages/WP25.md) | SCOPE_ONLY | 미조회 |
| `src/broker/public-dispatcher.ts` | [WP21](../workpackages/WP21.md) | READ_PRIOR_SAME_SHA | [S62](SOURCES.md#s62) |
| `src/broker/replies.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/broker/transport-spool.ts` | [WP22](../workpackages/WP22.md) | SCOPE_ONLY | 미조회 |
| `src/cli.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/arguments.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/cache-codec.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/commands/agent.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/commands/context.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/commands/integrate.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/commands/logs.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/commands/routes.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/commands/send.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/commands/status.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/commands/submit.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/effects.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/effects/context.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/effects/mail.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/effects/submit.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/exit.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/request-intent.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/cli/request-service.ts` | [WP26](../workpackages/WP26.md) | READ_THIS_PASS | [S49](SOURCES.md#s49) |
| `src/cli/transport.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/config.ts` | [WP11](../workpackages/WP11.md) | READ_PRIOR_SAME_SHA | [S16](SOURCES.md#s16) |
| `src/config/defaults.ts` | [WP16](../workpackages/WP16.md) | READ_PRIOR_SAME_SHA | [S19](SOURCES.md#s19) |
| `src/config/operations.ts` | [WP12](../workpackages/WP12.md) | READ_PRIOR_SAME_SHA | [S17](SOURCES.md#s17) |
| `src/config/policy.ts` | [WP19](../workpackages/WP19.md) | READ_THIS_PASS | [S50](SOURCES.md#s50) |
| `src/diagnostics/files.ts` | [WP23](../workpackages/WP23.md) | SCOPE_ONLY | 미조회 |
| `src/diagnostics/integrity.ts` | [WP23](../workpackages/WP23.md) | SCOPE_ONLY | 미조회 |
| `src/diagnostics/ledger.ts` | [WP23](../workpackages/WP23.md) | SCOPE_ONLY | 미조회 |
| `src/diagnostics/mail.ts` | [WP23](../workpackages/WP23.md) | SCOPE_ONLY | 미조회 |
| `src/domain/admission.ts` | [WP21](../workpackages/WP21.md) | SCOPE_ONLY | 미조회 |
| `src/domain/canonical-json.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/domain/capabilities.ts` | [WP29](../workpackages/WP29.md) | SCOPE_ONLY | 미조회 |
| `src/domain/child-policy.ts` | [WP19](../workpackages/WP19.md) | SCOPE_ONLY | 미조회 |
| `src/domain/context-policy.ts` | [WP18](../workpackages/WP18.md) | SCOPE_ONLY | 미조회 |
| `src/domain/deployment.ts` | [WP31](../workpackages/WP31.md) | SCOPE_ONLY | 미조회 |
| `src/domain/derived.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/domain/errors.ts` | [WP21](../workpackages/WP21.md) | READ_PRIOR_SAME_SHA | [S05](SOURCES.md#s05) |
| `src/domain/exhaustive.ts` | [WP29](../workpackages/WP29.md) | SCOPE_ONLY | 미조회 |
| `src/domain/identifiers.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/domain/integer-fields.ts` | [WP29](../workpackages/WP29.md) | SCOPE_ONLY | 미조회 |
| `src/domain/limits.ts` | [WP29](../workpackages/WP29.md) | SCOPE_ONLY | 미조회 |
| `src/domain/lineage.ts` | [WP25](../workpackages/WP25.md) | SCOPE_ONLY | 미조회 |
| `src/domain/mail-values.ts` | [WP20](../workpackages/WP20.md) | SCOPE_ONLY | 미조회 |
| `src/domain/persisted-formats.ts` | [WP04](../workpackages/WP04.md) | SCOPE_ONLY | 미조회 |
| `src/domain/request-identity.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/domain/resources.ts` | [WP22](../workpackages/WP22.md) | SCOPE_ONLY | 미조회 |
| `src/domain/spec-identity.ts` | [WP25](../workpackages/WP25.md) | SCOPE_ONLY | 미조회 |
| `src/domain/tool-surface.ts` | [WP27](../workpackages/WP27.md) | SCOPE_ONLY | 미조회 |
| `src/durable.ts` | [WP29](../workpackages/WP29.md) | SCOPE_ONLY | 미조회 |
| `src/entry/broker.ts` | [WP03](../workpackages/WP03.md) | READ_THIS_PASS | [S40](SOURCES.md#s40) |
| `src/entry/host.ts` | [WP03](../workpackages/WP03.md) | SCOPE_ONLY | 미조회 |
| `src/entry/module-conformance.ts` | [WP31](../workpackages/WP31.md) | SCOPE_ONLY | 미조회 |
| `src/entry/oma.ts` | [WP28](../workpackages/WP28.md) | READ_PRIOR_SAME_SHA | [S20](SOURCES.md#s20) |
| `src/entry/runner.ts` | [WP03](../workpackages/WP03.md) | READ_PRIOR_SAME_SHA | [S41](SOURCES.md#s41) |
| `src/extension/batch-view.ts` | [WP27](../workpackages/WP27.md) | SCOPE_ONLY | 미조회 |
| `src/extension/cli-process.ts` | [WP27](../workpackages/WP27.md) | SCOPE_ONLY | 미조회 |
| `src/extension/delivery.ts` | [WP27](../workpackages/WP27.md) | READ_PRIOR_SAME_SHA | [S58](SOURCES.md#s58) |
| `src/extension/inference-bridge.ts` | [WP27](../workpackages/WP27.md) | SCOPE_ONLY | 미조회 |
| `src/extension/mail-tools.ts` | [WP27](../workpackages/WP27.md) | SCOPE_ONLY | 미조회 |
| `src/extension/principal-channel.ts` | [WP27](../workpackages/WP27.md) | SCOPE_ONLY | 미조회 |
| `src/extension/shared.ts` | [WP27](../workpackages/WP27.md) | SCOPE_ONLY | 미조회 |
| `src/extension/tool-surface.ts` | [WP27](../workpackages/WP27.md) | SCOPE_ONLY | 미조회 |
| `src/extension/workspace-guard.ts` | [WP22](../workpackages/WP22.md) | SCOPE_ONLY | 미조회 |
| `src/frame.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/git.ts` | [WP24](../workpackages/WP24.md) | READ_PRIOR_SAME_SHA | [S28](SOURCES.md#s28) |
| `src/git/canonical-command.ts` | [WP24](../workpackages/WP24.md) | SCOPE_ONLY | 미조회 |
| `src/git/context-mirror.ts` | [WP18](../workpackages/WP18.md) | SCOPE_ONLY | 미조회 |
| `src/git/context-publication.ts` | [WP18](../workpackages/WP18.md) | SCOPE_ONLY | 미조회 |
| `src/git/context-repository.ts` | [WP18](../workpackages/WP18.md) | SCOPE_ONLY | 미조회 |
| `src/git/context.ts` | [WP18](../workpackages/WP18.md) | READ_PRIOR_SAME_SHA | [S23](SOURCES.md#s23) |
| `src/git/integration-policy.ts` | [WP24](../workpackages/WP24.md) | READ_PRIOR_SAME_SHA | [S27](SOURCES.md#s27) |
| `src/git/integration.ts` | [WP24](../workpackages/WP24.md) | READ_PRIOR_SAME_SHA | [S26](SOURCES.md#s26) |
| `src/git/observe.ts` | [WP24](../workpackages/WP24.md) | SCOPE_ONLY | 미조회 |
| `src/git/paths.ts` | [WP24](../workpackages/WP24.md) | SCOPE_ONLY | 미조회 |
| `src/git/publication.ts` | [WP24](../workpackages/WP24.md) | SCOPE_ONLY | 미조회 |
| `src/git/quarantine.ts` | [WP24](../workpackages/WP24.md) | SCOPE_ONLY | 미조회 |
| `src/git/submit.ts` | [WP20](../workpackages/WP20.md) | READ_PRIOR_SAME_SHA | [S25](SOURCES.md#s25) |
| `src/hash.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/ids.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/leaf.ts` | [WP27](../workpackages/WP27.md) | SCOPE_ONLY | 미조회 |
| `src/lifecycle.ts` | [WP25](../workpackages/WP25.md) | SCOPE_ONLY | 미조회 |
| `src/lifecycle/actions.ts` | [WP25](../workpackages/WP25.md) | READ_THIS_PASS | [S65](SOURCES.md#s65) |
| `src/lifecycle/contracts.ts` | [WP25](../workpackages/WP25.md) | SCOPE_ONLY | 미조회 |
| `src/lifecycle/create-publication.ts` | [WP19](../workpackages/WP19.md) | SCOPE_ONLY | 미조회 |
| `src/lifecycle/create.ts` | [WP19](../workpackages/WP19.md) | READ_PRIOR_SAME_SHA | [S24](SOURCES.md#s24) |
| `src/lifecycle/policy.ts` | [WP25](../workpackages/WP25.md) | SCOPE_ONLY | 미조회 |
| `src/lifecycle/registry-operations.ts` | [WP25](../workpackages/WP25.md) | SCOPE_ONLY | 미조회 |
| `src/lifecycle/workspace.ts` | [WP19](../workpackages/WP19.md) | SCOPE_ONLY | 미조회 |
| `src/mail.ts` | [WP20](../workpackages/WP20.md) | SCOPE_ONLY | 미조회 |
| `src/mail/addresses.ts` | [WP20](../workpackages/WP20.md) | SCOPE_ONLY | 미조회 |
| `src/mail/batch-policy.ts` | [WP06](../workpackages/WP06.md) | SCOPE_ONLY | 미조회 |
| `src/mail/batches.ts` | [WP06](../workpackages/WP06.md) | READ_PRIOR_SAME_SHA | [S09](SOURCES.md#s09) |
| `src/mail/facts.ts` | [WP20](../workpackages/WP20.md) | SCOPE_ONLY | 미조회 |
| `src/mail/headers.ts` | [WP20](../workpackages/WP20.md) | SCOPE_ONLY | 미조회 |
| `src/mail/materializer.ts` | [WP20](../workpackages/WP20.md) | SCOPE_ONLY | 미조회 |
| `src/mail/reconcile.ts` | [WP20](../workpackages/WP20.md) | SCOPE_ONLY | 미조회 |
| `src/mail/routing.ts` | [WP20](../workpackages/WP20.md) | SCOPE_ONLY | 미조회 |
| `src/mail/serialize.ts` | [WP20](../workpackages/WP20.md) | SCOPE_ONLY | 미조회 |
| `src/module-ports.ts` | [WP29](../workpackages/WP29.md) | SCOPE_ONLY | 미조회 |
| `src/pi-extension.ts` | [WP27](../workpackages/WP27.md) | READ_PRIOR_SAME_SHA | [S57](SOURCES.md#s57) |
| `src/ports/ledger.ts` | [WP29](../workpackages/WP29.md) | SCOPE_ONLY | 미조회 |
| `src/ports/runtime.ts` | [WP29](../workpackages/WP29.md) | SCOPE_ONLY | 미조회 |
| `src/process/async.ts` | [WP10](../workpackages/WP10.md) | READ_PRIOR_SAME_SHA | [S66](SOURCES.md#s66) |
| `src/process/command.ts` | [WP10](../workpackages/WP10.md) | SCOPE_ONLY | 미조회 |
| `src/process/policies.ts` | [WP24](../workpackages/WP24.md) | SCOPE_ONLY | 미조회 |
| `src/process/preparation.ts` | [WP17](../workpackages/WP17.md) | READ_THIS_PASS | [S45](SOURCES.md#s45) |
| `src/process/run.ts` | [WP10](../workpackages/WP10.md) | SCOPE_ONLY | 미조회 |
| `src/protocol/batch-view.ts` | [WP06](../workpackages/WP06.md) | SCOPE_ONLY | 미조회 |
| `src/protocol/byte-queue.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/protocol/channel.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/protocol/host-channel.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/protocol/jsonl.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/protocol/log-response.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/protocol/methods.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/protocol/operation-results.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/protocol/principal-credential.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/protocol/receipt-codec.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/protocol/receipts.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/protocol/request-codec.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/protocol/response-codec.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/protocol/run-lease.ts` | [WP25](../workpackages/WP25.md) | SCOPE_ONLY | 미조회 |
| `src/protocol/status-view.ts` | [WP23](../workpackages/WP23.md) | SCOPE_ONLY | 미조회 |
| `src/reconcile.ts` | [WP21](../workpackages/WP21.md) | READ_PRIOR_SAME_SHA | [S29](SOURCES.md#s29) |
| `src/reconcile/operations.ts` | [WP21](../workpackages/WP21.md) | SCOPE_ONLY | 미조회 |
| `src/request-cache.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/rpc-client.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/runner.ts` | [WP07](../workpackages/WP07.md) | READ_PRIOR_SAME_SHA | [S10](SOURCES.md#s10) |
| `src/runtime/assets.ts` | [WP31](../workpackages/WP31.md) | SCOPE_ONLY | 미조회 |
| `src/runtime/broker-lifetime.ts` | [WP10](../workpackages/WP10.md) | READ_THIS_PASS | [S44](SOURCES.md#s44) |
| `src/runtime/broker-supervisor.ts` | [WP03](../workpackages/WP03.md) | READ_THIS_PASS | [S42](SOURCES.md#s42) |
| `src/runtime/deployment-manifest.ts` | [WP31](../workpackages/WP31.md) | SCOPE_ONLY | 미조회 |
| `src/runtime/engine-auth.ts` | [WP27](../workpackages/WP27.md) | READ_THIS_PASS | [S51](SOURCES.md#s51) |
| `src/runtime/extension-integrity.ts` | [WP27](../workpackages/WP27.md) | SCOPE_ONLY | 미조회 |
| `src/runtime/host-tenure.ts` | [WP09](../workpackages/WP09.md) | READ_PRIOR_SAME_SHA | [S69](SOURCES.md#s69) |
| `src/runtime/inference-relay.ts` | [WP27](../workpackages/WP27.md) | SCOPE_ONLY | 미조회 |
| `src/runtime/pi-adapter.ts` | [WP10](../workpackages/WP10.md) | READ_PRIOR_SAME_SHA | [S14](SOURCES.md#s14) |
| `src/runtime/pi-rpc.ts` | [WP10](../workpackages/WP10.md) | READ_PRIOR_SAME_SHA | [S13](SOURCES.md#s13) |
| `src/runtime/pi-runtime.ts` | [WP31](../workpackages/WP31.md) | SCOPE_ONLY | 미조회 |
| `src/runtime/pi-spawn-plan.ts` | [WP27](../workpackages/WP27.md) | SCOPE_ONLY | 미조회 |
| `src/runtime/principal-delivery.ts` | [WP08](../workpackages/WP08.md) | READ_PRIOR_SAME_SHA | [S11](SOURCES.md#s11) |
| `src/runtime/process-lock.ts` | [WP25](../workpackages/WP25.md) | SCOPE_ONLY | 미조회 |
| `src/runtime/provision.ts` | [WP16](../workpackages/WP16.md) | READ_PRIOR_SAME_SHA | [S21](SOURCES.md#s21) |
| `src/runtime/resident-rootfs.ts` | [WP27](../workpackages/WP27.md) | SCOPE_ONLY | 미조회 |
| `src/runtime/run-registry.ts` | [WP25](../workpackages/WP25.md) | READ_THIS_PASS | [S71](SOURCES.md#s71) |
| `src/runtime/society-lease.ts` | [WP25](../workpackages/WP25.md) | READ_THIS_PASS | [S43](SOURCES.md#s43) |
| `src/runtime/supervision-channel.ts` | [WP03](../workpackages/WP03.md) | SCOPE_ONLY | 미조회 |
| `src/sandbox.ts` | [WP27](../workpackages/WP27.md) | SCOPE_ONLY | 미조회 |
| `src/storage/batch-view.ts` | [WP06](../workpackages/WP06.md) | READ_PRIOR_SAME_SHA | [S68](SOURCES.md#s68) |
| `src/storage/contained-fs.ts` | [WP05](../workpackages/WP05.md) | SCOPE_ONLY | 미조회 |
| `src/storage/context-files.ts` | [WP18](../workpackages/WP18.md) | SCOPE_ONLY | 미조회 |
| `src/storage/context-snapshot.ts` | [WP18](../workpackages/WP18.md) | SCOPE_ONLY | 미조회 |
| `src/storage/context-stream.ts` | [WP18](../workpackages/WP18.md) | READ_PRIOR_SAME_SHA | [S67](SOURCES.md#s67) |
| `src/storage/delivery-receipt.ts` | [WP05](../workpackages/WP05.md) | READ_PRIOR_SAME_SHA | [S08](SOURCES.md#s08) |
| `src/storage/diagnostic-snapshot.ts` | [WP23](../workpackages/WP23.md) | SCOPE_ONLY | 미조회 |
| `src/storage/directory.ts` | [WP17](../workpackages/WP17.md) | SCOPE_ONLY | 미조회 |
| `src/storage/durable-fs.ts` | [WP05](../workpackages/WP05.md) | READ_THIS_PASS | [S46](SOURCES.md#s46) |
| `src/storage/facets.ts` | [WP29](../workpackages/WP29.md) | SCOPE_ONLY | 미조회 |
| `src/storage/immutable-file.ts` | [WP20](../workpackages/WP20.md) | READ_THIS_PASS | [S47](SOURCES.md#s47) |
| `src/storage/ledger-reader.ts` | [WP04](../workpackages/WP04.md) | READ_THIS_PASS | [S48](SOURCES.md#s48) |
| `src/storage/operation-codec.ts` | [WP29](../workpackages/WP29.md) | READ_PRIOR_SAME_SHA | [S04](SOURCES.md#s04) |
| `src/storage/operation-journal.ts` | [WP29](../workpackages/WP29.md) | SCOPE_ONLY | 미조회 |
| `src/storage/operation-transitions.ts` | [WP29](../workpackages/WP29.md) | SCOPE_ONLY | 미조회 |
| `src/storage/paths.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/storage/preaccept-artifact.ts` | [WP17](../workpackages/WP17.md) | READ_PRIOR_SAME_SHA | [S22](SOURCES.md#s22) |
| `src/storage/quota.ts` | [WP22](../workpackages/WP22.md) | READ_PRIOR_SAME_SHA | [S56](SOURCES.md#s56) |
| `src/storage/receipt-projector.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/storage/rows.ts` | [WP04](../workpackages/WP04.md) | SCOPE_ONLY | 미조회 |
| `src/storage/staged-tree.ts` | [WP17](../workpackages/WP17.md) | SCOPE_ONLY | 미조회 |
| `src/storage/submit-spool.ts` | [WP20](../workpackages/WP20.md) | SCOPE_ONLY | 미조회 |
| `src/storage/transaction.ts` | [WP04](../workpackages/WP04.md) | READ_PRIOR_SAME_SHA | [S03](SOURCES.md#s03) |
| `src/storage/transitions.ts` | [WP06](../workpackages/WP06.md) | READ_PRIOR_SAME_SHA | [S07](SOURCES.md#s07) |
| `src/store.ts` | [WP04](../workpackages/WP04.md) | READ_PRIOR_SAME_SHA | [S32](SOURCES.md#s32) |
| `src/tui/app.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/tui/dashboard.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/tui/exit.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/tui/keys.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/tui/limits.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/tui/model.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/tui/prompt.ts` | [WP09](../workpackages/WP09.md) | SCOPE_ONLY | 미조회 |
| `src/tui/screen.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/tui/session.ts` | [WP09](../workpackages/WP09.md) | READ_PRIOR_SAME_SHA | [S12](SOURCES.md#s12) |
| `src/tui/sources/extensions.ts` | [WP14](../workpackages/WP14.md) | READ_PRIOR_SAME_SHA | [S18](SOURCES.md#s18) |
| `src/tui/sources/mail.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/tui/sources/settings.ts` | [WP15](../workpackages/WP15.md) | READ_PRIOR_SAME_SHA | [S15](SOURCES.md#s15) |
| `src/tui/transcript.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/tui/transport.ts` | [WP23](../workpackages/WP23.md) | SCOPE_ONLY | 미조회 |
| `src/tui/view/dashboard.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/tui/view/index.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/tui/view/labels.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/tui/view/layout.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/tui/view/notice.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/tui/view/screens.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/tui/view/text.ts` | [WP28](../workpackages/WP28.md) | SCOPE_ONLY | 미조회 |
| `src/units.ts` | [WP25](../workpackages/WP25.md) | READ_PRIOR_SAME_SHA | [S30](SOURCES.md#s30) |
| `src/units/execute.ts` | [WP25](../workpackages/WP25.md) | READ_PRIOR_SAME_SHA | [S31](SOURCES.md#s31) |
| `src/units/observe.ts` | [WP25](../workpackages/WP25.md) | SCOPE_ONLY | 미조회 |
| `src/units/render.ts` | [WP25](../workpackages/WP25.md) | SCOPE_ONLY | 미조회 |
| `src/validate.ts` | [WP26](../workpackages/WP26.md) | SCOPE_ONLY | 미조회 |
| `src/views.ts` | [WP23](../workpackages/WP23.md) | SCOPE_ONLY | 미조회 |
| `src/views/pending-work.ts` | [WP23](../workpackages/WP23.md) | SCOPE_ONLY | 미조회 |

## Production manifest 밖의 필수 범위

현재 inventory가 repository 전체 tracked file 집합은 아니다. 분리된 `implementation/contracts/`, tests/fixtures, scripts/checkers, package/lock/compiler 설정, operating files, architecture/spec/owner maps, CI는 별도 읽어야 한다.

WP00이 `git ls-files`와 실제 import/build closure로 **현재 tree의 모든 tracked 경로**를 추가 inventory에 열거한다. contracts는 WP29/31, test fixture는 WP02 및 domain WP, scripts/static check는 WP29/31, verification tooling/CI는 WP30/32, 운영 문서는 WP01/13/15/31/32가 맡는다. 각 추가 파일에 주 검토 담당을 명시하고 새 production 파일은 본 표에도 추가한다.

wildcard/디렉터리만 써 둔 scope는 파일 전수 검토 완료가 아니다. 해당 실제 파일 목록을 handoff에 펼쳐 기록해야 한다. generated evidence는 수작업 편집하지 않고 생성/검증 경로를 검토한다. vendor dependency는 자체 전체 감사를 했다고 주장하지 않으며 lock·공식 API·배포 closure와 실제 사용 경계를 검증한다.
