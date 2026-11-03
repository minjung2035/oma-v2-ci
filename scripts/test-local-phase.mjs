import { run } from "node:test";
import { spec, tap } from "node:test/reporters";
import { createWriteStream } from "node:fs";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import fileTimings from "./local-test-timing.mjs";

const [concurrency, summary, timings, ...files] = process.argv.slice(2);
// Explicit files retain scheduling order; the CLI sorts positional files.
const tests = run({ files, concurrency: Number(concurrency) });
tests.on("test:fail", () => { process.exitCode = 1; });
const outputs = [[new spec(), process.stdout], [tap, createWriteStream(summary)],
  [fileTimings, createWriteStream(timings)]];
// The test harness finalizes after module evaluation; do not await its own end here.
Promise.all(outputs.map(([reporter, destination]) => {
  const input = new PassThrough({ objectMode: true });
  tests.pipe(input);
  return pipeline(input, reporter, destination, { end: destination !== process.stdout });
})).catch(error => { console.error(error); process.exitCode = 1; });
