import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { testDatabase } from "./test-database";
import { importSqlite } from "./import-sqlite";

test("PostgreSQL migrations are repeatable and transactions isolate concurrent requests", async () => {
  const db = await testDatabase();
  await Promise.all([db.migrate(), db.migrate()]);
  const outcomes = await Promise.allSettled([
    db.transaction(async () => {
      await db
        .prepare("INSERT INTO tg_meta VALUES($1,$2)")
        .run("rollback", "no");
      throw Error("rollback");
    }),
    db.transaction(async () => {
      await db
        .prepare("INSERT INTO tg_meta VALUES($1,$2)")
        .run("commit", "yes");
    }),
  ]);
  assert.equal(outcomes[0].status, "rejected");
  assert.equal(outcomes[1].status, "fulfilled");
  assert.equal(
    await db.prepare("SELECT value FROM tg_meta WHERE key='rollback'").get(),
    undefined,
  );
  assert.equal(
    (await db.prepare("SELECT value FROM tg_meta WHERE key='commit'").get())
      .value,
    "yes",
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) n FROM schema_migrations").get()).n,
    3,
  );
});

test("SQLite import preserves IDs, large timestamps and binary media and resets the outbox sequence", async () => {
  const db = await testDatabase(),
    dir = mkdtempSync(join(tmpdir(), "stepone-sqlite-import-")),
    file = join(dir, "source.sqlite");
  const source = new DatabaseSync(file);
  source.exec(`CREATE TABLE config(id INTEGER PRIMARY KEY,json TEXT NOT NULL);
 CREATE TABLE tg_meta(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE tg_users(id INTEGER PRIMARY KEY,name TEXT,state TEXT,created TEXT);
 CREATE TABLE tg_broadcast_media(broadcast_id TEXT PRIMARY KEY,mime TEXT,bytes BLOB,file_id TEXT);
 CREATE TABLE tg_outbox(id INTEGER PRIMARY KEY,chat_id INTEGER,method TEXT,payload TEXT,next_at INTEGER);`);
  source.prepare("INSERT INTO config VALUES(1,?)").run('{"version":7}');
  source.exec(
    "INSERT INTO tg_meta VALUES('bot_token','obsolete'),('site_url','https://example.com');INSERT INTO tg_users VALUES(9000000001,'User','admin:token','today')",
  );
  const bytes = Buffer.from([0, 255, 1, 128]);
  source
    .prepare("INSERT INTO tg_broadcast_media VALUES(?,?,?,?)")
    .run("media", "image/png", bytes, "cached-file");
  source
    .prepare("INSERT INTO tg_outbox VALUES(42,?,?,?,?)")
    .run(9000000001, "sendMessage", "{}", Date.now());
  source.close();
  try {
    const counts = await importSqlite(db, file);
    assert.equal(counts.tg_outbox, 1);
    assert.equal(
      (await db.prepare("SELECT json FROM config").get()).json,
      '{"version":7}',
    );
    assert.equal(
      (await db.prepare("SELECT id,state FROM tg_users").get()).id,
      9000000001,
    );
    assert.equal(
      (await db.prepare("SELECT state FROM tg_users").get()).state,
      "",
    );
    assert.equal(
      await db.prepare("SELECT * FROM tg_meta WHERE key='bot_token'").get(),
      undefined,
    );
    assert.deepEqual(
      (await db.prepare("SELECT bytes FROM tg_broadcast_media").get()).bytes,
      bytes,
    );
    const next = await db.query(
      "INSERT INTO tg_outbox(chat_id,method,payload) VALUES(1,'sendMessage','{}') RETURNING id",
    );
    assert.equal(next.rows[0].id, 43);
    await assert.rejects(importSqlite(db, file), /bo‘sh/);
  } finally {
    rmSync(file);
    rmdirSync(dir);
  }
});

test("failed SQLite imports roll back every copied table", async () => {
  const db = await testDatabase(),
    dir = mkdtempSync(join(tmpdir(), "stepone-sqlite-import-")),
    file = join(dir, "source.sqlite");
  const source = new DatabaseSync(file);
  source.exec(
    `CREATE TABLE config(id INTEGER PRIMARY KEY,json TEXT);INSERT INTO config VALUES(1,'{}');CREATE TABLE results(unknown_column TEXT);INSERT INTO results VALUES('invalid');`,
  );
  source.close();
  try {
    await assert.rejects(importSqlite(db, file));
    assert.equal(
      (await db.prepare("SELECT COUNT(*) n FROM config").get()).n,
      0,
    );
  } finally {
    rmSync(file);
    rmdirSync(dir);
  }
});
