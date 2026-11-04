/** Preserve nested native ownership failures that TAP's short error block
 * omits. Diagnostics add evidence; every original event/result is retained. */
import { tap } from "node:test/reporters";
import { inspect } from "node:util";
export default async function* nativeTap(source) {
  async function* observed() {
    for await (const event of source) {
      yield event;
      if (event.type === "test:fail" && event.data?.details?.error !== undefined)
        yield { type: "test:diagnostic", data: { nesting: event.data.nesting ?? 0,
          message: "Native failure causes: " + inspect(event.data.details.error, {
            depth: 12, maxArrayLength: 24, maxStringLength: 4000, breakLength: 120,
          }) } };
    }
  }
  yield* tap(observed());
}
