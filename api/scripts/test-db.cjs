const { Pool } = require("pg");
const { randomBytes } = require("node:crypto");
const { resolve } = require("node:path");
require("dotenv").config({ path: resolve(__dirname, "../.env"), quiet: true });
exports.createTestDatabase = async () => {
  const connectionString =
    process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString)
    throw Error("TEST_DATABASE_URL yoki DATABASE_URL kerak.");
  const schema = "http_test_" + randomBytes(12).toString("hex");
  const admin = new Pool({ connectionString });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const options = `-c search_path=${schema}`;
  const pool = new Pool({ connectionString, options });
  return {
    pool,
    env: { DATABASE_URL: connectionString, PGOPTIONS: options },
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
};
