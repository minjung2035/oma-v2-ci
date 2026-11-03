import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

// Scheduling hints only: this cache can never exclude a file or certify a pass.
export function readTimings(path) {
  try {
    return new Map(readFileSync(path, "utf8").split("\n").flatMap(line => {
      const [file, ms] = line.split("\t");
      const duration = Number(ms);
      return file && Number.isFinite(duration) && duration >= 0 ? [[file, duration]] : [];
    }));
  } catch (error) {
    if (error.code !== "ENOENT") console.error(`Test timing cache unavailable: ${error.message}`);
    return new Map();
  }
}

export function orderTests(files, timings) {
  const size = file => statSync(file).size;
  // Unmeasured files go first, largest first on a cold cache. Subsequent runs
  // start the longest measured files first to avoid an idle tail of workers.
  const weights = new Map(files.map(file => [file, timings.get(file) ?? Infinity]));
  const sizes = new Map(files.map(file => [file, size(file)]));
  return [...files].sort((a, b) => weights.get(b) - weights.get(a) || sizes.get(b) - sizes.get(a) || a.localeCompare(b));
}

export function saveTimings(path, files, timings) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, files.filter(file => timings.has(file)).sort()
      .map(file => `${file}\t${timings.get(file)}\n`).join(""));
  } catch (error) {
    console.error(`Test timing cache not saved: ${error.message}`);
  }
}

export default async function* fileTimings(events) {
  for await (const event of events) {
    if (event.type === "test:summary" && event.data.file)
      yield `${relative(process.cwd(), resolve(event.data.file))}\t${event.data.duration_ms}\n`;
  }
}
