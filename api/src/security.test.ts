import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpException } from "@nestjs/common";
import { InputError, clientError, RateLimiter, limitAccount, readLimitedFile } from "./security";
import { testDatabase } from "./test-database";

test("untrusted internal errors are redacted while business and authorization errors retain status", () => {
  assert.throws(() => clientError(new Error("password=secret; SELECT * FROM users")),
    (error: HttpException) => error.getStatus() === 500 && !JSON.stringify(error.getResponse()).includes("secret"));
  assert.throws(() => clientError(new InputError("Invalid file")),
    (error: HttpException) => error.getStatus() === 400 && JSON.stringify(error.getResponse()).includes("Invalid file"));
  assert.throws(() => clientError(new HttpException("denied", 403)),
    (error: HttpException) => error.getStatus() === 403);
});

test("rate limits expire without evicting active limits and fail closed at capacity", () => {
  const limiter = new RateLimiter(2);
  assert.equal(limiter.consume("one", 1, 100, 0), true);
  assert.equal(limiter.consume("one", 1, 100, 1), false);
  assert.equal(limiter.consume("two", 1, 100, 2), true);
  assert.equal(limiter.consume("three", 1, 100, 3), false);
  assert.equal(limiter.consume("one", 1, 100, 100), true);
  assert.equal(limiter.consume("three", 1, 100, 102), true);
});

test("account limits are atomic across concurrent attempts and persist independently of IP", async () => {
  const db = await testDatabase();
  const attempts = await Promise.allSettled(Array.from({ length: 25 }, () => limitAccount(db, "998901234567")));
  assert.equal(attempts.filter(a => a.status === "fulfilled").length, 20);
  await assert.rejects(() => limitAccount(db, "998901234567"), (e: HttpException) => e.getStatus() === 429);
  await limitAccount(db, "998909876543");
  const rows = await db.prepare("SELECT * FROM login_limits").all();
  assert.equal(rows.length, 2);
  assert.ok(!JSON.stringify(rows).includes("998901234567"));
  await db.prepare("UPDATE login_limits SET expires=$1").run(Date.now() - 1);
  await limitAccount(db, "998901234567");
});

test("receipt downloads inspect bytes and reject spoofed, oversized and failed responses", async () => {
  const pdf = await readLimitedFile(new Response("%PDF-1.7 safe", { headers: { "Content-Type": "text/html" } }));
  assert.equal(pdf.mime, "application/pdf");
  await assert.rejects(() => readLimitedFile(new Response("<script>alert(1)</script>", { headers: { "Content-Type": "image/png" } })));
  await assert.rejects(() => readLimitedFile(new Response("%PDF-xx", { headers: { "Content-Length": "1000" } }), 10));
  await assert.rejects(() => readLimitedFile(new Response("%PDF-" + "x".repeat(100)), 10));
  await assert.rejects(() => readLimitedFile(new Response("not found", { status: 404 })));
});
