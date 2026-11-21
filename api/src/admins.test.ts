import { test } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./test-database";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AdminService,
  PERMISSIONS,
  requirePermission,
  requireConfigChange,
} from "./admins";
import { Config, validate, localizeConfig } from "./domain";
const password = "test-owner-password";
async function setup() {
  const db = await testDatabase();
  const service = await AdminService.create(db, "+998901234567", password);
  const owner = (await service.list())[0];
  return { db, service, owner };
}
const input = (permissions: string[] = []) => ({
  name: "Operator",
  phone: "+998909876543",
  password: "operator-password",
  telegramId: 12345,
  permissions,
  active: true,
});
test("accounts have separate credentials and enforce only assigned permissions", async () => {
  const { service, owner } = await setup();
  await service.save(owner, input(["bot.orders"]));
  const session = await service.login("+998909876543", "operator-password");
  assert.equal(requirePermission(session.admin, "bot.orders").name, "Operator");
  assert.throws(() => requirePermission(session.admin, "admins.manage"));
  assert.throws(() => requirePermission(session.admin, "bot.connection"));
  await assert.rejects(
    async () => await service.save(session.admin, input(["admins.manage"])),
  );
  await assert.rejects(
    async () => await service.login("+998909876543", password),
  );
  assert.ok(
    !JSON.stringify(await service.list()).includes("operator-password"),
  );
  assert.ok(!JSON.stringify(await service.list()).includes("password"));
});
test("permission revocation and account deactivation apply to existing sessions immediately", async () => {
  const { service, owner } = await setup();
  const account = await service.save(owner, input(["bot.orders", "bot.users"]));
  const session = await service.login(account.phone, "operator-password");
  await service.save(
    owner,
    { ...account, permissions: ["bot.users"] },
    account.id,
  );
  await assert.rejects(async () =>
    requirePermission(await service.authenticate(session.token), "bot.orders"),
  );
  assert.equal(
    (await service.authenticate(session.token)).permissions[0],
    "bot.users",
  );
  await service.save(owner, { ...account, active: false }, account.id);
  await assert.rejects(async () => await service.authenticate(session.token));
  await assert.rejects(
    async () => await service.login(account.phone, "operator-password"),
  );
});
test("password changes revoke existing sessions; logout invalidates the server session", async () => {
  const { service, owner } = await setup();
  const account = await service.save(owner, input(["site.results"]));
  const old = await service.login(account.phone, "operator-password");
  await service.save(
    owner,
    { ...account, password: "changed-password" },
    account.id,
  );
  await assert.rejects(async () => await service.authenticate(old.token));
  await assert.rejects(
    async () => await service.login(account.phone, "operator-password"),
  );
  const current = await service.login(account.phone, "changed-password");
  await service.logout(current.token);
  await assert.rejects(async () => await service.authenticate(current.token));
  await assert.rejects(async () => await service.authenticate("forged"));
});
test("removing web login or rotating owner credentials revokes previous sessions", async () => {
  const { db, service, owner } = await setup();
  const account = await service.save(owner, input(["bot.orders"]));
  const session = await service.login(account.phone, "operator-password");
  await service.save(owner, { ...account, phone: "" }, account.id);
  await assert.rejects(async () => await service.authenticate(session.token));
  const ownerSession = await service.login(owner.phone, password);
  await AdminService.create(db, owner.phone!, "new-owner-password");
  await assert.rejects(
    async () => await service.authenticate(ownerSession.token),
  );
});
test("owner and unique account identities are protected", async () => {
  const { service, owner } = await setup();
  await assert.rejects(
    async () =>
      await service.save(owner, { ...owner, active: false }, owner.id),
  );
  await assert.rejects(
    async () =>
      await service.save(owner, { ...owner, permissions: [] }, owner.id),
  );
  await service.save(owner, input());
  await assert.rejects(
    async () => await service.save(owner, { ...input(), name: "Duplicate" }),
  );
  await assert.rejects(
    async () =>
      await service.save(owner, {
        ...input(),
        phone: "+998900000001",
        telegramId: 12345,
      }),
  );
  await assert.rejects(
    async () =>
      await service.save(owner, { ...input(), permissions: ["unknown"] }),
  );
  await assert.rejects(
    async () => await service.save(owner, { ...input(), password: "short" }),
  );
});
test("environment owner cannot be deleted, demoted or disabled in storage", async () => {
  const { db, service, owner } = await setup();
  const session = await service.login(owner.phone, password);
  await assert.rejects(
    async () =>
      await db.prepare("DELETE FROM admins WHERE id=$1").run(owner.id),
    /Asosiy admin/,
  );
  for (const sql of [
    "UPDATE admins SET owner=0 WHERE id='owner'",
    "UPDATE admins SET active=0 WHERE id='owner'",
    "UPDATE admins SET id='other' WHERE id='owner'",
  ]) {
    await assert.rejects(async () => await db.exec(sql), /Asosiy admin/);
  }
  assert.equal((await service.authenticate(session.token)).owner, true);
  const account = await service.save(owner, input(["admins.manage"]));
  await assert.rejects(
    async () =>
      await service.save(account, { ...owner, active: false }, owner.id),
  );
  await assert.rejects(
    async () =>
      await service.save(account, { ...owner, permissions: [] }, owner.id),
  );
  await service.save(owner, { ...owner, telegramId: 100 }, owner.id);
  for (const actor of [100, account.telegramId!])
    await assert.rejects(
      async () => await service.changeTelegramAdmin(actor, 100, true),
      /Asosiy admin/,
    );
  await db.prepare("DELETE FROM admins WHERE id=$1").run(account.id);
  assert.equal((await service.list()).length, 1);
  await AdminService.create(db, "+998901234568", "rotated-owner-password");
  assert.equal(
    (await service.login("+998901234568", "rotated-owner-password")).admin
      .owner,
    true,
  );
  await assert.rejects(async () => await service.authenticate(session.token));
});

