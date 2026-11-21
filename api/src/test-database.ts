import { afterEach } from "node:test";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { config } from "dotenv";
import { Database } from "./database";

config({ path: resolve(__dirname, "../.env"), quiet: true });
const databases: { db: Database; admin: Database; schema: string }[] = [];
export async function testDatabase() {
  const connectionString =
    process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const schema = "test_" + randomBytes(12).toString("hex");
  const admin = new Database({ connectionString });
  await admin.exec(`CREATE SCHEMA "${schema}"`);
  const db = new Database({
    connectionString,
    options: `-c search_path=${schema}`,
    max: 4,
  });
  databases.push({ db, admin, schema });
  await db.migrate();
  return db;
}
afterEach(async () => {
  for (const { db, admin, schema } of databases.splice(0)) {
    await db.close();
    await admin.exec(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.close();
  }
});
