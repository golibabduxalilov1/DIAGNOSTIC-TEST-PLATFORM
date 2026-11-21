// Optional local PostgreSQL cluster. Never changes an existing system service.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  api = path.join(root, "api");
const bin =
  process.env.PG_BIN ||
  (process.platform === "win32" ? "C:/Program Files/PostgreSQL/18/bin" : "");
const executable = (name) => (bin ? path.join(bin, name) : name);
const data = path.join(api, "data", "postgres"),
  log = path.join(api, "data", "postgres.log");
function run(name, args) {
  const result = spawnSync(executable(name), args, {
    windowsHide: true,
    stdio: name === "pg_ctl" ? "ignore" : "pipe",
    encoding: "utf8",
  });
  if (result.error)
    throw Error(
      `${name} topilmadi. PostgreSQL o‘rnating yoki PG_BIN ni belgilang.`,
    );
  if (result.status !== 0)
    throw Error(result.stderr || result.stdout || `${name} failed`);
}
(async () => {
  if (process.argv[2] === "stop") {
    run("pg_ctl", ["-D", data, "-w", "stop"]);
    console.log("Mahalliy PostgreSQL to‘xtatildi.");
    return;
  }
  const envFile = path.join(api, ".env");
  if (!fs.existsSync(envFile)) throw Error("Avval npm run setup bajaring.");
  let content = fs.readFileSync(envFile, "utf8");
  const parsed = require(path.join(api, "node_modules", "dotenv")).parse(
    content,
  );
  let url = parsed.DATABASE_URL;
  if (!url && fs.existsSync(path.join(data, "PG_VERSION")))
    throw Error("Mavjud klaster uchun api/.env ichidagi DATABASE_URLni tiklang.");
  if (url) {
    const target = new URL(url);
    if (
      target.hostname !== "127.0.0.1" ||
      target.port !== "5433" ||
      target.username !== "stepone" ||
      target.pathname !== "/stepone"
    )
      throw Error(
        "DATABASE_URL tashqi bazaga yo‘naltirilgan. O‘zingiz sozlagan PostgreSQL xizmatidan foydalaning.",
      );
  }
  if (!fs.existsSync(path.join(data, "PG_VERSION"))) {
    const probe = require("node:net").createServer();
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(5433, "127.0.0.1", resolve);
    });
    await new Promise((resolve) => probe.close(resolve));
    const password = randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(data), { recursive: true });
    const pw = path.join(api, "data", ".pg-init-password");
    try {
      fs.writeFileSync(pw, password, { mode: 0o600 });
      run("initdb", [
        "-D",
        data,
        "-U",
        "stepone",
        "--auth=scram-sha-256",
        "--pwfile=" + pw,
        "--encoding=UTF8",
        "--locale=C",
      ]);
    } finally {
      fs.rmSync(pw, { force: true });
    }
    url = `postgresql://stepone:${password}@127.0.0.1:5433/stepone`;
    content = content.replace(/^DATABASE_URL=.*\r?\n?/m, "");
    fs.writeFileSync(
      envFile,
      content.trimEnd() + "\nDATABASE_URL=" + url + "\n",
      { mode: 0o600 },
    );
  }
  const status = spawnSync(executable("pg_ctl"), ["-D", data, "status"], {
    windowsHide: true,
    stdio: "ignore",
  });
  if (status.status !== 0)
    run("pg_ctl", [
      "-D",
      data,
      "-l",
      log,
      "-o",
      "-p 5433 -h 127.0.0.1",
      "-w",
      "start",
    ]);
  const { Client } = require(path.join(api, "node_modules", "pg"));
  const connection = new URL(url);
  connection.pathname = "/postgres";
  const client = new Client({ connectionString: connection.toString() });
  await client.connect();
  try {
    if (
      !(await client.query("SELECT 1 FROM pg_database WHERE datname='stepone'"))
        .rowCount
    )
      await client.query("CREATE DATABASE stepone");
  } finally {
    await client.end();
  }
  console.log(
    "Mahalliy PostgreSQL tayyor: 127.0.0.1:5433, baza stepone. Ulanish api/.env da.",
  );
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
