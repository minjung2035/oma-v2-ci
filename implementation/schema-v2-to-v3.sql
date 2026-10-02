-- DR27 / Priority 0: foreign_keys is disabled by the sole Store owner before
-- BEGIN; rowid, accepted JSON, results and every dependent row remain unchanged.
BEGIN EXCLUSIVE;
CREATE TABLE operations_v3 (
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
-- Explicit rowid copy also preserves gaps in historical acceptance order.
INSERT INTO operations_v3(rowid,id,actor,request_key,request_hash,kind,payload_json,plan_json,state,result_json,error_code,created_at_ms,updated_at_ms)
 SELECT rowid,id,actor,request_key,request_hash,kind,payload_json,plan_json,state,result_json,error_code,created_at_ms,updated_at_ms FROM operations ORDER BY rowid;
DROP TABLE operations;
ALTER TABLE operations_v3 RENAME TO operations;
CREATE INDEX operations_pending ON operations(state,created_at_ms,id);
CREATE INDEX operations_actor ON operations(actor,created_at_ms,id);
PRAGMA user_version = 3;
-- Store checks foreign_key_check before COMMIT.
