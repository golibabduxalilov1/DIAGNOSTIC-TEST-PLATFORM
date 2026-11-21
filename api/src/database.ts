import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, PoolClient, PoolConfig, types } from "pg";

// Telegram IDs, millisecond timestamps and COUNT values must keep the API's
// numeric shape. Refuse integers which JavaScript cannot represent exactly.
types.setTypeParser(20, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw Error("PostgreSQL integer exceeds JavaScript safe range");
  return n;
});

export class Database {
  private readonly pool: Pool;
  private readonly context = new AsyncLocalStorage<PoolClient>();
  private closing?: Promise<void>;
  constructor(options: PoolConfig = {}) {
    if (
      !options.connectionString &&
      !process.env.DATABASE_URL &&
      !process.env.PGHOST
    )
      throw Error("DATABASE_URL PostgreSQL ulanish manzili kerak.");
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 10000,
      ...options,
    });
    this.pool.on("error", () =>
      console.error("PostgreSQL pool connection error"),
    );
  }
  async query(sql: string, params: unknown[] = []) {
    return (this.context.getStore() || this.pool).query(sql, params);
  }
  async exec(sql: string) {
    await this.query(sql);
  }
  prepare(sql: string) {
    return {
      get: async (...params: unknown[]) =>
        (await this.query(sql, params)).rows[0],
      all: async (...params: unknown[]) => (await this.query(sql, params)).rows,
      run: async (...params: unknown[]) => ({
        changes: (await this.query(sql, params)).rowCount || 0,
      }),
    };
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return fn();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.context.run(client, fn);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async migrate() {
    await this.transaction(async () => {
      await this.query("SELECT pg_advisory_xact_lock(71002001)");
      await this.exec(
        "CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
      );
      const dir = resolve(__dirname, "../migrations");
      for (const file of readdirSync(dir)
        .filter((f) => /^\d+.*\.sql$/.test(f))
        .sort()) {
        if (
          await this.prepare(
            "SELECT version FROM schema_migrations WHERE version=$1",
          ).get(file)
        )
          continue;
        await this.exec(readFileSync(resolve(dir, file), "utf8"));
        await this.prepare(
          "INSERT INTO schema_migrations(version) VALUES($1)",
        ).run(file);
      }
    });
  }
  async close() {
    await (this.closing ??= this.pool.end());
  }
}
