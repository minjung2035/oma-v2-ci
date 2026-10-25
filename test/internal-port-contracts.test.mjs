import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import ts from "typescript";

test("P23 internal contracts expose only receipt lookup and synchronous transaction semantics", () => {
  const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options } = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    process.cwd(),
  );
  const file = resolve("test/internal-port-contract-probe.ts");
  const text = `
    import type { OperationLookup } from "@oma/contracts/durable";
    import type { StorePort, ReceiptProjector } from "#oma-test/app/ports/ledger";
    import type { BatchViewLimits } from "#oma-test/app/ports/runtime";
    import type { BatchViewLimits as DecoderLimits } from "@oma/protocol/batch-view";
    import { receiptOfOperation } from "@oma/protocol/receipt-projector";
    declare const store: StorePort;
    const value: number = store.transaction(() => 42);
    // @ts-expect-error Promise callbacks are not synchronous transactions.
    store.transaction(async () => 42);
    declare const maybeAsync: number | Promise<number>;
    // @ts-expect-error A possibly asynchronous result is also forbidden.
    store.transaction(() => maybeAsync);
    // @ts-expect-error The query port does not grant storage write capabilities.
    store.transaction(tx => tx.setOperationUnknown("id"));
    const keys: Record<keyof OperationLookup, true> = {
      id: true, kind: true, state: true, result: true, errorCode: true,
    };
    const operation = store.getOperation("principal", "key");
    if (operation) {
      // @ts-expect-error Raw audit JSON remains a storage implementation detail.
      operation.planJson;
      // @ts-expect-error Recovery plans are not part of the receipt lookup projection.
      operation.plan;
      const projector: ReceiptProjector = receiptOfOperation;
      projector(operation);
      if (operation.state === "succeeded") {
        const result: NonNullable<OperationLookup["result"]> = operation.result;
        const error: null = operation.errorCode;
      }
    }
    const limits: BatchViewLimits = { frameBytes: 4096, batchMaxMessages: 4 };
    const compatible: DecoderLimits = limits;
  `;
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (path, version, ...rest) =>
    resolve(path) === file
      ? ts.createSourceFile(path, text, version, true)
      : original(path, version, ...rest);
  const program = ts.createProgram({
    rootNames: [file, resolve("apps/oma/src/entry/module-conformance.ts")],
    options,
    host,
  });
  assert.deepEqual(
    ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ),
    [],
  );
});
