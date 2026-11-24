import { test } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./test-database";
import { TelegramService } from "./telegram";
import { AdminService } from "./admins";

test("production moves a saved loopback bot link to the public domain", async () => {
  const { db } = await setup();
  await db
    .prepare("INSERT INTO tg_meta(key,value) VALUES('site_url',$1)")
    .run("http://127.0.0.1:3000");
  const migrated = await TelegramService.create(
    db,
    "",
    [],
    "https://intizomkalit.uz",
    async () => ({}),
    undefined,
    true,
  );
  assert.equal(
    (await migrated.connection()).siteUrl,
    "https://intizomkalit.uz",
  );
  assert.equal(
    (
      (await db
        .prepare("SELECT value FROM tg_meta WHERE key='site_url'")
        .get()) as any
    ).value,
    "https://intizomkalit.uz",
  );
  await db
    .prepare("UPDATE tg_meta SET value=$1 WHERE key='site_url'")
    .run("https://custom.example");
  const existing = await TelegramService.create(
    db,
    "",
    [],
    "https://intizomkalit.uz",
    async () => ({}),
    undefined,
    true,
  );
  assert.equal((await existing.connection()).siteUrl, "https://custom.example");
  await db.close();
});

async function setup() {
  const db = await testDatabase();

  const sent: { method: string; payload: any }[] = [];
  const bot = await TelegramService.create(
    db,
    "test-token",
    [1],
    "https://stepone.example",
    async (method, payload) => {
      sent.push({ method, payload });
      return {};
    },
  );
  let next = 1;
  const message = async (id: number, body: any) =>
    await bot.handleUpdate({
      update_id: next++,
      message: {
        message_id: next,
        chat: { type: "private", id },
        from: { id, first_name: "User " + id },
        ...body,
      },
    });
  const register = async (id: number) => {
    await message(id, { text: "/start" });
    await message(id, {
      contact: { user_id: id, phone_number: "+998901234567" },
    });
  };
  const configure = async () => {
    await bot.saveSettings({
      pdfPrice: 25000,
      physicalPrice: 120000,
      paymentDetails: "Test payment",
      deliveryInfo: "Courier included",
      support: "@help",
    });
    await register(1);
    await message(1, { text: "/pdf" });
    await message(1, {
      document: { mime_type: "application/pdf", file_id: "diary-pdf" },
    });
  };
  const order = async (id: number, kind = "pdf") => {
    await message(id, {
      text: kind === "pdf" ? "📄 PDF kundalik" : "📔 Bosma kundalik",
    });
    return (await db
      .prepare(
        "SELECT * FROM tg_orders WHERE user_id=$1 ORDER BY created DESC,id DESC LIMIT 1",
      )
      .get(id)) as any;
  };
  return { db, bot, sent, message, register, configure, order };
}
test("contact gate rejects someone else’s contact and links a real server result only after sharing own phone", async () => {
  const { db, bot, message } = await setup();
  const result = "a".repeat(24);
  await db
    .prepare("INSERT INTO results VALUES($1,$2,$3,$4,$5)")
    .run(result, new Date().toISOString(), 55, "vaqt", 1);
  await message(2, { text: "/start r_" + result });
  await message(2, { text: "📄 PDF kundalik" });
  assert.equal(
    ((await db.prepare("SELECT COUNT(*) n FROM tg_orders").get()) as any).n,
    0,
  );
  await message(2, { contact: { user_id: 3, phone_number: "+998901234567" } });
  assert.equal(((await bot.dashboard()).users[0] as any).phone, null);
  assert.equal(
    ((await db.prepare("SELECT COUNT(*) n FROM tg_claims").get()) as any).n,
    0,
  );
  await message(2, { contact: { user_id: 2, phone_number: "+998901234567" } });
  assert.equal(((await bot.dashboard()).users[0] as any).score, 55);
  await message(3, { text: "/start r_" + result });
  await message(3, { contact: { user_id: 3, phone_number: "+998909999999" } });
  assert.equal(
    (
      (await db
        .prepare("SELECT user_id FROM tg_claims WHERE result_id=$1")
        .get(result)) as any
    ).user_id,
    2,
  );
});
test("tampered score links cannot create or claim a result", async () => {
  const { db, message, register } = await setup();
  await register(2);
  await message(2, { text: "/start t_999999_vaqt" });
  await message(2, { text: "/start r_" + "b".repeat(24) });
  assert.equal(
    ((await db.prepare("SELECT COUNT(*) n FROM tg_claims").get()) as any).n,
    0,
  );
});

