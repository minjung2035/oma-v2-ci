-- MUST [DB-001]: Apply only to a new database, in one EXCLUSIVE transaction.
-- MUST [DB-002]: Broker is the sole writer; set these on every connection.
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;
BEGIN EXCLUSIVE;
CREATE TABLE agents (
  name TEXT PRIMARY KEY,
  spec_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('resident','principal')),
  desired TEXT NOT NULL CHECK(desired IN ('provisioning','enabled','stopped','retired')),
  incarnation INTEGER NOT NULL DEFAULT 0 CHECK(incarnation >= 0),
  profile TEXT NOT NULL,
  created_by TEXT REFERENCES agents(name),
  spec_json TEXT NOT NULL CHECK(json_valid(spec_json)),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= created_at_ms),
  CHECK((role = 'principal' AND name = 'principal') OR
        (role = 'resident' AND name <> 'principal'))
);
CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL REFERENCES agents(name),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN (
    'mail.send','mail.ack','route.follow','route.unfollow',
    'agent.create','agent.start','agent.stop','agent.continue',
    'git.submit','git.integrate','context.publish','attest.record','society.set'
  )),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),
  state TEXT NOT NULL CHECK(state IN ('pending','succeeded','failed','unknown')),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  error_code TEXT,
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= created_at_ms),
  UNIQUE(actor,request_key),
  CHECK(state <> 'succeeded' OR result_json IS NOT NULL),
  CHECK(state <> 'failed' OR error_code IS NOT NULL)
);
-- DR27: facts live only in operations.plan_json. This append-only index supplies
-- durable acceptance order; no wall clock, copied verdict or current authority.
CREATE TABLE attestations (
  sequence INTEGER PRIMARY KEY CHECK(sequence > 0),
  operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id)
);
CREATE TABLE subscriptions (
  topic TEXT NOT NULL,
  agent TEXT NOT NULL REFERENCES agents(name),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
  PRIMARY KEY(topic,agent)
);
CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL REFERENCES agents(name),
  incarnation INTEGER NOT NULL CHECK(incarnation >= 0),
  message_ids_json TEXT NOT NULL CHECK(json_valid(message_ids_json)),
  session_path TEXT,
  state TEXT NOT NULL CHECK(state IN ('prepared','completed')),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
  completed_at_ms INTEGER,
  CHECK((state='prepared' AND completed_at_ms IS NULL) OR
        (state='completed' AND completed_at_ms IS NOT NULL))
);
CREATE TABLE deliveries (
  message_id TEXT NOT NULL,
  recipient TEXT NOT NULL REFERENCES agents(name),
  operation_id TEXT NOT NULL REFERENCES operations(id),
  materialized INTEGER NOT NULL DEFAULT 0 CHECK(materialized IN (0,1)),
  batch_id TEXT REFERENCES batches(id),
  presented INTEGER NOT NULL DEFAULT 0 CHECK(presented IN (0,1)),
  acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(acknowledged IN (0,1)),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
  materialized_at_ms INTEGER,
  presented_at_ms INTEGER,
  acknowledged_at_ms INTEGER,
  PRIMARY KEY(message_id,recipient),
  CHECK(presented=0 OR (materialized=1 AND batch_id IS NOT NULL)),
  CHECK((materialized=0 AND materialized_at_ms IS NULL) OR
        (materialized=1 AND materialized_at_ms IS NOT NULL)),
  CHECK((presented=0 AND presented_at_ms IS NULL) OR
        (presented=1 AND presented_at_ms IS NOT NULL)),
  CHECK((acknowledged=0 AND acknowledged_at_ms IS NULL) OR
        (acknowledged=1 AND acknowledged_at_ms IS NOT NULL))
);
CREATE INDEX operations_pending ON operations(state,created_at_ms,id);
CREATE INDEX operations_actor ON operations(actor,created_at_ms,id);
CREATE INDEX agents_creator ON agents(created_by);
CREATE INDEX subscriptions_agent ON subscriptions(agent);
CREATE INDEX deliveries_pending ON deliveries(recipient,presented,created_at_ms,message_id);
CREATE INDEX deliveries_operation ON deliveries(operation_id);
CREATE INDEX deliveries_batch ON deliveries(batch_id);
CREATE INDEX batches_agent ON batches(agent,state,created_at_ms,id);
-- SPIKE [S-03]: No UNIQUE prepared-batch constraint until Pi in-flight batch
-- semantics are verified. This does NOT authorize multiple concurrent batches.
PRAGMA user_version = 4;
COMMIT;