test("startup restores the environment owner protection for legacy accounts", async () => {
  const { db } = await setup();
  await db.exec("ALTER TABLE admins DISABLE TRIGGER protect_owner_update");
  await db.exec("UPDATE admins SET owner=0,active=0 WHERE id='owner'");
  await db.exec("ALTER TABLE admins ENABLE TRIGGER protect_owner_update");
  const service = await AdminService.create(db, "+998901234567", password);
  assert.equal(
    (await service.login("+998901234567", password)).admin.owner,
    true,
  );
  await assert.rejects(
    async () => await db.exec("UPDATE admins SET owner=0 WHERE id='owner'"),
    /Asosiy admin/,
  );
});

test("legacy Telegram accounts migrate once and can be restricted independently from web access", async () => {
  const { service, owner } = await setup();
  await service.migrateTelegram([101]);
  const legacy = (await service.list()).find((a) => a.telegramId === 101)!;
  assert.equal(legacy.webAccess, false);
  await service.save(
    owner,
    { ...legacy, permissions: ["bot.users"], active: false },
    legacy.id,
  );
  await service.migrateTelegram([101, 102]);
  assert.deepEqual(await service.telegramPermissions(101), []);
  assert.equal(
    (await service.list()).filter((a) => a.telegramId === 102).length,
    0,
  );
});
test("bot admin delegation requires management permission and grants a limited operator role", async () => {
  const { service, owner } = await setup();
  await service.save(owner, { ...owner, telegramId: 100 }, owner.id);
  await service.changeTelegramAdmin(100, 200, false);
  assert.deepEqual(await service.telegramPermissions(200), [
    "bot.users",
    "bot.orders",
  ]);
  await assert.rejects(
    async () => await service.changeTelegramAdmin(200, 300, false),
  );
  await assert.rejects(
    async () => await service.changeTelegramAdmin(200, 100, true),
  );
  await service.changeTelegramAdmin(100, 200, true);
  assert.deepEqual(await service.telegramPermissions(200), []);
});
test("question editors cannot change site metadata; site editors cannot change questions or scores", async () => {
  const { service, owner } = await setup();
  const questionEditor = await service.save(owner, input(["site.questions"]));
  const siteEditor = {
    ...questionEditor,
    permissions: ["site.settings"] as const,
  };
  const old = JSON.parse(
    readFileSync(resolve(__dirname, "../src/seed.json"), "utf8"),
  ) as Config;
  const q = structuredClone(old);
  q.questions[0].text = "Edited";
  assert.doesNotThrow(() => requireConfigChange(questionEditor, old, q));
  assert.throws(() =>
    requireConfigChange(
      { ...siteEditor, permissions: [...siteEditor.permissions] },
      old,
      q,
    ),
  );
  const meta = structuredClone(old);
  meta.brand = "New brand";
  assert.throws(() => requireConfigChange(questionEditor, old, meta));
  const translation = structuredClone(old);
  translation.locales!.en!.questions!["1"].text = "Changed translation";
  assert.doesNotThrow(() =>
    requireConfigChange(questionEditor, old, translation),
  );
  translation.locales!.en!.title = "Changed title";
  assert.throws(() => requireConfigChange(questionEditor, old, translation));
});
test("localized public quiz keeps IDs and scores; missing translations use original content", () => {
  const c = JSON.parse(
    readFileSync(resolve(__dirname, "../src/seed.json"), "utf8"),
  ) as Config;
  validate(c);
  const en = localizeConfig(c, "en");
  assert.notEqual(en.title, c.title);
  assert.equal(en.questions[0].id, c.questions[0].id);
  assert.equal(
    en.questions[0].options[0].score,
    c.questions[0].options[0].score,
  );
  c.locales!.en!.questions!["1"].text = "";
  assert.equal(localizeConfig(c, "en").questions[0].text, c.questions[0].text);
  assert.equal(localizeConfig(c, "xx"), c);
  c.locales!.en!.questions!["1"].options = { bad: 123 as any };
  assert.throws(() => validate(c));
});