test("claimed results show percentage sales copy and purchase buttons immediately", async () => {
  const { db, bot, message, configure, register } = await setup();
  await configure();
  await register(2);
  for (const [index, score, icon] of [[0,44,"🔴"],[1,45,"🟡"],[2,75,"🟢"]] as const) {
    const result = String(index).repeat(24);
    await db.prepare("INSERT INTO results(id,created,score,category,version,max_score) VALUES($1,$2,$3,$4,$5,$6)")
      .run(result, new Date().toISOString(), score, "vaqt", 1, 100);
    await message(2, { text: "/start r_" + result });
    const last = await db.prepare("SELECT payload FROM tg_outbox WHERE chat_id=2 ORDER BY id DESC LIMIT 1").get();
    const payload = JSON.parse(last.payload);
    assert.ok(payload.text.includes(`${score}%`));
    assert.ok(payload.text.includes(icon));
    assert.equal(payload.parse_mode, "HTML");
    assert.deepEqual(payload.reply_markup.keyboard[0], [{ text: "📄 PDF kundalik" }, { text: "📔 Bosma kundalik" }]);
  }
  await message(2, { text: "📄 PDF kundalik" });
  assert.equal((await db.prepare("SELECT kind FROM tg_orders WHERE user_id=2").get()).kind, "pdf");
});
test("PDF delivery requires a receipt and admin approval; approval is atomic and cannot be repeated", async () => {
  const { db, bot, message, register, configure, order, sent } = await setup();
  await configure();
  await register(2);
  const o = await order(2);
  await assert.rejects(async () => await bot.review(o.id, "approve", ""));
  await message(2, { text: "paid" });
  assert.equal(
    (
      (await db
        .prepare("SELECT status FROM tg_orders WHERE id=$1")
        .get(o.id)) as any
    ).status,
    "awaiting_receipt",
  );
  await message(2, { photo: [{ file_id: "receipt" }] });
  assert.equal(
    (
      (await db
        .prepare("SELECT COUNT(*) n FROM tg_outbox WHERE method='sendDocument'")
        .get()) as any
    ).n,
    0,
  );
  await bot.review(o.id, "approve", "");
  await assert.rejects(async () => await bot.review(o.id, "approve", ""));
  assert.equal(
    (
      (await db
        .prepare("SELECT COUNT(*) n FROM tg_outbox WHERE method='sendDocument'")
        .get()) as any
    ).n,
    1,
  );
  while (await bot.deliverOne()) {}
  assert.equal(
    sent.filter(
      (s) => s.method === "sendDocument" && s.payload.document === "diary-pdf",
    ).length,
    1,
  );
  assert.equal(
    ((await bot.dashboard()).orders[0] as any).delivery_status,
    "sent",
  );
});
test("physical orders retain address, reject early shipment and send shipment details after approval", async () => {
  const { db, bot, message, register, configure, order } = await setup();
  await configure();
  await register(2);
  const o = await order(2, "physical");
  assert.equal(o.status, "address");
  await assert.rejects(async () => await bot.review(o.id, "ship", "tracking"));
  await message(2, { text: "Toshkent, Test street 10. User Two" });
  await message(2, {
    document: { mime_type: "application/pdf", file_id: "payment-pdf" },
  });
  await bot.review(o.id, "approve", "");
  await assert.rejects(async () => await bot.review(o.id, "ship", ""));
  await bot.review(o.id, "ship", "Courier: AB123");
  const saved = (await db
    .prepare("SELECT * FROM tg_orders WHERE id=$1")
    .get(o.id)) as any;
  assert.equal(saved.status, "shipped");
  assert.equal(saved.tracking, "Courier: AB123");
  assert.match(saved.address, /Toshkent/);
  await assert.rejects(async () => await bot.review(o.id, "ship", "duplicate"));
});
test("open orders can be resumed or cancelled, and rejected receipts never deliver a PDF", async () => {
  const { db, bot, message, register, configure, order } = await setup();
  await configure();
  await register(2);
  const first = await order(2);
  assert.equal((await order(2)).id, first.id);
  await message(2, { text: "/cancel" });
  assert.equal(
    (
      (await db
        .prepare("SELECT status FROM tg_orders WHERE id=$1")
        .get(first.id)) as any
    ).status,
    "cancelled",
  );
  const second = await order(2);
  assert.notEqual(second.id, first.id);
  await message(2, { photo: [{ file_id: "bad-receipt" }] });
  await bot.review(second.id, "reject", "Wrong amount");
  assert.equal(
    (
      (await db
        .prepare("SELECT COUNT(*) n FROM tg_outbox WHERE method='sendDocument'")
        .get()) as any
    ).n,
    0,
  );
});
test("only Telegram admins can upload PDF or stage a media broadcast; drafts never send until confirmed", async () => {
  const { db, bot, message, register, configure } = await setup();
  await configure();
  await register(2);
  await message(3, { text: "/start" });
  await message(2, { text: "/broadcast" });
  await message(2, { video: { file_id: "not-admin" } });
  assert.equal((await bot.dashboard()).broadcasts.length, 0);
  await message(1, { text: "/broadcast" });
  await message(1, { video: { file_id: "video" }, caption: "Announcement" });
  const draft = (await bot.dashboard()).broadcasts[0] as any;
  assert.equal(draft.status, "draft");
  assert.equal(draft.total, 0);
  assert.equal(draft.kind, "video");
  assert.equal((await bot.broadcast(draft.id)).total, 3);
  await assert.rejects(async () => await bot.broadcast(draft.id));
  assert.equal(
    (
      (await db
        .prepare("SELECT COUNT(*) n FROM tg_outbox WHERE broadcast_id=$1")
        .get(draft.id)) as any
    ).n,
    3,
  );
});
test("duplicate Telegram updates are ignored across restarts", async () => {
  const { db, bot } = await setup();
  const update = {
    update_id: 123,
    message: {
      message_id: 1,
      chat: { type: "private", id: 2 },
      from: { id: 2, first_name: "Test" },
      text: "/start",
    },
  };
  await bot.handleUpdate(update);
  const count = (
    (await db.prepare("SELECT COUNT(*) n FROM tg_outbox").get()) as any
  ).n;
  await bot.handleUpdate(update);
  await (
    await TelegramService.create(db, "", [1], "https://example.com")
  ).handleUpdate(update);
  assert.equal(
    ((await db.prepare("SELECT COUNT(*) n FROM tg_outbox").get()) as any).n,
    count,
  );
});
test("outbox retries network failures without losing queued messages", async () => {
  const { db, bot, message } = await setup();
  await message(2, { text: "/start" });
  const failing = await TelegramService.create(
    db,
    "test",
    [1],
    "https://example.com",
    async () => {
      throw Error("Network failure with sensitive details");
    },
  );
  await failing.deliverOne();
  let job = (await db
    .prepare("SELECT * FROM tg_outbox ORDER BY id LIMIT 1")
    .get()) as any;
  assert.equal(job.status, "pending");
  assert.equal(job.attempts, 1);
  assert.ok(job.next_at > Date.now());
  assert.doesNotMatch(job.error, /sensitive/);
  await db.prepare("UPDATE tg_outbox SET next_at=0").run();
  await bot.deliverOne();
  job = (await db
    .prepare("SELECT * FROM tg_outbox ORDER BY id LIMIT 1")
    .get()) as any;
  assert.equal(job.status, "sent");
});

