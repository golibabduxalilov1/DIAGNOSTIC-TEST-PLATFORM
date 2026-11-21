// SQLite is used only by this one-time, read-only migration utility.
import { DatabaseSync } from "node:sqlite";
import { config } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Database } from "./database";

export const importTables = [
  "config",
  "results",
  "admins",
  "admin_sessions",
  "admin_meta",
  "tg_meta",
  "tg_users",
  "tg_claims",
  "tg_orders",
  "tg_broadcasts",
  "tg_broadcast_media",
  "tg_outbox",
] as const;
export async function importSqlite(db: Database, filename: string) {
  if (!existsSync(filename)) throw Error("SQLite manba fayli topilmadi.");
  const source = new DatabaseSync(filename, { readOnly: true });
  try {
    source.exec("BEGIN");
    await db.migrate();
    return await db.transaction(async () => {
      await db.exec(
        "LOCK TABLE " + importTables.join(",") + " IN ACCESS EXCLUSIVE MODE",
      );
      for (const table of importTables)
        if ((await db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get()).n)
          throw Error("PostgreSQL bazasi bo‘sh bo‘lishi kerak: " + table);
      const counts: Record<string, number> = {};
      for (const table of importTables) {
        if (
          !source
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(table)
        ) {
          counts[table] = 0;
          continue;
        }
        const columns = source
          .prepare(`PRAGMA table_info("${table}")`)
          .all()
          .map((c) => String(c.name));
        const sql = `INSERT INTO "${table}" (${columns.map((c) => '"' + c + '"').join(",")}) VALUES (${columns.map((_, i) => "$" + (i + 1)).join(",")})`;
        counts[table] = 0;
        for (const row of source
          .prepare(`SELECT * FROM "${table}"`)
          .iterate()) {
          if (
            table === "tg_meta" &&
            ["bot_token", "pending_connection", "bot_username"].includes(
              String(row.key),
            )
          )
            continue;
          if (table === "tg_users" && row.state === "admin:token")
            row.state = "";
          await db
            .prepare(sql)
            .run(
              ...columns.map((c) =>
                row[c] instanceof Uint8Array
                  ? Buffer.from(row[c] as Uint8Array)
                  : row[c],
              ),
            );
          counts[table]++;
        }
        if (
          (await db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get()).n !==
          counts[table]
        )
          throw Error("Import soni mos kelmadi: " + table);
      }
      await db.exec(
        "SELECT setval(pg_get_serial_sequence('tg_outbox','id'),COALESCE((SELECT MAX(id) FROM tg_outbox),1),EXISTS(SELECT 1 FROM tg_outbox))",
      );
      return counts;
    });
  } finally {
    source.close();
  }
}
async function main() {
  config({ path: resolve(__dirname, "../.env"), quiet: true });
  const filename = process.argv[2];
  if (!filename)
    throw Error(
      "SQLite fayl manzilini kiriting: npm run db:import -- data/stepone.sqlite",
    );
  const db = new Database();
  try {
    console.log(await importSqlite(db, resolve(filename)));
  } finally {
    await db.close();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error("Import bajarilmadi:", error.message);
    process.exitCode = 1;
  });
