/** Local runner reporting only. Read all TAP bytes without retaining a whole
 * file or an unbounded diagnostic line. Raw TAP is never rewritten here. */
import { createReadStream } from "node:fs";
import { unrunTests } from "./verification-lanes.mjs";

const LINE_PREVIEW = 4096;
const DIRECTIVE_PREVIEWS = 200;

export async function readLocalTestSummary(path) {
  const counts = new Map(), directives = [];
  let prefix = "", tail = "", length = 0, directive = false, directiveCount = 0;
  function consume(part, endOfLine) {
    prefix += part.slice(0, LINE_PREVIEW - prefix.length);
    length += part.length;
    const probe = tail + part;
    const match = / # (SKIP|TODO)\b/.exec(probe);
    // A token at a chunk edge is not yet a word boundary: SKIPPER must not
    // become SKIP just because the next character arrives in another chunk.
    if (match && (endOfLine || match.index + match[0].length < probe.length)) directive = true;
    tail = probe.slice(-12);
    if (!endOfLine) return;
    if (length === prefix.length) {
      const count = /^# (skipped|todo|cancelled) (\d+)\r?$/.exec(prefix);
      if (count && !counts.has(count[1])) counts.set(count[1], prefix);
    }
    if (directive) {
      directiveCount += 1;
      if (directives.length < DIRECTIVE_PREVIEWS)
        directives.push(prefix.trim() + (length > prefix.length ? ` [truncated; raw line ${length} characters]` : ""));
    }
    prefix = ""; tail = ""; length = 0; directive = false;
  }
  for await (const chunk of createReadStream(path, { encoding: "utf8", highWaterMark: 64 * 1024 })) {
    let offset = 0;
    for (;;) {
      const end = chunk.indexOf("\n", offset);
      if (end < 0) { consume(chunk.slice(offset), false); break; }
      consume(chunk.slice(offset, end), true);
      offset = end + 1;
    }
  }
  if (length > 0) consume("", true);
  const unrun = unrunTests([...counts.values()].join("\n"));
  // A contradictory zero count must not hide an individual unrun test.
  if (directiveCount > 0) unrun.push(`unrun directives: ${directiveCount}`);
  return { unrun, directives, omittedDirectives: directiveCount - directives.length };
}