const tokenA = "12345:" + "a".repeat(30),
  tokenB = "12345:" + "b".repeat(30);
async function connectionSetup() {
  const { db } = await setup();
  let next = 1;
  const bot = await TelegramService.create(
    db,
    tokenA,
    [1],
    "https://example.com",
    async () => ({}),
  );
  const message = async (id: number, body: any) =>
    await bot.handleUpdate({
      update_id: next++,
      message: {
        message_id: next,
        chat: { type: "private", id },
        from: { id, first_name: "User" },
        ...body,
      },
    });
  const register = async (id: number) =>
    await message(id, {
      contact: { user_id: id, phone_number: "+998901234567" },
    });
  return { db, bot, message, register };
}
test("environment token is the only credential source, including after restart", async () => {
  const { db } = await setup();
  await db
    .prepare(
      "INSERT INTO tg_meta VALUES('bot_token',$1),('pending_connection',$2),('bot_username',$3)",
    )
    .run("obsolete-encrypted-token", "obsolete-pending-token", "old_bot");
  await db
    .prepare(
      "INSERT INTO tg_users(id,name,state,created) VALUES(1,'Admin','admin:token','today')",
    )
    .run();
  const bot = await TelegramService.create(
    db,
    tokenA,
    [1],
    "https://example.com",
  );
  assert.equal((await bot.connection()).tokenConfigured, true);
  assert.equal(bot.botUsername(), "");
  assert.ok(!JSON.stringify(await bot.dashboard()).includes(tokenA));
  assert.equal(
    (
      await db
        .prepare(
          "SELECT * FROM tg_meta WHERE key IN ('bot_token','pending_connection','bot_username')",
        )
        .all()
    ).length,
    0,
  );
  assert.equal(
    ((await db.prepare("SELECT state FROM tg_users WHERE id=1").get()) as any)
      .state,
    "",
  );
  assert.equal(
    (
      await (
        await TelegramService.create(db, "", [1], "https://example.com")
      ).connection()
    ).tokenConfigured,
    false,
  );
});
test("connection updates reject all token fields and still allow site URL changes without a token", async () => {
  const { db, bot } = await connectionSetup();
  for (const token of [tokenB, "", null])
    await assert.rejects(
      bot.saveConnection({
        token,
        adminIds: [1],
        siteUrl: "https://new.example",
      }),
      /BOT_TOKEN/,
    );
  assert.equal((await bot.connection()).siteUrl, "https://example.com");
  const unconfigured = await TelegramService.create(
    db,
    "",
    [1],
    "https://example.com",
  );
  await unconfigured.saveConnection({
    adminIds: [1],
    siteUrl: "https://new.example",
  });
  assert.equal(
    (await unconfigured.connection()).siteUrl,
    "https://new.example",
  );
  assert.equal((await unconfigured.connection()).tokenConfigured, false);
  await assert.rejects(
    unconfigured.saveConnection({
      adminIds: [],
      siteUrl: "https://new.example",
    }),
  );
});
test("Telegram admin management requires an existing admin and persists removals", async () => {
  const { db, bot, message, register } = await connectionSetup();
  await register(1);
  await register(2);
  await message(2, { text: "/admin_add 2" });
  assert.deepEqual((await bot.connection()).adminIds, [1]);
  await message(1, { text: "/admin_add 2" });
  assert.deepEqual((await bot.connection()).adminIds, [1, 2]);
  await message(2, { text: "/admin_remove 1" });
  assert.deepEqual((await bot.connection()).adminIds, [2]);
  await message(1, { text: "/admin_add 1" });
  assert.deepEqual((await bot.connection()).adminIds, [2]);
  await message(2, { text: "/admin_remove 2" });
  assert.deepEqual((await bot.connection()).adminIds, [2]);
  assert.deepEqual(
    (
      await (
        await TelegramService.create(db, tokenA, [1], "https://example.com")
      ).connection()
    ).adminIds,
    [2],
  );
});
test("Telegram token command cannot enter token state or queue a rotation", async () => {
  const { db, bot, message, register } = await connectionSetup();
  await register(1);
  await message(1, { text: "/admin" });
  const help = JSON.parse(
    (
      (await db
        .prepare("SELECT payload FROM tg_outbox ORDER BY id DESC LIMIT 1")
        .get()) as any
    ).payload,
  ).text;
  assert.ok(!help.includes("/token"));
  await message(1, { text: "/token" });
  await message(1, { text: tokenB });
  assert.notEqual(
    ((await db.prepare("SELECT state FROM tg_users WHERE id=1").get()) as any)
      .state,
    "admin:token",
  );
  assert.equal(
    await db
      .prepare("SELECT * FROM tg_meta WHERE key='pending_connection'")
      .get(),
    undefined,
  );
  assert.ok(
    !JSON.stringify(await db.prepare("SELECT * FROM tg_outbox").all()).includes(
      tokenB,
    ),
  );
  assert.equal((await bot.connection()).tokenConfigured, true);
});

