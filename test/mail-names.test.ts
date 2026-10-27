import test from "node:test";
import assert from "node:assert/strict";
import { mailNamerFor, mailPartyName } from "@oma/tui/mail-names";

/** Actual names remain stable across roster changes. */

test("B4: the fixed roles map without a roster", () => {
  const name = mailNamerFor(undefined);
  assert.equal(name("residents"), "residents");
  assert.equal(name("commons"), "commons");
  assert.equal(name("principal"), "principal");
  assert.equal(name("topic-merge"), "topic/merge");
  // A missing roster cannot change an actor identity.
  assert.equal(name("worker-a"), "worker-a");
  assert.equal(name("ghost"), "ghost");
});

test("B4: a roster preserves actual worker names", () => {
  const name = mailNamerFor(["principal", "worker-b", "worker-a"]);
  assert.equal(name("worker-a"), "worker-a");
  assert.equal(name("worker-b"), "worker-b");
  assert.equal(name("principal"), "principal");
  assert.equal(name("residents"), "residents");
  assert.equal(name("commons"), "commons");
  assert.equal(name("topic-plan"), "topic/plan");
  // A name the roster does not know keeps what the header said.
  assert.equal(name("worker-z"), "worker-z");
});

test("B4: names do not depend on roster order", () => {
  const forward = mailNamerFor(["worker-a", "worker-b", "worker-c"]);
  const shuffled = mailNamerFor(["worker-c", "worker-a", "worker-b", "worker-a"]);
  for (const local of ["worker-a", "worker-b", "worker-c"])
    assert.equal(forward(local), shuffled(local), `inconsistent name for ${local}`);
  assert.equal(forward("worker-c"), "worker-c");
});

test("B4: a roster actor named like a topic is a worker, not a topic", () => {
  // parseDisplayedAddress lets an actor keep its name over the topic shape;
  // the screen agrees -- the roster decides before the shape does.
  const name = mailNamerFor(["topic-x", "worker-a"]);
  assert.equal(name("topic-x"), "topic-x");
  // Without that actor in the roster, the shape is a topic.
  assert.equal(mailNamerFor(["worker-a"])("topic-x"), "topic/x");
});

test("B4: mailPartyName preserves actor identities", () => {
  const workers = ["worker-a", "worker-b"];
  assert.equal(mailPartyName("worker-b", workers), "worker-b");
  assert.equal(mailPartyName("worker-b", undefined), "worker-b");
  assert.equal(mailPartyName("residents", workers), "residents");
});
