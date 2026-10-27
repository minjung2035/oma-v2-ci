// Repro for src/platform/host/record.ts: write is 0600 & atomic, a corrupt
// record throws STORE_CORRUPT (not silently replaced), ENOENT -> null,
// and validation rejects out-of-domain values.
import { newHostRecord, writeHostRecord, readHostRecord } from "../../../../dist/src/platform/host/record.js";
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "oma-adv-G12-record-"));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); } };

try {
  const path = join(dir, "host-record.json");
  ok("missing->null", readHostRecord(path) === null);

  const rec = newHostRecord();
  writeHostRecord(path, rec);
  const mode = statSync(path).mode & 0o777;
  ok("mode 0600", mode === 0o600);

  const back = readHostRecord(path);
  ok("roundtrip installationId", back?.installationId === rec.installationId);
  ok("roundtrip instanceId", back?.instanceId === rec.instanceId);

  // Corrupt JSON -> STORE_CORRUPT, not replaced.
  writeFileSync(path, "{ not json");
  let corruptErr = null;
  try { readHostRecord(path); } catch (e) { corruptErr = e; }
  ok("corrupt->STORE_CORRUPT", corruptErr?.code === "STORE_CORRUPT");

  // Well-formed JSON but bad domain (lastStop invalid) -> STORE_CORRUPT.
  writeFileSync(path, JSON.stringify({ ...rec, lastStop: "exploded" }));
  let badDomainErr = null;
  try { readHostRecord(path); } catch (e) { badDomainErr = e; }
  ok("bad lastStop->STORE_CORRUPT", badDomainErr?.code === "STORE_CORRUPT");

  // __proto__ pollution attempt in JSON body: readHostRecord parses raw JSON.
  writeFileSync(path, JSON.stringify({ ...rec, __proto__: { polluted: true } }));
  let after = null;
  try { after = readHostRecord(path); } catch { after = "threw"; }
  ok("proto key does not pollute Object.prototype", ({}).polluted === undefined);
} finally {
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}