test("unified account permissions restrict bot commands and redact dashboard sections", async () => {
  const { db } = await setup();
  const accounts = await AdminService.create(
    db,
    "+998901234567",
    "owner-test-password",
  );
  let owner = (await accounts.list())[0];
  owner = await accounts.save(owner, { ...owner, telegramId: 1 }, owner.id);
  await accounts.save(owner, {
    name: "Orders only",
    telegramId: 2,
    active: true,
    permissions: ["bot.orders"],
  });
  const bot = await TelegramService.create(
    db,
    tokenA,
    [],
    "https://example.com",
    async () => ({}),
    {
      ids: async () => await accounts.telegramIds(),
      permissions: async (id) => await accounts.telegramPermissions(id),
      change: async (actor, target, remove) =>
        await accounts.changeTelegramAdmin(actor, target, remove),
    },
  );
  let update = 1;
  const message = async (id: number, body: any) =>
    await bot.handleUpdate({
      update_id: update++,
      message: {
        message_id: update,
        chat: { type: "private", id },
        from: { id, first_name: "Test" },
        ...body,
      },
    });
  await message(2, { contact: { user_id: 2, phone_number: "+998901234567" } });
  await message(2, { text: "/admin_add 3" });
  assert.deepEqual(await accounts.telegramPermissions(3), []);
  await message(2, { text: "/users" });
  assert.match(
    JSON.parse(
      (
        (await db
          .prepare("SELECT payload FROM tg_outbox ORDER BY id DESC LIMIT 1")
          .get()) as any
      ).payload,
    ).text,
    /ruxsat/,
  );
  await message(2, { text: "/orders" });
  assert.match(
    JSON.parse(
      (
        (await db
          .prepare("SELECT payload FROM tg_outbox ORDER BY id DESC LIMIT 1")
          .get()) as any
      ).payload,
    ).text,
    /buyurtmalar/,
  );
  await message(2, { text: "/token" });
  await message(2, { text: tokenB });
  assert.equal(
    await db
      .prepare("SELECT value FROM tg_meta WHERE key='pending_connection'")
      .get(),
    undefined,
  );
  await message(2, { text: "/pdf" });
  await message(2, {
    document: { mime_type: "application/pdf", file_id: "forbidden-pdf" },
  });
  assert.equal((await bot.settings()).pdfFileId, "");
  await message(2, { text: "/broadcast" });
  await message(2, { text: "Forbidden broadcast" });
  assert.equal((await bot.dashboard()).broadcasts.length, 0);
  assert.equal((await bot.dashboard(["bot.orders"])).users.length, 0);
  assert.deepEqual(
    (await bot.dashboard(["bot.orders"])).connection.adminIds,
    [],
  );
  assert.equal((await bot.dashboard(["bot.users"])).users.length, 1);
});

