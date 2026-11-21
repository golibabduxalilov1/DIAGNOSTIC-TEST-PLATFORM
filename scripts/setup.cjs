const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const root = resolve(__dirname, "..");
if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error("Node.js 24 yoki yangiroq versiya kerak.");
  process.exit(1);
}
for (const dir of ["api", "web"]) {
  const target = resolve(root, dir, ".env");
  if (!existsSync(target)) {
    let content = readFileSync(resolve(root, dir, ".env.example"), "utf8");
    if (dir === "api")
      content = content
        .replace(
          "replace-with-a-long-random-password",
          randomBytes(18).toString("base64url"),
        )
        .replace(
          "replace-with-at-least-32-random-characters",
          randomBytes(48).toString("hex"),
        )
        .replaceAll(
          "replace-with-database-password",
          randomBytes(32).toString("hex"),
        );
    writeFileSync(target, content, { flag: "wx", mode: 0o600 });
    console.log(`${dir}/.env yaratildi.`);
  } else console.log(`${dir}/.env mavjud, saqlandi.`);
  if (!process.argv.includes("--skip-install")) {
    if (!process.env.npm_execpath)
      throw Error("npm run setup orqali ishga tushiring.");
    const result = spawnSync(
      process.execPath,
      [process.env.npm_execpath, "ci"],
      {
        cwd: resolve(root, dir),
        stdio: "inherit",
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log(
  "Bog‘liqliklar tayyor. PostgreSQL: npm run db:start. Keyin npm run dev. Admin telefon/paroli: api/.env",
);
