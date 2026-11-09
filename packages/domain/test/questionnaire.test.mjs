import assert from "node:assert/strict";
import test from "node:test";
import { normalizeQuestionParams, validateQuestionnaire } from "@oma/domain/ask-user-question/questionnaire";

test("001. Optional questionnaire fields reject wrong types before presentation", () => {
  const question = {
    question: "Choose?", header: "Choice",
    options: [{ label: "A", description: "a" }, { label: "B", description: "b" }],
  };
  const validate = (value) => validateQuestionnaire(normalizeQuestionParams({ questions: [value] }));
  for (const preview of [null, 42, {}, []]) {
    const result = validate({ ...question, options: [{ ...question.options[0], preview }, question.options[1]] });
    assert.equal(result.ok, false, `preview ${JSON.stringify(preview)}`);
    assert.equal(result.error, "missing_fields");
  }
  for (const multiSelect of [null, "true", 1, {}]) {
    assert.equal(validate({ ...question, multiSelect }).ok, false);
  }
  for (const multiSelect of [true, false, undefined]) {
    assert.equal(validate({ ...question, multiSelect }).ok, true);
  }
  assert.equal(validate({ ...question, options: [{ ...question.options[0], preview: "" }, question.options[1]] }).ok, true);
});
