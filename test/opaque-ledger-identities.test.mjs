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
const prelude = `
import type { Actor, OperationId, MessageId, BatchId, RequestKey } from "../src/domain/identifiers.js";
import { parseOperationId } from "../src/domain/identifiers.js";
import { decodeOperation } from "../src/storage/operation-codec.js";
import { decodeDeliveryRow, decodeBatchRow, decodeAgentRow, decodeBatchManifest } from "../src/storage/rows.js";
import type { LedgerReader } from "../src/storage/ledger-reader.js";
import type { Actor as WireActor, OperationId as WireOperationId } from "../implementation/contracts/identity.js";
declare const operation: ReturnType<typeof decodeOperation>;
declare const delivery: ReturnType<typeof decodeDeliveryRow>;
declare const batch: ReturnType<typeof decodeBatchRow>;
declare const agent: ReturnType<typeof decodeAgentRow>;
declare const ids: ReturnType<LedgerReader["recoverableIds"]>;
declare function operationOnly(value: OperationId): void;
declare function messageOnly(value: MessageId): void;
declare function batchOnly(value: BatchId): void;
declare function requestOnly(value: RequestKey): void;
declare function actorOnly(value: Actor): void;
`;
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
