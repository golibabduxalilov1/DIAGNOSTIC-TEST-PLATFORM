import { InputError } from "./security";
import { Database } from "./database";
import { randomBytes } from "node:crypto";
import { normalizePhone } from "./phone";
import { parseAdminIds, validSiteUrl } from "./bot-credentials";
import type { Permission } from "./admins";
import { BroadcastUpload, validateBroadcastMedia } from "./broadcast-media";
type AccessBridge = {
  permissions: (id: number) => Promise<Permission[]>;
  ids: () => Promise<number[]>;
  change: (actor: number, target: number, remove: boolean) => Promise<void>;
};

export type BotSettings = {
  pdfPrice: number;
  physicalPrice: number;
  paymentDetails: string;
  deliveryInfo: string;
  support: string;
  pdfFileId: string;
};
const defaults: BotSettings = {
  pdfPrice: 0,
  physicalPrice: 0,
  paymentDetails: "",
  deliveryInfo: "",
  support: "",
  pdfFileId: "",
};
type User = {
  id: number;
  name: string;
  phone: string | null;
  state: string;
  pending_result: string | null;
  active: number;
};
type Order = {
  id: string;
  user_id: number;
  kind: string;
  amount: number;
  status: string;
  address: string;
  receipt_file: string | null;
  receipt_kind: string | null;
  tracking: string;
};
type Job = {
  id: number;
  chat_id: number;
  method: string;
  payload: string;
  attempts: number;
  broadcast_id: string | null;
  order_id: string | null;
};
type Transport = (
  method: string,
  payload: Record<string, unknown>,
) => Promise<any>;
class TelegramError extends Error {
  constructor(
    public code: number,
    public retryAfter: number,
    message: string,
  ) {
    super(message);
  }
}

