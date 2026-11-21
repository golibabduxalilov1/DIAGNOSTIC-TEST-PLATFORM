import { InputError } from "./security";
import { Database } from "./database";
import {
  randomBytes,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { HttpException } from "@nestjs/common";
import { normalizePhone } from "./phone";
import type { Config } from "./domain";

let passwordTasks = 0;
async function derive(password: string, salt: string): Promise<Buffer> {
  if (passwordTasks >= 4)
    throw new HttpException({ message: "Biroz kutib qayta urinib ko‘ring." }, 429);
  passwordTasks++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key)));
  } finally {
    passwordTasks--;
  }
}

export const PERMISSIONS = [
  "site.questions",
  "site.settings",
  "site.results",
  "bot.users",
  "bot.orders",
  "bot.broadcasts",
  "bot.settings",
  "bot.connection",
  "admins.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type Admin = {
  id: string;
  name: string;
  phone: string | null;
  telegramId: number | null;
  permissions: Permission[];
  active: boolean;
  owner: boolean;
  webAccess: boolean;
};
type Row = {
  id: string;
  name: string;
  phone: string | null;
  telegram_id: number | null;
  permissions: string;
  active: number;
  owner: number;
  password: string | null;
};
export const denied = () => {
  throw new HttpException(
    { message: "Bu bo‘lim uchun sizga ruxsat berilmagan." },
    403,
  );
};
export function requirePermission(admin: Admin, ...permissions: Permission[]) {
  if (!permissions.some((p) => admin.permissions.includes(p))) denied();
  return admin;
}
export function requireConfigChange(admin: Admin, old: Config, next: Config) {
  const questions = (c: Config) =>
    JSON.stringify({
      questions: c.questions,
      ru: c.locales?.ru?.questions,
      en: c.locales?.en?.questions,
    });
  const metadata = (c: Config) => {
    const { questions, version, locales, ...rest } = c;
    return JSON.stringify({
      ...rest,
      locales: Object.fromEntries(
        (["ru", "en"] as const).map((lang) => [
          lang,
          Object.fromEntries(
            (
              [
                "title",
                "description",
                "finishTitle",
                "finishDescription",
              ] as const
            ).map((key) => [key, locales?.[lang]?.[key] || ""]),
          ),
        ]),
      ),
    });
  };
  if (questions(old) !== questions(next))
    requirePermission(admin, "site.questions");
  if (metadata(old) !== metadata(next))
    requirePermission(admin, "site.settings");
}
export class AdminService {
  private constructor(private db: Database) {}
  static async create(db: Database, phone: string, password: string) {
    const service = new AdminService(db);
    await service.initialize(phone, password);
    return service;
  }
  private async initialize(phone: string, password: string) {
    const db = this.db;
    const existing = (await db
      .prepare("SELECT * FROM admins WHERE id='owner'")
      .get()) as Row | undefined;
    if (
      !existing ||
      !existing.owner ||
      !existing.active ||
      existing.phone !== normalizePhone(phone) ||
      !(await this.check(password, existing.password))
    ) {
      await db
        .prepare(
          "INSERT INTO admins(id,name,phone,password,permissions,owner) VALUES('owner',$1,$2,$3,$4,1) ON CONFLICT(id) DO UPDATE SET phone=excluded.phone,password=excluded.password,permissions=excluded.permissions,owner=1,active=1",
        )
        .run(
          "Asosiy admin",
          normalizePhone(phone),
          await this.hash(password),
          JSON.stringify(PERMISSIONS),
        );
      if (existing)
        await db
          .prepare("DELETE FROM admin_sessions WHERE admin_id='owner'")
          .run();
    }
  }
  private async hash(password: string) {
    const salt = randomBytes(16).toString("hex");
    return salt + ":" + (await derive(password, salt)).toString("hex");
  }
  private async check(password: unknown, stored: string | null) {
    if (typeof password !== "string" || password.length > 500) return false;
    const [salt, hash] = (stored || "").split(":");
    const actual = await derive(password, salt || "unavailable-admin");
    return (
      !!hash &&
      /^[a-f0-9]{128}$/i.test(hash) &&
      timingSafeEqual(actual, Buffer.from(hash, "hex"))
    );
  }
  private view(row: Row): Admin {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone ? "+" + row.phone : null,
      telegramId: row.telegram_id,
      permissions: row.owner ? [...PERMISSIONS] : JSON.parse(row.permissions),
      active: !!row.active,
      owner: !!row.owner,
      webAccess: !!row.phone && !!row.password,
    };
  }
  async list() {
    return (
      (await this.db
        .prepare("SELECT * FROM admins ORDER BY owner DESC,name")
        .all()) as Row[]
    ).map((r) => this.view(r));
  }
  async login(phone: unknown, password: unknown) {
    return this.db.transaction(() => this.createSession(phone, password));
  }
  private async createSession(phone: unknown, password: unknown) {
    const normalized = normalizePhone(phone),
      row = (await this.db
        .prepare("SELECT * FROM admins WHERE phone=$1 FOR UPDATE")
        .get(normalized || "")) as Row | undefined;
    const valid = await this.check(password, row?.password || null);
    if (!row || !row.active || !valid)
      throw new HttpException(
        { message: "Telefon raqam yoki parol noto‘g‘ri." },
        401,
      );
    const token = randomBytes(32).toString("hex");
    await this.db
      .prepare("DELETE FROM admin_sessions WHERE expires<$1")
      .run(Date.now());
    await this.db
      .prepare("INSERT INTO admin_sessions VALUES($1,$2,$3)")
      .run(this.digest(token), row.id, Date.now() + 8 * 3600000);
    return { token, admin: this.view(row) };
  }
  private digest(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
  async authenticate(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new HttpException({ message: "Avval tizimga kiring." }, 401);
    const row = (await this.db
      .prepare(
        "SELECT a.* FROM admins a JOIN admin_sessions s ON s.admin_id=a.id WHERE s.token=$1 AND s.expires>$2 AND a.active=1 AND a.phone IS NOT NULL AND a.password IS NOT NULL",
      )
      .get(this.digest(token), Date.now())) as Row | undefined;
    if (!row)
      throw new HttpException({ message: "Avval tizimga kiring." }, 401);
    return this.view(row);
  }
  async logout(token: string) {
    await this.db
      .prepare("DELETE FROM admin_sessions WHERE token=$1")
      .run(this.digest(token));
  }
  async save(actor: Admin, input: any, id?: string) {
    return this.db.transaction(() => this.saveAccount(actor, input, id));
  }
  private async saveAccount(actor: Admin, input: any, id?: string) {
    requirePermission(actor, "admins.manage");
    const old = id
      ? ((await this.db.prepare("SELECT * FROM admins WHERE id=$1").get(id)) as
          Row | undefined)
      : undefined;
    if (id && !old) throw new InputError("Admin topilmadi.");
    if (
      !input ||
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 100 ||
      !Array.isArray(input.permissions) ||
      input.permissions.some(
        (p: unknown) => !PERMISSIONS.includes(p as Permission),
      ) ||
      typeof input.active !== "boolean"
    )
      throw new InputError("Admin ismi va ruxsatlarini tekshiring.");
    if (
      old?.owner &&
      (!input.active ||
        !PERMISSIONS.every((p) => input.permissions.includes(p)))
    )
      throw new InputError("Asosiy adminning to‘liq huquqlarini cheklab bo‘lmaydi.");
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (input.phone && !phone) throw new InputError("Telefon raqam noto‘g‘ri.");
    const telegramId =
      input.telegramId === "" || input.telegramId == null
        ? null
        : Number(input.telegramId);
    if (
      telegramId !== null &&
      (!Number.isSafeInteger(telegramId) || telegramId <= 0)
    )
      throw new InputError("Telegram ID noto‘g‘ri.");
    if (!phone && !telegramId)
      throw new InputError("Telefon yoki Telegram ID kiriting.");
    if (old?.owner && phone !== old.phone)
      throw new InputError(
        "Asosiy admin telefoni serverdagi ADMIN_PHONE orqali belgilanadi.",
      );
    if (input.password !== undefined && typeof input.password !== "string")
      throw new InputError("Parol noto‘g‘ri.");
    if (
      input.password &&
      (input.password.length < 12 || input.password.length > 200)
    )
      throw new InputError("Parol 12–200 belgi bo‘lsin.");
    if (old?.owner && input.password)
      throw new InputError("Asosiy admin paroli server sozlamasidan boshqariladi.");
    const password = input.password
      ? await this.hash(input.password)
      : old?.password || null;
    if (phone && !password)
      throw new InputError("Saytga kirish uchun kamida 12 belgili parol kiriting.");
    if (old?.id === actor.id && !input.active)
      throw new InputError("O‘z hisobingizni bloklay olmaysiz.");
    const accountId = id || randomBytes(12).toString("hex");
    try {
      await this.db
        .prepare(
          "INSERT INTO admins(id,name,phone,telegram_id,password,permissions,active) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,telegram_id=excluded.telegram_id,password=excluded.password,permissions=excluded.permissions,active=excluded.active",
        )
        .run(
          accountId,
          input.name.trim(),
          phone,
          telegramId,
          password,
          JSON.stringify([...new Set(input.permissions)]),
          Number(input.active),
        );
    } catch (e) {
      if ((e as { code?: string }).code === "23505")
        throw new InputError(
          "Bu telefon yoki Telegram ID boshqa adminga biriktirilgan.",
        );
      throw e;
    }
    if (!input.active || input.password || (old && old.phone !== phone))
      await this.db
        .prepare("DELETE FROM admin_sessions WHERE admin_id=$1")
        .run(accountId);
    return (await this.list()).find((a) => a.id === accountId)!;
  }
  async telegramPermissions(id: number): Promise<Permission[]> {
    const row = (await this.db
      .prepare("SELECT * FROM admins WHERE telegram_id=$1 AND active=1")
      .get(id)) as Row | undefined;
    return row ? this.view(row).permissions : [];
  }
  async telegramIds() {
    return (await this.list())
      .filter(
        (a) =>
          a.active &&
          a.telegramId &&
          a.permissions.some(
            (p) => p.startsWith("bot.") || p === "admins.manage",
          ),
      )
      .map((a) => a.telegramId!);
  }
  async migrateTelegram(ids: number[]) {
    // A dedicated marker avoids regranting removed legacy IDs on subsequent starts.

    if (
      await this.db
        .prepare("SELECT value FROM admin_meta WHERE key='telegram_migrated'")
        .get()
    )
      return;
    for (const id of ids)
      if (Number.isSafeInteger(id) && id > 0)
        await this.db
          .prepare(
            "INSERT INTO admins(id,name,telegram_id,permissions) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          )
          .run(
            randomBytes(12).toString("hex"),
            "Telegram admin " + id,
            id,
            JSON.stringify(
              PERMISSIONS.filter(
                (p) => p.startsWith("bot.") || p === "admins.manage",
              ),
            ),
          );
    await this.db
      .prepare("INSERT INTO admin_meta VALUES('telegram_migrated','1')")
      .run();
  }
  async changeTelegramAdmin(actorId: number, target: number, remove: boolean) {
    if (!(await this.telegramPermissions(actorId)).includes("admins.manage"))
      denied();
    const actor = (await this.list()).find((a) => a.telegramId === actorId)!;
    const old = (await this.list()).find((a) => a.telegramId === target);
    if (remove) {
      if (!old) throw new InputError("Admin topilmadi.");
      if (old.owner) throw new InputError("Asosiy adminni olib tashlab bo‘lmaydi.");
      if (target === actorId)
        throw new InputError("O‘z admin huquqingizni olib tashlay olmaysiz.");
      await this.db
        .prepare(
          "UPDATE admins SET telegram_id=NULL,active=CASE WHEN phone IS NULL THEN 0 ELSE active END WHERE id=$1",
        )
        .run(old.id);
      return;
    }
    if (old) throw new InputError("Bu foydalanuvchi allaqachon admin.");
    await this.save(actor, {
      name: "Telegram admin " + target,
      telegramId: target,
      permissions: ["bot.users", "bot.orders"],
      active: true,
    });
  }
}
