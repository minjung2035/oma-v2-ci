import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import ts from "typescript";

function diagnostics(text) {
  const file = resolve("test/__opaque-ledger-compile.ts");
  const options = {
    strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
    noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile, exists = host.fileExists;
  host.readFile = name => name === file ? text : read(name);
  host.fileExists = name => name === file || exists(name);
  return ts.getPreEmitDiagnostics(ts.createProgram([file], options, host))
     .filter(item => item.category === ts.DiagnosticCategory.Error)
    .map(item => ({ code: item.code, message: ts.flattenDiagnosticMessageText(item.messageText, "\n") }));
}
const prelude = "\nimport type { Actor, OperationId, MessageId, BatchId, RequestKey } from \"@oma/domain/identifiers\";\nimport { parseOperationId } from \"@oma/domain/identifiers\";\nimport { decodeOperation } from \"@oma/protocol/operation-codec\";\nimport { decodeDeliveryRow, decodeBatchRow, decodeAgentRow, decodeBatchManifest } from \"../packages/storage/dist/rows.js\";\nimport type { LedgerReader } from \"../packages/storage/dist/ledger-reader.js\";\nimport type { Actor as WireActor, OperationId as WireOperationId } from \"@oma/contracts/identity\";\ndeclare const operation: ReturnType<typeof decodeOperation>;\ndeclare const delivery: ReturnType<typeof decodeDeliveryRow>;\ndeclare const batch: ReturnType<typeof decodeBatchRow>;\ndeclare const agent: ReturnType<typeof decodeAgentRow>;\ndeclare const ids: ReturnType<LedgerReader[\"recoverableIds\"]>;\ndeclare function operationOnly(value: OperationId): void;\ndeclare function messageOnly(value: MessageId): void;\ndeclare function batchOnly(value: BatchId): void;\ndeclare function requestOnly(value: RequestKey): void;\ndeclare function actorOnly(value: Actor): void;\n";
test("P2.5: validated ledger outputs preserve identity brands and wire stays string", () => {
  assert.deepEqual(diagnostics(prelude + `
operationOnly(operation.id); operationOnly(delivery.operationId);
messageOnly(delivery.messageId);
batchOnly(batch.id); requestOnly(operation.requestKey);
actorOnly(operation.actor); actorOnly(agent.name);
for (const id of ids) operationOnly(id);
const parsed = parseOperationId("not-an-id");
if (parsed !== null) operationOnly(parsed);
const wire: WireOperationId = "wire remains a string";
const wireActor: WireActor = "wire remains a string";
`), []);
});
test("P2.5: operation/message/batch/request/actor mixups are compile errors", () => {
  const result = diagnostics(prelude + `
messageOnly(operation.id);
operationOnly(delivery.messageId);
requestOnly(batch.id);
batchOnly(operation.requestKey);
actorOnly(operation.id);
operationOnly("unchecked");
`);
  assert.equal(result.length, 6, JSON.stringify(result, null, 2));
  assert.ok(result.every(item => item.code === 2345), "each rejected argument must be a type incompatibility");
});
