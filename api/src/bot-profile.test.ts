import { test } from "node:test";
import assert from "node:assert/strict";
import { TelegramService } from "./telegram";
import type { Database } from "./database";

test("profile reads Telegram values and updates only the requested field", async () => {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const bot = new TelegramService({} as Database, "test-token", [], "https://example.com", async (method, payload) => {
    calls.push({ method, payload });
    return { name: "Bot", description: "Welcome", short_description: "About" };
  });
  assert.deepEqual(await bot.profile(), { name: "Bot", description: "Welcome", shortDescription: "About" });
  for (const [field, method, parameter] of [
    ["name", "setMyName", "name"],
    ["description", "setMyDescription", "description"],
    ["shortDescription", "setMyShortDescription", "short_description"],
  ]) {
    await bot.saveProfile({ field, value: " Updated " });
    assert.deepEqual(calls.at(-1), { method, payload: { [parameter]: "Updated" } });
  }
  await bot.saveProfile({ field: "description", value: "" });
  const count = calls.length;
  for (const input of [null, { field: "__proto__", value: "x" }, { field: "token", value: "x" }, { field: "name", value: " " }, { field: "name", value: "x".repeat(65) }, { field: "description", value: "x".repeat(513) }, { field: "shortDescription", value: "x".repeat(121) }])
    await assert.rejects(() => bot.saveProfile(input));
  assert.equal(calls.length, count);
});

test("profile photo uploads use Telegram multipart attachment syntax", async (t) => {
  const jpeg = Buffer.from([255, 216, 255, 224]);
  const requests: { url: string; body: any }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    requests.push({ url, body: options.body });
    return new Response(JSON.stringify({ ok: true, result: true }));
  });
  const bot = new TelegramService({} as Database, "test-token", [], "https://example.com");
  await bot.setProfilePhoto({ buffer: jpeg, mimetype: "image/jpeg" });
  assert.ok(requests[0].url.endsWith("/setMyProfilePhoto"));
  const form = requests[0].body as FormData;
  assert.ok(form instanceof FormData);
  assert.deepEqual(JSON.parse(String(form.get("photo"))), { type: "static", photo: "attach://profile_photo" });
  assert.deepEqual(Buffer.from(await (form.get("profile_photo") as Blob).arrayBuffer()), jpeg);
  for (const file of [undefined, { buffer: jpeg, mimetype: "image/png" }, { buffer: Buffer.from("invalid"), mimetype: "image/jpeg" }, { buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 255), mimetype: "image/jpeg" }])
    await assert.rejects(() => bot.setProfilePhoto(file));
  assert.equal(requests.length, 1);
  await bot.removeProfilePhoto();
  assert.ok(requests[1].url.endsWith("/removeMyProfilePhoto"));
});

test("unconfigured bots reject profile operations before contacting Telegram", async () => {
  const bot = new TelegramService({} as Database, "", [], "https://example.com", async () => { throw Error("Unexpected transport call"); });
  for (const action of [() => bot.profile(), () => bot.saveProfile({ field: "name", value: "Bot" }), () => bot.setProfilePhoto(), () => bot.removeProfilePhoto()])
    await assert.rejects(action, /Avval botni/);
});
