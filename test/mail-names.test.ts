import test from "node:test";
import assert from "node:assert/strict";
import { mailNamerFor, mailPartyName } from "../src/tui/mail-names.js";

/** B4: the mail screen's party names -- `worker` for a broadcast to the
 * workers, `worker<N>` for one roster worker in the roster's name order,
 * `principal` for the Principal, `topic/<name>` for a topic, and the header's
 * own name for whatever the roster does not know. Display only: the durable
 * logical addresses never change. */

test("B4: the fixed roles map without a roster", () => {
  const name = mailNamerFor(undefined);
  assert.equal(name("residents"), "worker");
  assert.equal(name("commons"), "worker");
  assert.equal(name("principal"), "principal");
  assert.equal(name("topic-merge"), "topic/merge");
  // An actor's name with no roster is kept -- never an invented ordinal.
  assert.equal(name("worker-a"), "worker-a");
  assert.equal(name("ghost"), "ghost");
});

test("B4: a roster names its workers worker<N> by name order", () => {
  const name = mailNamerFor(["principal", "worker-b", "worker-a"]);
  assert.equal(name("worker-a"), "worker1");
  assert.equal(name("worker-b"), "worker2");
  assert.equal(name("principal"), "principal");
  assert.equal(name("residents"), "worker");
  assert.equal(name("commons"), "worker");
  assert.equal(name("topic-plan"), "topic/plan");
  // A name the roster does not know keeps what the header said.
  assert.equal(name("worker-z"), "worker-z");
});

test("B4: the ordinals do not depend on the order the roster arrived in", () => {
  const forward = mailNamerFor(["worker-a", "worker-b", "worker-c"]);
  const shuffled = mailNamerFor(["worker-c", "worker-a", "worker-b", "worker-a"]);
  for (const local of ["worker-a", "worker-b", "worker-c"])
    assert.equal(forward(local), shuffled(local), `inconsistent name for ${local}`);
  assert.equal(forward("worker-c"), "worker3");
});

test("B4: a roster actor named like a topic is a worker, not a topic", () => {
  // parseDisplayedAddress lets an actor keep its name over the topic shape;
  // the screen agrees -- the roster decides before the shape does.
  const name = mailNamerFor(["topic-x", "worker-a"]);
  assert.equal(name("topic-x"), "worker1");
  // Without that actor in the roster, the shape is a topic.
  assert.equal(mailNamerFor(["worker-a"])("topic-x"), "topic/x");
});

test("B4: mailPartyName takes already-computed ordinals", () => {
  const workers = ["worker-a", "worker-b"];
  assert.equal(mailPartyName("worker-b", workers), "worker2");
  assert.equal(mailPartyName("worker-b", undefined), "worker-b");
  assert.equal(mailPartyName("residents", workers), "worker");
});