test("concurrent approvals enqueue a single PDF and duplicate concurrent updates are ignored", async () => {
  const { db, bot, message, configure, register, order } = await setup();
  await configure();
  await register(2);
  const current = await order(2);
  await message(2, { photo: [{ file_id: "receipt" }] });
  const approvals = await Promise.allSettled([
    bot.review(current.id, "approve", ""),
    bot.review(current.id, "approve", ""),
  ]);
  assert.equal(
    approvals.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) n FROM tg_outbox WHERE method='sendDocument'")
        .get()
    ).n,
    1,
  );
  const update = {
    update_id: 999,
    message: {
      message_id: 999,
      chat: { type: "private", id: 3 },
      from: { id: 3, first_name: "Test" },
      text: "/id",
    },
  };
  await Promise.all([bot.handleUpdate(update), bot.handleUpdate(update)]);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) n FROM tg_outbox WHERE chat_id=3").get())
      .n,
    1,
  );
});

const photoUpload = {
  mimetype: "image/png",
  buffer: Buffer.from("89504e470d0a1a0a00000000", "hex"),
};
const videoUpload = {
  mimetype: "video/mp4",
  buffer: Buffer.from("000000186674797069736f6d", "hex"),
};
test("web media drafts persist, target all active bot users and reuse Telegram file IDs", async () => {
  const { db, bot, message, register } = await setup();
  await register(2);
  await message(3, { text: "/start" });
  await message(4, { text: "/start" });
  await db.prepare("UPDATE tg_users SET active=0 WHERE id=4").run();
  await db.prepare("DELETE FROM tg_outbox").run();
  for (const [file, kind, method] of [
    [photoUpload, "photo", "sendPhoto"],
    [videoUpload, "video", "sendVideo"],
  ] as const) {
    const draft = await bot.createBroadcast("Announcement", file);
    assert.equal(
      (
        (await bot.dashboard()).broadcasts.find(
          (b: any) => b.id === draft.id,
        ) as any
      ).hasMedia,
      true,
    );
    assert.equal((await db.prepare("SELECT * FROM tg_outbox").all()).length, 0);
    const sent: any[] = [];
    const restarted = await TelegramService.create(
      db,
      "test",
      [1],
      "https://example.com",
      async (method, payload) => {
        sent.push({ method, payload });
        return kind === "video"
          ? { video: { file_id: "cached-video" } }
          : { photo: [{ file_id: "small" }, { file_id: "cached-photo" }] };
      },
    );
    assert.deepEqual(
      Buffer.from((await restarted.broadcastMedia(draft.id)).bytes),
      file.buffer,
    );
    assert.equal((await restarted.broadcast(draft.id)).total, 2);
    await assert.rejects(async () => await restarted.broadcast(draft.id));
    while (await restarted.deliverOne()) {}
    assert.deepEqual(
      sent.map((s) => s.payload.chat_id),
      [2, 3],
    );
    assert.ok(
      sent.every(
        (s) => s.method === method && s.payload.caption === "Announcement",
      ),
    );
    assert.ok(sent[0].payload[kind] instanceof Blob);
    assert.equal(sent[1].payload[kind], "cached-" + kind);
    assert.equal(
      (
        (await restarted.dashboard()).broadcasts.find(
          (b: any) => b.id === draft.id,
        ) as any
      ).sent,
      2,
    );
    await db.prepare("DELETE FROM tg_outbox").run();
  }
});
test("broadcast validation rejects invalid, oversized media and overlong captions without saving drafts", async () => {
  const { bot } = await setup();
  for (const file of [
    { mimetype: "image/jpeg", buffer: Buffer.from("fake") },
    { mimetype: "text/html", buffer: Buffer.from("<script>") },
    { mimetype: "video/mp4", buffer: Buffer.from("bad") },
  ])
    await assert.rejects(async () => await bot.createBroadcast("", file));
  const large = Buffer.alloc(10 * 1024 * 1024 + 1);
  photoUpload.buffer.copy(large);
  await assert.rejects(
    async () =>
      await bot.createBroadcast("", { mimetype: "image/png", buffer: large }),
    /10 MB/,
  );
  await assert.rejects(
    async () => await bot.createBroadcast("a".repeat(1025), photoUpload),
    /1024/,
  );
  await assert.rejects(async () => await bot.createBroadcast(""));
  await assert.rejects(async () => await bot.createBroadcast("a".repeat(4001)));
  assert.equal((await bot.dashboard()).broadcasts.length, 0);
  assert.ok((await bot.createBroadcast("", videoUpload)).id);
  assert.ok((await bot.createBroadcast("a".repeat(1024), photoUpload)).id);
});
test("Telegram transport uploads multipart media with captions and sends plain text as JSON", async () => {
  const { db, message } = await setup();
  await message(2, { text: "/start" });
  await db.prepare("DELETE FROM tg_outbox").run();
  const bot = await TelegramService.create(
    db,
    "test-token",
    [1],
    "https://example.com",
  );
  const original = globalThis.fetch;
  const calls: any[] = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(init);
    return new Response(
      JSON.stringify({
        ok: true,
        result: { video: { file_id: "remote-video" } },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    await bot.broadcast(
      (await bot.createBroadcast("Video caption", videoUpload)).id,
    );
    while (await bot.deliverOne()) {}
    assert.ok(calls[0].body instanceof FormData);
    assert.equal(calls[0].body.get("caption"), "Video caption");
    assert.equal(calls[0].body.get("chat_id"), "2");
    assert.equal(calls[0].body.get("video").type, "video/mp4");
    assert.equal(calls[0].headers, undefined);
    await bot.broadcast((await bot.createBroadcast("Text announcement")).id);
    while (await bot.deliverOne()) {}
    assert.equal(calls[1].headers["Content-Type"], "application/json");
    assert.equal(JSON.parse(calls[1].body).text, "Text announcement");
  } finally {
    globalThis.fetch = original;
  }
});
