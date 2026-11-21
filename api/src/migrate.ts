import { config } from "dotenv";
import { resolve } from "node:path";
import { Database } from "./database";

config({ path: resolve(__dirname, "../.env"), quiet: true });
async function main() {
  const db = new Database();
  try {
    await db.migrate();
    console.log("PostgreSQL migratsiyalari bajarildi.");
  } finally {
    await db.close();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      "Migratsiya bajarilmadi. DATABASE_URL va PostgreSQL huquqlarini tekshiring.",
    );
    process.exitCode = 1;
  });
