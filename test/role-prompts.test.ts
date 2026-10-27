/** The role system prompts are model input, so what they contain -- and what
 * they no longer contain -- is pinned by key phrases, not full text.
 *
 * The Korean mirror of each prompt is preserved in the doc comment above its
 * constant as human documentation; the string the model receives is
 * English-only. The filename the Resident prompt and the world map both spell
 * is derived once in packages/domain/src/derived.ts. */
import test from "node:test";
import assert from "node:assert/strict";
import { PRINCIPAL_MAIL_FILENAME } from "@oma/domain/derived";
import { PRINCIPAL_SYSTEM_PROMPT, RESIDENT_SYSTEM_PROMPT } from "@oma/domain/role-prompts";

/** Hangul syllables and jamo: any Korean text at all, not one remembered phrase. */
const HANGUL = /[ᄀ-ᅟ㄰-㆏가-힯]/u;

test("the model-facing role prompts carry no Korean mirror text", () => {
  for (const prompt of [PRINCIPAL_SYSTEM_PROMPT, RESIDENT_SYSTEM_PROMPT]) {
    assert.doesNotMatch(prompt, HANGUL, "the Korean mirror lives in comments, not model input");
    assert.equal(prompt.includes("한국어 해석"), false);
    assert.equal(prompt.includes("당신은"), false);
  }
});

test("the Principal prompt spends investigation through the workforce while any Workers remain", () => {
  const judgement = PRINCIPAL_SYSTEM_PROMPT.slice(PRINCIPAL_SYSTEM_PROMPT.indexOf("## Judgement, not labor"));
  assert.match(judgement, /Investigation is delegation too/);
  assert.match(judgement, /post the question as mail and let the society bring back the answer/);
  assert.match(judgement, /only when no Workers remain/);
  // The new line extends "Do not do Worker work"; it does not retire it.
  assert.match(judgement, /Do not do Worker work/);
});

test("the Resident prompt points at the Principal mail guide as a guide, not a mandate", () => {
  const section = RESIDENT_SYSTEM_PROMPT.slice(RESIDENT_SYSTEM_PROMPT.indexOf("## The Principal"));
  const line = section.split("\n").find(row => row.includes(PRINCIPAL_MAIL_FILENAME));
  assert.ok(line, "the guide is named inside the Principal section");
  assert.match(line, /is the guide for that message/);
  assert.doesNotMatch(line, /\bmust\b/i, "the guide is advisory, not a mandate");
  // Prompts and world paths spell one filename.
  assert.equal(PRINCIPAL_MAIL_FILENAME, "PRINCIPAL-MAIL.md");
  assert.ok(RESIDENT_SYSTEM_PROMPT.includes(`/world/${PRINCIPAL_MAIL_FILENAME}`));
});

test("DR45/FI-3: the Resident prompt names current isolation and unrestricted network; submit reaches main", () => {
  const society = RESIDENT_SYSTEM_PROMPT.slice(RESIDENT_SYSTEM_PROMPT.indexOf("## The society"), RESIDENT_SYSTEM_PROMPT.indexOf("## Starting up"));
  assert.match(society, /`git push` does not reach `main`/);
  const execution = RESIDENT_SYSTEM_PROMPT.slice(RESIDENT_SYSTEM_PROMPT.indexOf("## Task execution"), RESIDENT_SYSTEM_PROMPT.indexOf("## The Principal"));
  for (const fact of [/shares the host network/i, /no egress allowlist or resource caps/i, /`\/tmp`/, /process\s+you\s+start/, /\/world\/START\.md/])
    assert.match(execution, fact);
  // The facts themselves live in the map (START.md); the prompt only points there.
  assert.doesNotMatch(RESIDENT_SYSTEM_PROMPT, /OMA_CPUS|docker|submodule/i);
});

test("the Resident prompt asks subjects that name what the mail is about", () => {
  const direction = RESIDENT_SYSTEM_PROMPT.slice(
    RESIDENT_SYSTEM_PROMPT.indexOf("## Direction"), RESIDENT_SYSTEM_PROMPT.indexOf("## Task execution"));
  assert.match(direction, /subject is the index entry a reader scans/);
  assert.match(direction, /name what the mail is about/);
  assert.match(direction, /"update" and "question" say nothing/);
});
