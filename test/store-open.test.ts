import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { observeFile } from "./fixtures/effect-observation.js";
import { makeValidOperation } from "./fixtures/valid.js";
import { makeValidAgent } from "./fixtures/spec.js";
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";

function databaseDescriptors(root: string): string[] {
  const paths: string[] = [];
  for (const fd of readdirSync("/proc/self/fd")) {
    try {
      const path = readlinkSync(`/proc/self/fd/${fd}`);
      if (path.startsWith(`${root}/`)) paths.push(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return paths.sort();
}

function fileSnapshot(
  root: string,
): Record<string, ReturnType<typeof observeFile>> {
  return Object.fromEntries(
    readdirSync(root)
      .sort()
      .map((name) => [name, observeFile(join(root, name))]),
  );
}

for (const fixture of ["delete", "wal-closed", "wal-retained"] as const) {
  test(`V04A: unsupported ${fixture} Store refusal preserves database and sidecars`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "oma-store-refusal-"));
    const path = join(root, "runtime.sqlite");
    try {
      const setup = new DatabaseSync(path);
      setup.exec("CREATE TABLE preserved(value); PRAGMA user_version=1");
      if (fixture !== "delete") setup.exec("PRAGMA journal_mode=WAL");
      if (fixture !== "wal-retained") setup.exec("PRAGMA user_version=77");
      setup.close();
      if (fixture === "wal-retained") {
        const child = spawnSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `import {DatabaseSync} from 'node:sqlite'; const d=new DatabaseSync(${JSON.stringify(path)}); d.exec('PRAGMA user_version=77'); process.kill(process.pid,'SIGKILL');`,
          ],
          {
            encoding: "utf8",
            timeout: 5000,
            maxBuffer: 65536,
            killSignal: "SIGKILL",
          },
        );
        assert.equal(child.error, undefined);
        assert.equal(child.signal, "SIGKILL");
        assert.equal(
          readFileSync(path).readUInt32BE(60),
          1,
          "future version must be committed only in the WAL",
        );
      }
      const before = fileSnapshot(root);
      const descriptors = databaseDescriptors(root);
      let opened: Store | undefined;
      try {
        assert.throws(
          () => {
            opened = new Store(path);
          },
          (error) =>
            error instanceof StoreError && error.code === "STORE_CORRUPT",
        );
      } finally {
        opened?.close();
      }
      const after = fileSnapshot(root);
      t.diagnostic(JSON.stringify({ fixture, before, after }));
      assert.deepEqual(after, before);
      assert.deepEqual(databaseDescriptors(root), descriptors);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const alias of ["uri", "hardlink"] as const) {
  test(`V04A: ${alias} cannot bypass the physical database and WAL identity preflight`, () => {
    const root = mkdtempSync(join(tmpdir(), "oma-store-alias-"));
    const path = join(root, "runtime.sqlite");
    let opened: Store | undefined;
    try {
      new Store(path).close();
      const child = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(${JSON.stringify(path)});d.exec('PRAGMA user_version=77');process.kill(process.pid,'SIGKILL');`,
        ],
        {
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 65536,
          killSignal: "SIGKILL",
        },
      );
      assert.equal(child.error, undefined);
      assert.equal(child.signal, "SIGKILL");
      assert.equal(readFileSync(path).readUInt32BE(60), 4);
      const candidate =
        alias === "uri" ? pathToFileURL(path).href : join(root, "alias.sqlite");
      if (alias === "hardlink") linkSync(path, candidate);
      const before = fileSnapshot(root);
      try {
        assert.throws(
          () => {
            opened = new Store(candidate);
          },
          (error) =>
            error instanceof StoreError && error.code === "STORE_CORRUPT",
        );
      } finally {
        opened?.close();
        opened = undefined;
      }
      assert.deepEqual(fileSnapshot(root), before);
      assert.deepEqual(databaseDescriptors(root), []);
    } finally {
      opened?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const [fixture, existing, suffix] of [
  ["orphan WAL", false, "-wal"],
  ["orphan SHM", false, "-shm"],
  ["WAL without SHM", true, "-wal"],
  ["SHM without WAL", true, "-shm"],
  ["journal present", true, "-journal"],
] as const) {
  test(`V04A: ${fixture} is unavailable, never discarded as absent`, () => {
    const root = mkdtempSync(join(tmpdir(), "oma-store-sidecars-"));
    const path = join(root, "runtime.sqlite");
    try {
      if (existing) new Store(path).close();
      writeFileSync(path + suffix, "preserved evidence\n");
      const before = fileSnapshot(root);
      assert.throws(
        () => new Store(path),
        (error) =>
          error instanceof StoreError && error.code === "BROKER_UNAVAILABLE",
      );
      assert.deepEqual(fileSnapshot(root), before);
      assert.deepEqual(databaseDescriptors(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("V04A: an unversioned foreign schema is not a fresh OMA database", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-store-unversioned-"));
  const path = join(root, "runtime.sqlite");
  try {
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE preserved(value)");
    db.close();
    const before = fileSnapshot(root);
    assert.throws(() => new Store(path), /unversioned nonempty database/);
    assert.deepEqual(fileSnapshot(root), before);
    assert.deepEqual(databaseDescriptors(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V04A: corrupt bytes are refused without replacement or sidecar creation", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-store-corrupt-"));
  const path = join(root, "runtime.sqlite");
  try {
    writeFileSync(path, "not a sqlite database\n");
    const before = fileSnapshot(root);
    assert.throws(() => new Store(path), /not a database/);
    assert.deepEqual(fileSnapshot(root), before);
    assert.deepEqual(databaseDescriptors(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V04A: sidecar arrival during preflight prevents writer setup", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oma-store-changed-"));
  const path = join(root, "runtime.sqlite");
  new Store(path).close();
  const before = readFileSync(path);
  const prepare = DatabaseSync.prototype.prepare;
  const exec = t.mock.method(DatabaseSync.prototype, "exec", () => {
    throw new Error("writer setup reached");
  });
  t.mock.method(
    DatabaseSync.prototype,
    "prepare",
    function (this: DatabaseSync, sql: string) {
      const statement = prepare.call(this, sql);
      if (sql === "PRAGMA user_version")
        writeFileSync(path + "-wal", "new evidence\n");
      return statement;
    },
  );
  try {
    assert.throws(
      () => new Store(path),
      /identity changed during schema preflight/,
    );
    assert.equal(exec.mock.callCount(), 0);
    assert.deepEqual(readFileSync(path), before);
    assert.equal(readFileSync(path + "-wal", "utf8"), "new evidence\n");
    assert.deepEqual(databaseDescriptors(root), []);
  } finally {
    t.mock.restoreAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test("V04A: a killed rollback-journal transaction is preserved, not recovered before refusal", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-store-journal-"));
  const path = join(root, "runtime.sqlite");
  try {
    const setup = new DatabaseSync(path);
    setup.exec(
      "CREATE TABLE preserved(value); PRAGMA user_version=77; WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<64) INSERT INTO preserved SELECT zeroblob(8192) FROM n",
    );
    setup.close();
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(${JSON.stringify(path)});d.exec('PRAGMA cache_size=1; BEGIN IMMEDIATE; UPDATE preserved SET value=randomblob(8192)');process.kill(process.pid,'SIGKILL');`,
      ],
      {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 65536,
        killSignal: "SIGKILL",
      },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.signal, "SIGKILL");
    const journal = readFileSync(path + "-journal");
    assert.ok(journal.length > 512);
    assert.equal(journal.subarray(0, 8).toString("hex"), "d9d505f920a163d7");
    const before = fileSnapshot(root);
    assert.throws(
      () => new Store(path),
      /journal recovery cannot precede schema compatibility/,
    );
    assert.deepEqual(fileSnapshot(root), before);
    assert.deepEqual(databaseDescriptors(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V04B: OS read-only permissions refuse writing and retain no constructor handle", (t) => {
  assert.notEqual(
    process.getuid?.(),
    0,
    "permission oracle requires an unprivileged test process",
  );
  const root = mkdtempSync(join(tmpdir(), "oma-store-readonly-"));
  const path = join(root, "runtime.sqlite");
  new Store(path).close();
  chmodSync(path, 0o400);
  chmodSync(root, 0o500);
  const before = fileSnapshot(root);
  let store: Store | undefined;
  try {
    assert.throws(() => {
      store = new Store(path);
      store.transaction(() => 1);
    });
    store?.close();
    store = undefined;
    assert.deepEqual(fileSnapshot(root), before);
    assert.deepEqual(databaseDescriptors(root), []);
    t.diagnostic(
      "POSIX permission denial on owned files; not a read-only mount/EROFS qualification",
    );
  } finally {
    chmodSync(root, 0o700);
    chmodSync(path, 0o600);
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [state, stage] of [
  ["new", "foreign_keys"],
  ["new", "journal_mode"],
  ["new", "synchronous"],
  ["new", "busy_timeout"],
  ["new", "schema"],
  ["existing", "foreign_keys"],
  ["existing", "journal_mode"],
  ["existing", "synchronous"],
  ["existing", "busy_timeout"],
] as const) {
  test(`V04B: failed ${state} Store ${stage} setup closes its real native handle`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "oma-store-open-"));
    const path = join(root, "runtime.sqlite");
    if (state === "existing") new Store(path).close();
    const unrelated = new DatabaseSync(join(root, "unrelated.sqlite"));
    unrelated.exec("CREATE TABLE preserved(value); BEGIN IMMEDIATE");
    const baseline = databaseDescriptors(root);
    const exec = DatabaseSync.prototype.exec;
    let owned: DatabaseSync | undefined;
    let injected = false;
    const primary = new StoreError(
      "STORE_CORRUPT",
      `injected ${stage} failure`,
    );
    t.mock.method(
      DatabaseSync.prototype,
      "exec",
      function (this: DatabaseSync, sql: string) {
        owned = this;
        if (
          !injected &&
          (stage === "schema"
            ? sql.includes("CREATE TABLE agents")
            : sql.includes(`PRAGMA ${stage}`))
        ) {
          injected = true;
          // A genuine native transaction exists when schema application fails, not just a thrown callback.
          if (stage === "schema")
            exec.call(this, "BEGIN EXCLUSIVE; CREATE TABLE incomplete(value)");
          throw primary;
        }
        return exec.call(this, sql);
      },
    );
    try {
      assert.throws(
        () => new Store(path),
        (error) => error === primary,
      );
      assert.equal(
        injected,
        true,
        "test never reached the intended setup stage",
      );
      assert.ok(owned);
      assert.equal(
        owned.isOpen,
        false,
        "failed constructor retained its DatabaseSync",
      );
      assert.deepEqual(
        databaseDescriptors(root),
        baseline,
        "database or sidecar descriptor leaked",
      );
      assert.equal(
        unrelated.isTransaction,
        true,
        "Store failure disturbed a foreign transaction",
      );
      t.mock.restoreAll();
      const next = new DatabaseSync(path);
      try {
        next.exec("BEGIN EXCLUSIVE; ROLLBACK");
        assert.equal(
          next
            .prepare(
              "SELECT count(*) AS n FROM sqlite_schema WHERE name='incomplete'",
            )
            .get()!.n,
          0,
        );
      } finally {
        next.close();
      }
    } finally {
      t.mock.restoreAll();
      // Negative-control runs intentionally expose a leak; clean only the handle captured here.
      if (owned?.isOpen) owned.close();
      unrelated.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("V04B: initialization and close failures retain both causes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oma-store-close-"));
  const primary = new StoreError("STORE_CORRUPT", "initialization failed");
  const cleanup = new Error("close failed");
  let owned: DatabaseSync | undefined;
  t.mock.method(DatabaseSync.prototype, "exec", function (this: DatabaseSync) {
    owned = this;
    throw primary;
  });
  const close = t.mock.method(DatabaseSync.prototype, "close", () => {
    throw cleanup;
  });
  try {
    assert.throws(
      () => new Store(join(root, "runtime.sqlite")),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [primary, cleanup]);
        return true;
      },
    );
    assert.equal(close.mock.callCount(), 1);
  } finally {
    t.mock.restoreAll();
    if (owned?.isOpen) owned.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("V04B: failed schema application retains its rollback failure and still closes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oma-store-rollback-"));
  const primary = new StoreError("STORE_CORRUPT", "schema application failed");
  const rollback = new Error("rollback failed");
  const exec = DatabaseSync.prototype.exec;
  let owned: DatabaseSync | undefined;
  t.mock.method(
    DatabaseSync.prototype,
    "exec",
    function (this: DatabaseSync, sql: string) {
      owned = this;
      if (sql.includes("CREATE TABLE agents")) {
        exec.call(this, "BEGIN EXCLUSIVE; CREATE TABLE incomplete(value)");
        throw primary;
      }
      if (sql === "ROLLBACK") throw rollback;
      return exec.call(this, sql);
    },
  );
  try {
    assert.throws(
      () => new Store(join(root, "runtime.sqlite")),
      (error) => {
        assert.ok(error instanceof StoreError);
        assert.equal(error.code, primary.code);
        assert.ok(error.cause instanceof AggregateError);
        assert.deepEqual(error.cause.errors, [primary, rollback]);
        return true;
      },
    );
    assert.ok(owned);
    assert.equal(owned.isOpen, false);
    assert.deepEqual(databaseDescriptors(root), []);
  } finally {
    t.mock.restoreAll();
    if (owned?.isOpen) owned.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("V04B: busy writer setup closes its handle without releasing another connection's lock", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oma-store-busy-"));
  const path = join(root, "runtime.sqlite");
  new Store(path).close();
  const holder = new DatabaseSync(path);
  holder.exec("PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE");
  const exec = DatabaseSync.prototype.exec;
  let owned: DatabaseSync | undefined;
  t.mock.method(
    DatabaseSync.prototype,
    "exec",
    function (this: DatabaseSync, sql: string) {
      owned = this;
      return exec.call(this, sql);
    },
  );
  try {
    assert.throws(() => new Store(path), /locked|busy/);
    assert.ok(owned);
    assert.equal(owned.isOpen, false);
    assert.equal(holder.isTransaction, true);
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(${JSON.stringify(path)});try{assert.throws(()=>d.exec('BEGIN IMMEDIATE'),e=>(e.errcode&255)===5);console.log('blocked');}finally{d.close();}`,
      ],
      {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 65536,
        killSignal: "SIGKILL",
      },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), "blocked");
    t.diagnostic(
      `SQLite defers native FD closure while another same-process connection holds a POSIX lock: ${databaseDescriptors(root).length} descriptors`,
    );
    t.mock.restoreAll();
    holder.close();
    assert.deepEqual(
      databaseDescriptors(root),
      [],
      "all deferred descriptors close with the last lock owner",
    );
  } finally {
    t.mock.restoreAll();
    if (holder.isOpen) holder.close();
    if (owned?.isOpen) owned.close();
    rmSync(root, { recursive: true, force: true });
  }
});

for (const state of ["new", "existing"] as const)
  test(`V04B: ${state} reader composition failure closes the actual Store connection`, () => {
    const root = mkdtempSync(join(tmpdir(), "oma-store-reader-"));
    try {
      if (state === "existing") new Store(join(root, "runtime.sqlite")).close();
      const script = `
      import assert from 'node:assert/strict';
      import {mock} from 'node:test';
      import {DatabaseSync} from 'node:sqlite';
      import {readdirSync,readlinkSync} from 'node:fs';
      const primary=new Error('reader composition failed');
      mock.module(${JSON.stringify(new URL(import.meta.resolve("@oma/storage/ledger-reader"), import.meta.url).href)}, {namedExports:{LedgerReader:class{constructor(){throw primary;}}}});
      const {Store}=await import(${JSON.stringify(new URL(import.meta.resolve("@oma/storage"), import.meta.url).href)});
      const exec=DatabaseSync.prototype.exec; let owned;
      mock.method(DatabaseSync.prototype,'exec',function(sql){owned=this;return exec.call(this,sql);});
      assert.throws(()=>new Store(${JSON.stringify(join(root, "runtime.sqlite"))}),e=>e===primary);
      assert.equal(owned.isOpen,false);
      const descriptors=readdirSync('/proc/self/fd').flatMap(fd=>{try{return [readlinkSync('/proc/self/fd/'+fd)];}catch(e){if(e.code==='ENOENT')return [];throw e;}}).filter(path=>path.startsWith(${JSON.stringify(root + "/")}));
      assert.deepEqual(descriptors,[]);
      console.log(JSON.stringify({closed:!owned.isOpen,descriptors}));
    `;
      const child = spawnSync(
        process.execPath,
        [
          "--experimental-test-module-mocks",
          "--input-type=module",
          "-e",
          script,
        ],
        {
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 65536,
          killSignal: "SIGKILL",
        },
      );
      assert.equal(child.error, undefined);
      assert.equal(child.signal, null);
      assert.equal(child.status, 0, child.stderr);
      assert.deepEqual(JSON.parse(child.stdout), {
        closed: true,
        descriptors: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

for (const mode of ["delete", "retained-wal"] as const) {
  test(`V04A: supported current schema ${mode} retains its committed operation`, () => {
    const root = mkdtempSync(join(tmpdir(), "oma-store-supported-"));
    const path = join(root, "runtime.sqlite");
    const operation = makeValidOperation({
      stateRoot: root,
      requestKey: "wp04-committed",
    });
    let store: Store | undefined;
    try {
      store = new Store(path);
      store.transaction(() => store!.insertAgent(makeValidAgent("alice")));
      assert.equal(store.getAgent("alice")?.name, "alice");
      if (mode === "delete")
        store.transaction(() => store!.insertOperation(operation));
      store.close();
      store = undefined;
      if (mode === "delete") {
        const db = new DatabaseSync(path);
        db.exec("PRAGMA journal_mode=DELETE");
        db.close();
      } else {
        const main = observeFile(path);
        const child = spawnSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `import {Store} from ${JSON.stringify(new URL(import.meta.resolve("@oma/storage"), import.meta.url).href)};const d=new Store(${JSON.stringify(path)});d.transaction(()=>d.insertOperation(${JSON.stringify(operation)}));process.kill(process.pid,'SIGKILL');`,
          ],
          {
            encoding: "utf8",
            timeout: 5000,
            maxBuffer: 65536,
            killSignal: "SIGKILL",
          },
        );
        assert.equal(child.error, undefined);
        assert.equal(child.signal, "SIGKILL");
        assert.deepEqual(
          observeFile(path),
          main,
          "the new operation is not checkpointed in the main database",
        );
        assert.ok(observeFile(path + "-wal").bytes > 32);
      }
      store = new Store(path);
      const row = store.getOperationById(operation.id);
      assert.equal(row?.id, operation.id);
      assert.equal(row?.actor, "alice");
      assert.equal(row?.requestKey, "wp04-committed");
      assert.equal(row?.state, "pending");
      assert.equal(
        row?.planJson,
        '{"version":2,"intent":{"kind":"route.follow","topic":"dev","agent":"alice"}}',
      );
    } finally {
      store?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("V04B: fresh and supported Store ownership still transfers to the caller", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-store-supported-"));
  try {
    const path = join(root, "runtime.sqlite");
    for (let attempt = 0; attempt < 2; attempt++) {
      const store = new Store(path);
      try {
        assert.deepEqual(store.listAgents(), []);
        assert.equal(
          store.transaction(() => 7),
          7,
        );
      } finally {
        store.close();
      }
      assert.deepEqual(databaseDescriptors(root), []);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