export class TelegramService {
  private running = false;
  private lastError = "";
  private username = "";
  private controller: AbortController | null = null;
  private tasks: Promise<void>[] = [];
  botUsername() {
    return this.username;
  }
  private transport: Transport;
  constructor(
    private db: Database,
    private token: string,
    private adminIds: number[],
    private siteUrl: string,
    private injectedTransport?: Transport,
    private access?: AccessBridge,
    replaceLocalSiteUrl = false,
  ) {
    this.transport = injectedTransport || this.request.bind(this);
  }
  static async create(...args: ConstructorParameters<typeof TelegramService>) {
    const service = new TelegramService(...args);
    await service.initialize(args[6] || false);
    return service;
  }
  private async initialize(replaceLocalSiteUrl: boolean) {
    const siteUrl = this.siteUrl;
    if ((await this.meta("admin_ids")) !== undefined)
      this.adminIds = parseAdminIds(JSON.parse(await this.meta("admin_ids")));
    this.siteUrl = (await this.meta("site_url")) || siteUrl;
    if (
      replaceLocalSiteUrl &&
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(this.siteUrl).hostname,
      )
    ) {
      this.siteUrl = validSiteUrl(siteUrl);
      await this.setMeta("site_url", this.siteUrl);
    }
    await this.db
      .prepare(
        "DELETE FROM tg_meta WHERE key IN ('bot_token','pending_connection','bot_username')",
      )
      .run();
    await this.db
      .prepare("UPDATE tg_users SET state='' WHERE state='admin:token'")
      .run();
  }
  private async meta(key: string) {
    return (
      (await this.db
        .prepare("SELECT value FROM tg_meta WHERE key=$1")
        .get(key)) as any
    )?.value;
  }
  private async setMeta(key: string, value: string) {
    await this.db
      .prepare(
        "INSERT INTO tg_meta VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
  private async ids() {
    return this.access ? this.access.ids() : this.adminIds;
  }
  private async can(id: number, permission: Permission) {
    return this.access
      ? (await this.access.permissions(id)).includes(permission)
      : this.adminIds.includes(id);
  }
  private async isAdmin(id: number) {
    return this.access
      ? (await this.access.permissions(id)).some(
          (p) => p.startsWith("bot.") || p === "admins.manage",
        )
      : this.adminIds.includes(id);
  }
  async connection() {
    return {
      adminIds: [...(await this.ids())],
      siteUrl: this.siteUrl,
      tokenConfigured: !!this.token,
    };
  }
  async saveConnection(input: any) {
    if (input && Object.prototype.hasOwnProperty.call(input, "token"))
      throw new InputError(
        "Bot tokeni faqat api/.env faylidagi BOT_TOKEN orqali sozlanadi.",
      );
    const admins = parseAdminIds(input?.adminIds),
      siteUrl = validSiteUrl(input?.siteUrl);
    if (!admins.length && (await this.ids()).length)
      throw new InputError(
        "Oxirgi Telegram adminni olib tashlab bo‘lmaydi. Kamida bitta ID qoldiring.",
      );
    await this.atomic(async () => {
      await this.setMeta("admin_ids", JSON.stringify(admins));
      await this.setMeta("site_url", siteUrl);
    });
    this.adminIds = admins;
    this.siteUrl = siteUrl;
    return await this.connection();
  }
  private async changeAdmin(actor: number, target: unknown, remove: boolean) {
    if (this.access) {
      const [id] = parseAdminIds([target]);
      await this.access.change(actor, id, remove);
      return id;
    }
    if (!this.adminIds.includes(actor))
      throw new InputError("Bu amal faqat mavjud adminlar uchun.");
    const [id] = parseAdminIds([target]);
    const updated = remove
      ? this.adminIds.filter((n) => n !== id)
      : parseAdminIds([...this.adminIds, id]);
    if (!updated.length) throw new InputError("Oxirgi adminni olib tashlab bo‘lmaydi.");
    await this.setMeta("admin_ids", JSON.stringify(updated));
    this.adminIds = updated;
    return id;
  }
  async settings(): Promise<BotSettings> {
    return {
      ...defaults,
      ...JSON.parse((await this.meta("settings")) || "{}"),
    };
  }
  async saveSettings(input: any) {
    if (
      !input ||
      !["pdfPrice", "physicalPrice"].every(
        (k) =>
          Number.isSafeInteger(input[k]) && input[k] >= 0 && input[k] <= 1e9,
      ) ||
      !["paymentDetails", "deliveryInfo", "support"].every(
        (k) => typeof input[k] === "string" && input[k].length <= 1500,
      )
    )
      throw new InputError("Narxlar va bot sozlamalarini tekshiring.");
    const settings = {
      ...(await this.settings()),
      pdfPrice: input.pdfPrice,
      physicalPrice: input.physicalPrice,
      paymentDetails: input.paymentDetails.trim(),
      deliveryInfo: input.deliveryInfo.trim(),
      support: input.support.trim(),
    };
    await this.setMeta("settings", JSON.stringify(settings));
    return settings;
  }
  private async atomic<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }
  private async queue(
    chatId: number,
    method: string,
    payload: Record<string, unknown>,
    broadcastId: string | null = null,
    orderId: string | null = null,
  ) {
    await this.db
      .prepare(
        "INSERT INTO tg_outbox(chat_id,method,payload,broadcast_id,order_id) VALUES($1,$2,$3,$4,$5)",
      )
      .run(
        chatId,
        method,
        JSON.stringify({ ...payload, chat_id: chatId }),
        broadcastId,
        orderId,
      );
  }
  private async say(id: number, text: string, reply_markup?: unknown) {
    await this.queue(id, "sendMessage", {
      text,
      ...(reply_markup ? { reply_markup } : {}),
    });
  }
  private async menu(id: number, text = "Bo‘limni tanlang:") {
    await this.say(id, text, {
      keyboard: [
        [{ text: "📊 Natijam" }, { text: "📝 Test topshirish" }],
        [{ text: "📄 PDF kundalik" }, { text: "📔 Bosma kundalik" }],
        [{ text: "📦 Buyurtmalarim" }, { text: "💬 Yordam" }],
        ...((await this.isAdmin(id))
          ? [[{ text: "⚙️ Admin boshqaruvi" }]]
          : []),
      ],
      resize_keyboard: true,
    });
  }
  private async requirePhone(id: number) {
    await this.say(
      id,
      "Davom etish uchun pastdagi tugma orqali o‘zingizning telefon raqamingizni ulashing. Raqamingiz, test balingiz va buyurtmalaringiz administratorga ko‘rinadi.",
      {
        keyboard: [
          [{ text: "📱 Telefon raqamni ulashish", request_contact: true }],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    );
  }
  private async state(id: number, value: string) {
    await this.db
      .prepare("UPDATE tg_users SET state=$1 WHERE id=$2")
      .run(value, id);
  }
  private async claim(user: User) {
    if (!user.pending_result) return;
    const id = user.pending_result;
    const result = (await this.db
      .prepare("SELECT * FROM results WHERE id=$1")
      .get(id)) as any;
    const owner = (await this.db
      .prepare("SELECT user_id FROM tg_claims WHERE result_id=$1")
      .get(id)) as any;
    if (!result || (owner && owner.user_id !== user.id))
      await this.say(
        user.id,
        "Natija topilmadi yoki boshqa foydalanuvchiga biriktirilgan. Testni qayta topshiring.",
      );
    else {
      await this.db
        .prepare("INSERT INTO tg_claims VALUES($1,$2) ON CONFLICT DO NOTHING")
        .run(id, user.id);
      await this.say(
        user.id,
        `Test natijangiz: ${result.score} ball.\nYo‘nalish: ${result.category}`,
      );
    }
    await this.db
      .prepare("UPDATE tg_users SET pending_result=NULL WHERE id=$1")
      .run(user.id);
  }
  async handleUpdate(update: any) {
    if (!Number.isSafeInteger(update?.update_id)) return;
    await this.atomic(async () => {
      await this.db.query("SELECT pg_advisory_xact_lock(71002002)");
      if (update.update_id <= Number((await this.meta("offset")) || 0) - 1)
        return;
      const m = update.message;
      if (
        m?.chat?.type === "private" &&
        m.from &&
        !m.from.is_bot &&
        Number.isSafeInteger(m.from.id)
      )
        await this.message(m);
      await this.setMeta("offset", String(update.update_id + 1));
    });
  }
  private async message(m: any) {
    const id = m.from.id;
    const text = typeof m.text === "string" ? m.text.trim() : "";
    await this.db
      .prepare(
        "INSERT INTO tg_users(id,name,username,created) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,username=excluded.username,active=1",
      )
      .run(
        id,
        [m.from.first_name, m.from.last_name].filter(Boolean).join(" "),
        m.from.username || "",
        new Date().toISOString(),
      );
    const user = (await this.db
      .prepare("SELECT * FROM tg_users WHERE id=$1")
      .get(id)) as unknown as User;
    if (text === "/id") {
      await this.say(id, `Telegram ID: ${id}`);
      return;
    }
    if (text.startsWith("/start")) {
      const payload = text.split(/\s+/)[1] || "";
      await this.state(id, "");
      if (/^r_[a-f0-9]{24}$/.test(payload)) {
        user.pending_result = payload.slice(2);
        await this.db
          .prepare("UPDATE tg_users SET pending_result=$1 WHERE id=$2")
          .run(user.pending_result, id);
      }
      if (!user.phone) {
        await this.requirePhone(id);
        return;
      }
      await this.claim(user);
      await this.menu(id, "Xush kelibsiz! Bo‘limni tanlang:");
      return;
    }
    if (m.contact) {
      const phone = normalizePhone(m.contact.phone_number);
      if (m.contact.user_id !== id || !phone) {
        await this.say(
          id,
          "Faqat o‘zingizning raqamingizni tugma orqali ulashing.",
        );
        await this.requirePhone(id);
        return;
      }
      await this.db
        .prepare("UPDATE tg_users SET phone=$1 WHERE id=$2")
        .run("+" + phone, id);
      await this.claim(user);
      await this.menu(id, "Telefon raqamingiz saqlandi.");
      return;
    }
    if (!user.phone) {
      await this.requirePhone(id);
      return;
    }
    if (text === "/cancel" || text === "🏠 Menyu") {
      if (
        text === "/cancel" &&
        (user.state.startsWith("address:") || user.state.startsWith("receipt:"))
      )
        await this.db
          .prepare(
            "UPDATE tg_orders SET status='cancelled' WHERE user_id=$1 AND id=$2 AND status IN ('address','awaiting_receipt')",
          )
          .run(id, user.state.split(":")[1]);
      await this.state(id, "");
      await this.menu(
        id,
        text === "/cancel"
          ? "Jarayon bekor qilindi. Bo‘limni tanlang:"
          : undefined,
      );
      return;
    }
    if (await this.isAdmin(id)) {
      if (
        text === "/admin" ||
        text === "/admins" ||
        text === "⚙️ Admin boshqaruvi"
      ) {
        await this.state(id, "");
        const commands = ["/id — o‘z IDingiz", "/cancel — bekor qilish"];
        if (await this.can(id, "admins.manage"))
          commands.unshift(
            `Telegram adminlar: ${(await this.ids()).join(", ")}`,
            "/admin_add ID — cheklangan operator qo‘shish",
            "/admin_remove ID — Telegram kirishini olib tashlash",
          );
        if (await this.can(id, "bot.settings"))
          commands.push("/pdf — PDF yuklash");
        if (await this.can(id, "bot.broadcasts"))
          commands.push("/broadcast — xabar qoralamasi");
        if (await this.can(id, "bot.users"))
          commands.push("/users — oxirgi mijozlar va ballar");
        if (await this.can(id, "bot.orders"))
          commands.push("/orders — buyurtmalar va cheklar");
        await this.say(id, commands.join("\n"));
        return;
      }
      if (text === "/users") {
        if (!(await this.can(id, "bot.users"))) {
          await this.say(id, "Bu bo‘lim uchun ruxsat yo‘q.");
          return;
        }
        const users = (await this.db
          .prepare(
            "SELECT u.name,u.phone,(SELECT r.score FROM results r JOIN tg_claims c ON c.result_id=r.id WHERE c.user_id=u.id ORDER BY r.created DESC LIMIT 1) score FROM tg_users u ORDER BY u.created DESC LIMIT 10",
          )
          .all()) as any[];
        await this.say(
          id,
          users.length
            ? users
                .map(
                  (u) =>
                    `${u.name.slice(0, 60)} · ${u.phone || "Telefon ulashmagan"} · ${u.score ?? "—"} ball`,
                )
                .join("\n")
            : "Hozircha mijozlar yo‘q.",
        );
        return;
      }
      if (text === "/orders") {
        if (!(await this.can(id, "bot.orders"))) {
          await this.say(id, "Bu bo‘lim uchun ruxsat yo‘q.");
          return;
        }
        const orders = (await this.db
          .prepare(
            "SELECT o.*,u.name,u.phone FROM tg_orders o JOIN tg_users u ON u.id=o.user_id ORDER BY CASE WHEN o.status='pending' THEN 0 ELSE 1 END,o.created DESC LIMIT 10",
          )
          .all()) as any[];
        await this.say(
          id,
          orders.length
            ? orders
                .map(
                  (o) =>
                    `#${o.id} · ${o.kind === "pdf" ? "PDF" : "Bosma"} · ${o.amount} so‘m\n${o.name.slice(0, 60)} · ${o.phone || "—"} · ${o.status}`,
                )
                .join("\n\n")
            : "Hozircha buyurtmalar yo‘q.",
        );
        return;
      }
      if (/^\/admin_(add|remove)(?:\s|$)/.test(text)) {
        const [command, target, ...extra] = text.split(/\s+/);
        try {
          if (extra.length || !target)
            throw new InputError(
              "Masalan: /admin_add 123456789 yoki /admin_remove 123456789",
            );
          const changed = await this.changeAdmin(
            id,
            target,
            command === "/admin_remove",
          );
          await this.say(
            id,
            `${changed} ${command === "/admin_remove" ? "adminlikdan olindi" : "admin sifatida qo‘shildi"}.`,
          );
        } catch (e) {
          await this.say(id, e instanceof InputError ? e.message : "So‘rov bajarilmadi. Keyinroq qayta urining.");
        }
        return;
      }
      if (text === "/pdf") {
        if (!(await this.can(id, "bot.settings"))) {
          await this.say(id, "Bu bo‘lim uchun ruxsat yo‘q.");
          return;
        }
        await this.state(id, "admin:pdf");
        await this.say(
          id,
          "Kundalik PDF faylini document sifatida yuboring. Bekor qilish: /cancel",
        );
        return;
      }
      if (text === "/broadcast") {
        if (!(await this.can(id, "bot.broadcasts"))) {
          await this.say(id, "Bu bo‘lim uchun ruxsat yo‘q.");
          return;
        }
        await this.state(id, "admin:broadcast");
        await this.say(
          id,
          "Tarqatish uchun bitta matn, post, rasm yoki video yuboring. Admin panelda ko‘rib tasdiqlaganingizdan keyin hammaga yuboriladi. Bekor qilish: /cancel",
        );
        return;
      }
      if (user.state === "admin:pdf") {
        if (!(await this.can(id, "bot.settings"))) {
          await this.state(id, "");
          return;
        }
        if (!m.document || m.document.mime_type !== "application/pdf") {
          await this.say(id, "PDF fayl yuboring yoki /cancel bosing.");
          return;
        }
        await this.setMeta(
          "settings",
          JSON.stringify({
            ...(await this.settings()),
            pdfFileId: m.document.file_id,
          }),
        );
        await this.state(id, "");
        await this.menu(
          id,
          "PDF kundalik saqlandi. Tasdiqlangan yangi PDF buyurtmalariga shu fayl yuboriladi.",
        );
        return;
      }
      if (user.state === "admin:broadcast") {
        if (!(await this.can(id, "bot.broadcasts"))) {
          await this.state(id, "");
          return;
        }
        if (
          !(m.text || m.video || m.photo || m.document) ||
          m.has_protected_content
        ) {
          await this.say(
            id,
            "Oddiy matn, rasm yoki video yuboring. Himoyalangan postni ko‘chirib bo‘lmaydi.",
          );
          return;
        }
        const bid = randomBytes(12).toString("hex");
        await this.db
          .prepare(
            "INSERT INTO tg_broadcasts(id,text,source_chat,source_message,kind,created) VALUES($1,$2,$3,$4,$5,$6)",
          )
          .run(
            bid,
            (m.text || m.caption || "").slice(0, 4000),
            id,
            m.message_id,
            m.video
              ? "video"
              : m.photo
                ? "photo"
                : m.document
                  ? "document"
                  : "text",
            new Date().toISOString(),
          );
        await this.state(id, "");
        await this.menu(
          id,
          "Xabar qoralama sifatida saqlandi. Admin panel → Telegram → Xabarlar bo‘limida tasdiqlang.",
        );
        return;
      }
    }
    if (text === "📊 Natijam") {
      const rows = (await this.db
        .prepare(
          "SELECT r.* FROM results r JOIN tg_claims c ON c.result_id=r.id WHERE c.user_id=$1 ORDER BY r.created DESC LIMIT 5",
        )
        .all(id)) as any[];
      await this.say(
        id,
        rows.length
          ? rows
              .map(
                (r) =>
                  `${new Date(r.created).toLocaleDateString("uz-UZ", { timeZone: "Asia/Tashkent" })}: ${r.score} ball — ${r.category}`,
              )
              .join("\n")
          : "Hali natija yo‘q. Saytda testni tugatib, “Natijani Telegram’da olish” tugmasini bosing.",
      );
      return;
    }
    if (text === "📝 Test topshirish") {
      await this.say(
        id,
        `Testni shu manzilda topshiring: ${this.siteUrl}\nYakunida “Natijani Telegram’da olish” tugmasini bosing.`,
      );
      return;
    }
    if (text === "💬 Yordam") {
      await this.say(
        id,
        (await this.settings()).support || "Yordam ma’lumoti hali sozlanmagan.",
      );
      return;
    }
    if (text === "📦 Buyurtmalarim") {
      const orders = (await this.db
        .prepare(
          "SELECT * FROM tg_orders WHERE user_id=$1 ORDER BY created DESC LIMIT 10",
        )
        .all(id)) as any[];
      const labels: Record<string, string> = {
        address: "Manzil kutilmoqda",
        awaiting_receipt: "Chek kutilmoqda",
        pending: "Tekshirilmoqda",
        approved: "Tasdiqlangan",
        rejected: "Rad etilgan",
        shipped: "Jo‘natilgan",
        cancelled: "Bekor qilingan",
      };
      await this.say(
        id,
        orders.length
          ? orders
              .map(
                (o) =>
                  `#${o.id} · ${o.kind === "pdf" ? "PDF" : "Bosma"} · ${o.amount.toLocaleString("uz-UZ")} so‘m\n${labels[o.status] || o.status}${o.tracking ? "\nYetkazish: " + o.tracking : ""}`,
              )
              .join("\n\n")
          : "Hali buyurtma yo‘q.",
      );
      return;
    }
    if (text === "📄 PDF kundalik" || text === "📔 Bosma kundalik") {
      await this.newOrder(
        user,
        text === "📄 PDF kundalik" ? "pdf" : "physical",
      );
      return;
    }
    if (user.state.startsWith("address:")) {
      const oid = user.state.slice(8);
      if (text.length < 10 || text.length > 1000) {
        await this.say(
          id,
          "Ism-familiya va to‘liq yetkazish manzilini matn bilan kiriting (10–1000 belgi).",
        );
        return;
      }
      await this.db
        .prepare(
          "UPDATE tg_orders SET address=$1,status='awaiting_receipt' WHERE id=$2 AND user_id=$3 AND status='address'",
        )
        .run(text, oid, id);
      await this.state(id, "receipt:" + oid);
      await this.payment(id, oid);
      return;
    }
    if (user.state.startsWith("receipt:")) {
      const oid = user.state.slice(8);
      const photo = m.photo?.at(-1);
      const doc = m.document;
      if (
        !photo &&
        !(
          doc &&
          ["application/pdf", "image/jpeg", "image/png"].includes(doc.mime_type)
        )
      ) {
        await this.say(
          id,
          "To‘lov chekini rasm yoki PDF sifatida yuboring. Bekor qilish: /cancel",
        );
        return;
      }
      const changed = await this.db
        .prepare(
          "UPDATE tg_orders SET receipt_file=$1,receipt_kind=$2,status='pending' WHERE id=$3 AND user_id=$4 AND status='awaiting_receipt'",
        )
        .run(
          photo?.file_id || doc.file_id,
          photo ? "photo" : "document",
          oid,
          id,
        );
      await this.state(id, "");
      if (changed.changes) {
        await this.menu(
          id,
          "Chek qabul qilindi. Administrator tekshirib tasdiqlagach sizga xabar beramiz.",
        );
        for (const admin of await this.ids()) {
          if (!(await this.can(admin, "bot.orders"))) continue;
          await this.say(
            admin,
            `Yangi to‘lov cheki: #${oid}\n${user.name} · ${user.phone}\nAdmin paneldan tekshiring.`,
          );
          await this.queue(admin, "copyMessage", {
            from_chat_id: id,
            message_id: m.message_id,
          });
        }
      }
      return;
    }
    await this.menu(id);
  }
  private async newOrder(user: User, kind: "pdf" | "physical") {
    const s = await this.settings();
    const amount = kind === "pdf" ? s.pdfPrice : s.physicalPrice;
    if (!amount || !s.paymentDetails || (kind === "pdf" && !s.pdfFileId)) {
      await this.say(
        user.id,
        "Bu mahsulot hozircha sotuvga tayyor emas. Keyinroq urinib ko‘ring.",
      );
      return;
    }
    const open = (await this.db
      .prepare(
        "SELECT * FROM tg_orders WHERE user_id=$1 AND status IN ('address','awaiting_receipt','pending') ORDER BY created DESC LIMIT 1",
      )
      .get(user.id)) as any;
    if (open) {
      if (open.status === "pending") {
        await this.say(
          user.id,
          `#${open.id} buyurtmangiz tekshirilmoqda. Natijani kuting.`,
        );
        return;
      }
      await this.state(
        user.id,
        (open.status === "address" ? "address:" : "receipt:") + open.id,
      );
      if (open.status === "address")
        await this.say(
          user.id,
          "Avval ochilgan buyurtma uchun ism-familiya, viloyat, tuman va to‘liq manzilni yuboring.",
        );
      else await this.payment(user.id, open.id);
      return;
    }
    const id = randomBytes(5).toString("hex");
    await this.db
      .prepare(
        "INSERT INTO tg_orders(id,user_id,kind,amount,status,created) VALUES($1,$2,$3,$4,$5,$6)",
      )
      .run(
        id,
        user.id,
        kind,
        amount,
        kind === "physical" ? "address" : "awaiting_receipt",
        new Date().toISOString(),
      );
    await this.state(
      user.id,
      (kind === "physical" ? "address:" : "receipt:") + id,
    );
    if (kind === "physical")
      await this.say(
        user.id,
        `Bosma kundalik: ${amount.toLocaleString("uz-UZ")} so‘m.\n${s.deliveryInfo}\n\nIsm-familiya, viloyat, tuman va to‘liq yetkazish manzilini yuboring.\nBekor qilish: /cancel`,
      );
    else await this.payment(user.id, id);
  }
  private async payment(userId: number, id: string) {
    const o = (await this.db
      .prepare("SELECT * FROM tg_orders WHERE id=$1 FOR UPDATE")
      .get(id)) as any;
    await this.say(
      userId,
      `Buyurtma #${id}\n${o.kind === "pdf" ? "PDF" : "Bosma"} kundalik: ${o.amount.toLocaleString("uz-UZ")} so‘m\n\n${(await this.settings()).paymentDetails}\n\nTo‘lovdan keyin chekni rasm yoki PDF sifatida shu yerga yuboring. Chek administrator tomonidan tekshiriladi.\nBekor qilish: /cancel`,
    );
  }
  async review(id: string, action: string, note: string) {
    return await this.atomic(async () => {
      const o = (await this.db
        .prepare("SELECT * FROM tg_orders WHERE id=$1 FOR UPDATE")
        .get(id)) as unknown as Order | undefined;
      if (!o) throw new InputError("Buyurtma topilmadi.");
      if (!["approve", "reject", "ship", "cancel"].includes(action))
        throw new InputError("Amal noto‘g‘ri.");
      if (action === "cancel") {
        if (!["address", "awaiting_receipt"].includes(o.status))
          throw new InputError("Faqat to‘lovsiz ochiq buyurtmani bekor qilish mumkin.");
        await this.db
          .prepare("UPDATE tg_orders SET status='cancelled' WHERE id=$1")
          .run(id);
        await this.db
          .prepare(
            "UPDATE tg_users SET state='' WHERE id=$1 AND state IN ($2,$3)",
          )
          .run(o.user_id, "address:" + id, "receipt:" + id);
        await this.say(o.user_id, `#${id} buyurtma bekor qilindi.`);
        return { ok: true };
      }
      if (action === "ship") {
        if (o.status !== "approved" || o.kind !== "physical" || !note.trim())
          throw new InputError(
            "Faqat tasdiqlangan bosma buyurtma uchun yetkazish ma’lumotini kiriting.",
          );
        await this.db
          .prepare(
            "UPDATE tg_orders SET status='shipped',tracking=$1 WHERE id=$2",
          )
          .run(note, id);
        await this.say(o.user_id, `#${id} kundaligingiz jo‘natildi.\n${note}`);
        return { ok: true };
      }
      if (o.status !== "pending" || !o.receipt_file)
        throw new InputError("Buyurtma tekshiruvda emas.");
      if (
        action === "approve" &&
        o.kind === "pdf" &&
        !(await this.settings()).pdfFileId
      )
        throw new InputError("Avval PDF faylini botga /pdf orqali yuklang.");
      await this.db
        .prepare("UPDATE tg_orders SET status=$1,reviewed=$2 WHERE id=$3")
        .run(
          action === "approve" ? "approved" : "rejected",
          new Date().toISOString(),
          id,
        );
      if (action === "reject") {
        await this.say(
          o.user_id,
          `#${id} to‘lov cheki tasdiqlanmadi.\n${note || "Iltimos, yordam bo‘limi orqali bog‘laning yoki yangi buyurtma bering."}`,
        );
      } else if (o.kind === "pdf")
        await this.queue(
          o.user_id,
          "sendDocument",
          {
            document: (await this.settings()).pdfFileId,
            caption: `#${id} to‘lov tasdiqlandi. PDF kundaligingiz!`,
          },
          null,
          id,
        );
      else
        await this.say(
          o.user_id,
          `#${id} to‘lov tasdiqlandi. Bosma kundaligingiz tayyorlanadi. Jo‘natilganda xabar beramiz.`,
        );
      return { ok: true };
    });
  }
  async createBroadcast(text: string, file?: BroadcastUpload) {
    const kind = file ? validateBroadcastMedia(file) : "text",
      limit = file ? 1024 : 4000;
    if (
      typeof text !== "string" ||
      (!file && !text.trim()) ||
      text.length > limit
    )
      throw new InputError(
        file
          ? "Media izohi 1024 belgidan oshmasin."
          : "Xabar 1–4000 belgi bo‘lsin.",
      );
    const id = randomBytes(12).toString("hex");
    return await this.atomic(async () => {
      await this.db
        .prepare(
          "INSERT INTO tg_broadcasts(id,text,kind,created) VALUES($1,$2,$3,$4)",
        )
        .run(id, text.trim(), kind, new Date().toISOString());
      if (file)
        await this.db
          .prepare(
            "INSERT INTO tg_broadcast_media(broadcast_id,mime,bytes) VALUES($1,$2,$3)",
          )
          .run(id, file.mimetype, file.buffer);
      return { id };
    });
  }
  async broadcastMedia(id: string) {
    const file = (await this.db
      .prepare(
        "SELECT mime,bytes FROM tg_broadcast_media WHERE broadcast_id=$1",
      )
      .get(id)) as { mime: string; bytes: Uint8Array } | undefined;
    if (!file) throw new InputError("Media topilmadi.");
    return file;
  }
  async broadcast(id: string) {
    if (!this.token) throw new InputError("Bot tokeni sozlanmagan.");
    return await this.atomic(async () => {
      const b = (await this.db
        .prepare("SELECT * FROM tg_broadcasts WHERE id=$1 FOR UPDATE")
        .get(id)) as any;
      if (!b || b.status !== "draft")
        throw new InputError("Xabar qoralama emas yoki allaqachon yuborilgan.");
      const users = (await this.db
        .prepare("SELECT id FROM tg_users WHERE active=1")
        .all()) as any[];
      if (!users.length) throw new InputError("Hozircha faol foydalanuvchi yo‘q.");
      const media = !!(await this.db
        .prepare(
          "SELECT broadcast_id FROM tg_broadcast_media WHERE broadcast_id=$1",
        )
        .get(id));
      for (const u of users)
        await this.queue(
          u.id,
          b.source_chat
            ? "copyMessage"
            : media
              ? b.kind === "video"
                ? "sendVideo"
                : "sendPhoto"
              : "sendMessage",
          b.source_chat
            ? { from_chat_id: b.source_chat, message_id: b.source_message }
            : media
              ? {
                  caption: b.text,
                  ...(b.kind === "video" ? { supports_streaming: true } : {}),
                }
              : { text: b.text },
          id,
        );
      await this.db
        .prepare("UPDATE tg_broadcasts SET status='queued' WHERE id=$1")
        .run(id);
      return { total: users.length };
    });
  }
  async dashboard(permissions?: Permission[]) {
    const data = {
      status: {
        configured: !!this.token,
        running: this.running,
        username: this.username,
        adminCount: (await this.ids()).length,
        lastError: this.lastError,
      },
      connection: await this.connection(),
      settings: await this.settings(),
      users: await this.db
        .prepare(
          "SELECT u.id,u.name,u.username,u.phone,u.active,u.created,(SELECT r.score FROM results r JOIN tg_claims c ON c.result_id=r.id WHERE c.user_id=u.id ORDER BY r.created DESC LIMIT 1) score,(SELECT r.category FROM results r JOIN tg_claims c ON c.result_id=r.id WHERE c.user_id=u.id ORDER BY r.created DESC LIMIT 1) category FROM tg_users u ORDER BY u.created DESC LIMIT 300",
        )
        .all(),
      orders: await this.db
        .prepare(
          "SELECT o.*,u.name,u.phone,(SELECT status FROM tg_outbox q WHERE q.order_id=o.id ORDER BY q.id DESC LIMIT 1) delivery_status FROM tg_orders o JOIN tg_users u ON u.id=o.user_id ORDER BY o.created DESC LIMIT 300",
        )
        .all(),
      broadcasts: await this.db
        .prepare(
          "SELECT b.*,EXISTS(SELECT 1 FROM tg_broadcast_media m WHERE m.broadcast_id=b.id) \"hasMedia\",(SELECT COUNT(*) FROM tg_outbox q WHERE q.broadcast_id=b.id) total,(SELECT COUNT(*) FROM tg_outbox q WHERE q.broadcast_id=b.id AND q.status='sent') sent,(SELECT COUNT(*) FROM tg_outbox q WHERE q.broadcast_id=b.id AND q.status='failed') failed FROM tg_broadcasts b ORDER BY b.created DESC LIMIT 50",
        )
        .all(),
      jobs: await this.db
        .prepare(
          "SELECT id,chat_id,method,status,attempts,error,order_id FROM tg_outbox WHERE status='failed' ORDER BY id DESC LIMIT 50",
        )
        .all(),
      totals: {
        users: (
          (await this.db
            .prepare("SELECT COUNT(*) n FROM tg_users")
            .get()) as any
        ).n,
        orders: (
          (await this.db
            .prepare("SELECT COUNT(*) n FROM tg_orders")
            .get()) as any
        ).n,
      },
    };
    if (!permissions) return data;
    const can = (p: Permission) => permissions.includes(p);
    return {
      ...data,
      connection: can("bot.connection")
        ? data.connection
        : {
            adminIds: [],
            siteUrl: "",
            tokenConfigured: data.status.configured,
          },
      settings: can("bot.settings") ? data.settings : { ...defaults },
      users: can("bot.users") ? data.users : [],
      orders: can("bot.orders") ? data.orders : [],
      broadcasts: can("bot.broadcasts") ? data.broadcasts : [],
      jobs: (
        await Promise.all(
          data.jobs.map(async (j) => ({
            job: j,
            allowed: can(await this.jobPermission(Number(j.id))),
          })),
        )
      )
        .filter((j) => j.allowed)
        .map((j) => j.job),
      totals: {
        users: can("bot.users") ? data.totals.users : 0,
        orders: can("bot.orders") ? data.totals.orders : 0,
      },
    };
  }
  async jobPermission(id: number): Promise<Permission> {
    const job = (await this.db
      .prepare("SELECT broadcast_id,order_id FROM tg_outbox WHERE id=$1")
      .get(id)) as any;
    return job?.broadcast_id
      ? "bot.broadcasts"
      : job?.order_id
        ? "bot.orders"
        : "bot.connection";
  }
  async retryJob(id: number) {
    const changed = await this.db
      .prepare(
        "UPDATE tg_outbox SET status='pending',attempts=0,next_at=0,error='' WHERE id=$1 AND status='failed'",
      )
      .run(id);
    if (!changed.changes) throw new InputError("Qayta yuboriladigan xabar topilmadi.");
    return { ok: true };
  }
  async receipt(id: string) {
    const order = (await this.db
      .prepare("SELECT receipt_file FROM tg_orders WHERE id=$1")
      .get(id)) as any;
    if (!order?.receipt_file) throw new InputError("Chek topilmadi.");
    const file = await this.transport("getFile", {
      file_id: order.receipt_file,
    });
    if (!file.file_path) throw new InputError("Fayl hozircha mavjud emas.");
    return fetch(
      `https://api.telegram.org/file/bot${this.token}/${file.file_path}`,
      { signal: AbortSignal.timeout(30000), redirect: "error" },
    );
  }
  private async request(method: string, payload: Record<string, unknown>) {
    return this.requestWithToken(
      this.token,
      method,
      payload,
      this.controller?.signal,
    );
  }
  private async requestWithToken(
    token: string,
    method: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    if (this.injectedTransport) return this.injectedTransport(method, payload);
    const multipart = Object.values(payload).some((v) => v instanceof Blob);
    const timeout = AbortSignal.timeout(
      multipart ? 120000 : method === "getUpdates" ? 40000 : 30000,
    );
    const form = new FormData();
    if (multipart)
      for (const [key, value] of Object.entries(payload)) {
        if (value instanceof Blob)
          form.append(
            key,
            value,
            key === "video"
              ? "video.mp4"
              : value.type === "image/png"
                ? "photo.png"
                : "photo.jpg",
          );
        else
          form.append(
            key,
            typeof value === "object" ? JSON.stringify(value) : String(value),
          );
      }
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        ...(multipart
          ? { body: form }
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    );
    const data = (await response.json()) as any;
    if (!data.ok)
      throw new TelegramError(
        data.error_code || response.status,
        data.parameters?.retry_after || 0,
        String(data.description || "Telegram so‘rovi bajarilmadi.")
          .split(token)
          .join("[token]"),
      );
    return data.result;
  }
  async deliverOne() {
    const job = (await this.db
      .prepare(
        "SELECT * FROM tg_outbox WHERE status='pending' AND next_at<=$1 ORDER BY CASE WHEN method='deleteMessage' THEN 0 ELSE 1 END,id LIMIT 1",
      )
      .get(Date.now())) as unknown as Job | undefined;
    if (!job) return false;
    try {
      const payload = JSON.parse(job.payload),
        field =
          job.method === "sendVideo"
            ? "video"
            : job.method === "sendPhoto"
              ? "photo"
              : null;
      const media =
        field && job.broadcast_id
          ? ((await this.db
              .prepare(
                "SELECT mime,bytes,file_id FROM tg_broadcast_media WHERE broadcast_id=$1",
              )
              .get(job.broadcast_id)) as any)
          : null;
      if (media && field)
        payload[field] =
          media.file_id ||
          new Blob([new Uint8Array(media.bytes)], { type: media.mime });
      const result = await this.transport(job.method, payload);
      const fileId =
        field === "video"
          ? result?.video?.file_id
          : field === "photo"
            ? result?.photo?.at(-1)?.file_id
            : null;
      await this.atomic(async () => {
        if (media && fileId)
          await this.db
            .prepare(
              "UPDATE tg_broadcast_media SET file_id=$1 WHERE broadcast_id=$2",
            )
            .run(fileId, job.broadcast_id);
        await this.db
          .prepare("UPDATE tg_outbox SET status='sent',error='' WHERE id=$1")
          .run(job.id);
      });
    } catch (e) {
      const err = e as TelegramError;
      const attempts = job.attempts + 1;
      const permanent = err.code === 400 || err.code === 403 || attempts >= 6;
      await this.db
        .prepare(
          "UPDATE tg_outbox SET status=$1,attempts=$2,next_at=$3,error=$4 WHERE id=$5",
        )
        .run(
          permanent ? "failed" : "pending",
          attempts,
          Date.now() +
            Math.max(
              err.retryAfter * 1000 || 0,
              Math.min(300000, 1000 * 2 ** attempts),
            ),
          err instanceof TelegramError
            ? err.message
            : "Telegram bilan ulanishda xato.",
          job.id,
        );
      if (err.code === 429)
        await this.db
          .prepare(
            "UPDATE tg_outbox SET next_at=GREATEST(next_at,$1) WHERE status='pending'",
          )
          .run(Date.now() + Math.max(1000, err.retryAfter * 1000));
      if (err.code === 403)
        await this.db
          .prepare("UPDATE tg_users SET active=0 WHERE id=$1")
          .run(job.chat_id);
    }
    return true;
  }
  start() {
    if (!this.token || this.running) return;
    this.running = true;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.tasks = [this.poll(signal), this.worker(signal)];
  }
  async stop() {
    this.running = false;
    this.controller?.abort();
    await Promise.allSettled(this.tasks);
    this.tasks = [];
  }
  private delay(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      timer.unref();
      signal.addEventListener("abort", done, { once: true });
    });
  }
  private async poll(signal: AbortSignal) {
    try {
      const me = await this.transport("getMe", {});
      if (!signal.aborted) this.username = me.username || "";
    } catch {
      if (!signal.aborted)
        this.lastError =
          "Botga ulanib bo‘lmadi. Token va internetni tekshiring.";
    }
    while (this.running && !signal.aborted) {
      try {
        const updates = await this.transport("getUpdates", {
          offset: Number((await this.meta("offset")) || 0),
          timeout: 25,
          allowed_updates: ["message"],
        });
        if (signal.aborted) break;
        for (const update of updates) await this.handleUpdate(update);
        this.lastError = "";
      } catch {
        if (!signal.aborted)
          this.lastError =
            "Telegram yangilanishlarini olib bo‘lmadi. Token, internet va botning faqat bitta nusxasi ishlayotganini tekshiring.";
        await this.delay(5000, signal);
      }
    }
  }
  private async worker(signal: AbortSignal) {
    while (this.running && !signal.aborted) {
      try {
        await this.deliverOne();
      } catch {
        if (!signal.aborted)
          this.lastError =
            "Xabar navbatida xato. Backend jurnalini va bazani tekshiring.";
      }
      await this.delay(80, signal);
    }
  }
}
