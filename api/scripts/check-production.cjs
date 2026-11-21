const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createTestDatabase } = require("./test-db.cjs");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const { randomBytes } = require("node:crypto");
const { createServer } = require("node:net");

(async () => {
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const testDatabase = await createTestDatabase();
  const password = randomBytes(18).toString("hex"),
    origin = "https://intizomkalit.uz";
  const server = spawn(process.execPath, ["dist/main.js"], {
    cwd: resolve(__dirname, ".."),
    env: {
      ...process.env,
      ...testDatabase.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      ADMIN_PHONE: "+998901234567",
      ADMIN_PASSWORD: password,
      SESSION_SECRET: randomBytes(48).toString("hex"),
      BOT_TOKEN: "",
      TELEGRAM_ADMIN_IDS: "",
      APP_ORIGIN: origin,
      PUBLIC_SITE_URL: origin,
      TRUST_PROXY_HOPS: "1",
    },
    stdio: "ignore",
  });
  const exited = new Promise((r) => server.once("exit", r));
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, "Production API did not start");
    const health = await fetch(base + "/health");
    assert.equal(health.headers.get("x-powered-by"), null);
    assert.equal(health.headers.get("x-frame-options"), "DENY");
    assert.equal(health.headers.get("x-content-type-options"), "nosniff");
    assert.equal(health.headers.get("cache-control"), "no-store");
    assert.match(health.headers.get("content-security-policy"), /sandbox/);
    assert.equal((await fetch(base + "/quiz", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
    for (const path of ["/admin/me", "/admin/config", "/admin/accounts", "/admin/results", "/admin/summary", "/admin/telegram", "/admin/telegram/orders/fake/receipt", "/admin/telegram/broadcasts/fake/media"])
      assert.equal((await fetch(base + path)).status, 401, path);
    const login = (otherOrigin) =>
      fetch(base + "/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: otherOrigin },
        body: JSON.stringify({ phone: "+998 (90) 123 45 67", password }),
      });
    assert.equal((await login("http://127.0.0.1:3000")).status, 403);
    assert.equal((await login("https://www.intizomkalit.uz")).status, 403);
    assert.equal((await fetch(base + "/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
    const post = (body, headers = {}) => fetch(base + "/submit", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body,
    });
    for (const malformed of ["null", "[]", '{"version":', '"string"'])
      assert.equal((await post(malformed)).status, 400);
    const oversized = await post(JSON.stringify({ extra: "x".repeat(260 * 1024) }));
    assert.equal(oversized.status, 413);
    assert.equal(oversized.headers.get("x-content-type-options"), "nosniff");
    const response = await login(origin);
    assert.equal(response.status, 201);
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /; Secure/i);
    assert.match(cookie, /; HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.equal((await response.json()).admin.owner, true);
    for (let i = 1; i <= 7; i++) {
      const attempt = await fetch(base + "/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          "X-Forwarded-For": `192.0.2.${i}`,
        },
        body: JSON.stringify({
          phone: "+998901234567",
          password: "incorrect-test-password",
        }),
      });
      assert.equal(
        attempt.status,
        401,
        "Proxy client IPs must have separate login limits",
      );
    }
    const session = cookie.split(";")[0];
    const dashboard = await fetch(base + "/admin/telegram", {
      headers: { Cookie: session },
    });
    assert.equal(dashboard.status, 200);
    assert.equal((await dashboard.json()).connection.siteUrl, origin);
    assert.equal((await fetch(base + "/admin/me", { headers: { Cookie: "session=forged" } })).status, 401);
    assert.equal((await fetch(base + "/admin/config", { method: "PUT", headers: { "Content-Type": "application/json", Cookie: session, Origin: "https://attacker.invalid" }, body: "{}" })).status, 403);
    const config = await (await fetch(base + "/admin/config", { headers: { Cookie: session } })).json();
    const extraField = await fetch(base + "/admin/config", { method: "PUT", headers: { "Content-Type": "application/json", Cookie: session, Origin: origin }, body: JSON.stringify({ ...config, privateToken: "must-not-be-stored" }) });
    assert.equal(extraField.status, 400);
    for (let i = 0; i < 21; i++) {
      const attempt = await fetch(base + "/admin/login", {
        method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "X-Forwarded-For": `198.51.100.${i + 1}` },
        body: JSON.stringify({ phone: i % 2 ? "+998 (91) 111 22 33" : "+998911112233", password: "incorrect-password" }),
      });
      assert.equal(attempt.status, i < 20 ? 401 : 429, "Rotating IPs must not bypass account limits");
    }
    for (let i = 0; i < 7; i++) {
      const attempt = await fetch(base + "/admin/login", {
        method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "X-Forwarded-For": "203.0.113.55" },
        body: JSON.stringify({ phone: `+99890000000${i}`, password: "incorrect-password" }),
      });
      assert.equal(attempt.status, i < 6 ? 401 : 429, "Login IP limit");
    }
    assert.equal((await fetch(base + "/admin/me")).status, 401);
    const logout = await fetch(base + "/admin/logout", {
      method: "POST",
      headers: { Origin: origin, Cookie: session },
    });
    assert.equal(logout.status, 201);
    assert.equal(
      (await fetch(base + "/admin/me", { headers: { Cookie: session } }))
        .status,
      401,
    );
    console.log(
      "Production security checks passed: headers, private routes, CSRF, malformed/oversized bodies, strict config, Secure cookie, IP/account limits, and logout.",
    );
  } finally {
    server.kill();
    await exited;
    await testDatabase.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
