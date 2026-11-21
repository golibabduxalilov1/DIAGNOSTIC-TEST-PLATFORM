import "reflect-metadata";
import { config as env } from "dotenv";
import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  Res,
  Param,
  Query,
  Module,
  HttpException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ExecutionContext,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { BroadcastUpload } from "./broadcast-media";
import { NestFactory } from "@nestjs/core";
import type { Request, Response } from "express";
import { Database } from "./database";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Config, validate, calculate, localizeConfig } from "./domain";
import { normalizePhone } from "./phone";
import { allowedOrigin } from "./origin";
import { clientError, RateLimiter, limitAccount, securityMiddleware, readLimitedFile } from "./security";
import { TelegramService } from "./telegram";
import {
  AdminService,
  requirePermission,
  requireConfigChange,
  Permission,
} from "./admins";
async function bootstrap() {
  env({ path: resolve(__dirname, "../.env") });
  const password = process.env.ADMIN_PASSWORD,
    secret = process.env.SESSION_SECRET;
  const minimumPassword = process.env.NODE_ENV === "production" ? 12 : 8;
  if (!password || password.length < minimumPassword || password.length > 200 || !secret || secret.length < 32 ||
      /^(replace-with|change-?me|password)/i.test(password) || /^(replace-with|change-?me)/i.test(secret))
    throw Error(`api/.env: ADMIN_PASSWORD (${minimumPassword}–200), SESSION_SECRET (32+) tasodifiy qiymatlar kerak.`);
  if (process.env.NODE_ENV === "production") {
    const configured = new URL(process.env.APP_ORIGIN || "");
    if (configured.protocol !== "https:" || configured.origin !== process.env.APP_ORIGIN)
      throw Error("Production APP_ORIGIN aniq HTTPS origin bo‘lishi kerak.");
  }
  const phone = normalizePhone(process.env.ADMIN_PHONE);
  if (!phone) throw Error("api/.env: ADMIN_PHONE telefon raqami kerak.");
  const db = new Database();
  try {
    await db.migrate();
    await db
      .prepare(
        "INSERT INTO config(id,json) VALUES(1,$1) ON CONFLICT(id) DO NOTHING",
      )
      .run(readFileSync(resolve(__dirname, "../src/seed.json"), "utf8"));
    const seedConfig = JSON.parse(
      readFileSync(resolve(__dirname, "../src/seed.json"), "utf8"),
    ) as Config;
    const getConfig = async () => {
      const c = JSON.parse(
        (
          (await db.prepare("SELECT json FROM config WHERE id=1").get()) as {
            json: string;
          }
        ).json,
      ) as Config;
      if (c.locales === undefined && c.title === seedConfig.title)
        c.locales = seedConfig.locales;
      return c;
    };
    const admins = await AdminService.create(db, phone, password);
    const envAdminIds = (process.env.TELEGRAM_ADMIN_IDS || "")
      .split(",")
      .map(Number)
      .filter((n) => Number.isSafeInteger(n) && n > 0);
    const oldTelegramIds = (
      (await db
        .prepare("SELECT value FROM tg_meta WHERE key='admin_ids'")
        .get()) as any
    )?.value;
    await admins.migrateTelegram(
      oldTelegramIds ? JSON.parse(oldTelegramIds) : envAdminIds,
    );
    const telegram = await TelegramService.create(
      db,
      process.env.BOT_TOKEN || "",
      envAdminIds,
      process.env.PUBLIC_SITE_URL ||
        process.env.APP_ORIGIN ||
        "http://127.0.0.1:3000",
      undefined,
      {
        permissions: async (id) => await admins.telegramPermissions(id),
        ids: async () => await admins.telegramIds(),
        change: async (actor, target, remove) =>
          await admins.changeTelegramAdmin(actor, target, remove),
      },
      process.env.NODE_ENV === "production",
    );
    const botAction = async <T>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (e) {
        clientError(e);
      }
    };
    const fail = (status: number, message: string): never => {
      throw new HttpException({ message }, status);
    };
    function origin(req: Request) {
      const expected = process.env.APP_ORIGIN || "http://127.0.0.1:3000";
      if (
        !allowedOrigin(
          req.headers.origin,
          expected,
          process.env.NODE_ENV === "production",
        )
      )
        fail(403, "Ruxsat etilmagan manba.");
    }
    function sessionToken(req: Request) {
      return (
        req.headers.cookie
          ?.split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("session="))
          ?.slice(8) || ""
      );
    }
    async function auth(req: Request, ...permissions: Permission[]) {
      const admin = await admins.authenticate(sessionToken(req));
      if (permissions.length) requirePermission(admin, ...permissions);
      return admin;
    }
    const attempts = new RateLimiter();
    let activeUploads = 0;
    class BroadcastUploadGuard {
      async canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest<Request>();
        origin(req);
        await auth(req, "bot.broadcasts");
        throttle(req, 10, "broadcast-upload");
        if (activeUploads >= 2) fail(429, "Fayl yuklanmoqda. Biroz kuting.");
        activeUploads++;
        const res = context.switchToHttp().getResponse<Response>();
        let released = false;
        const release = () => { if (!released) { released = true; activeUploads--; } };
        res.once("finish", release);
        res.once("close", release);
        return true;
      }
    }
    function throttle(req: Request, limit: number, prefix: string) {
      if (!attempts.consume(prefix + ":" + req.ip, limit))
        fail(429, "Biroz kutib qayta urinib ko‘ring.");
    }
    @Controller()
    class AppController {
      @Get("health") async health() {
        await db.query("SELECT 1");
        return { ok: true };
      }
      @Get("admin/telegram") async botDashboard(@Req() req: Request) {
        const admin = await auth(
          req,
          "bot.users",
          "bot.orders",
          "bot.broadcasts",
          "bot.settings",
          "bot.connection",
        );
        return await telegram.dashboard(admin.permissions);
      }
      @Put("admin/telegram/connection") async botConnection(
        @Req() req: Request,
        @Body() body: any,
      ) {
        origin(req);
        await auth(req, "bot.connection");
        throttle(req, 6, "bot-connection");
        try {
          return await telegram.saveConnection({
            ...body,
            adminIds: await admins.telegramIds(),
          });
        } catch (e) {
          clientError(e);
        }
      }
      @Put("admin/telegram/settings") async botSettings(
        @Req() req: Request,
        @Body() body: any,
      ) {
        origin(req);
        await auth(req, "bot.settings");
        return botAction(async () => await telegram.saveSettings(body));
      }
      @Post("admin/telegram/orders/:id/review") async botReview(
        @Req() req: Request,
        @Param("id") id: string,
        @Body() body: any,
      ) {
        origin(req);
        await auth(req, "bot.orders");
        if (
          typeof body?.action !== "string" ||
          (body.note !== undefined &&
            (typeof body.note !== "string" || body.note.length > 1500))
        )
          fail(400, "Amal yoki izoh noto‘g‘ri.");
        return botAction(
          async () => await telegram.review(id, body.action, body.note || ""),
        );
      }
      @Get("admin/telegram/orders/:id/receipt") async botReceipt(
        @Req() req: Request,
        @Param("id") id: string,
        @Res() res: Response,
      ) {
        await auth(req, "bot.orders");
        try {
          const file = await readLimitedFile(await telegram.receipt(id));
          res.setHeader("Content-Type", file.mime);
          res.setHeader("Content-Disposition", 'attachment; filename="receipt.' +
            ({ "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" }[file.mime]) + '"');
          res.send(file.bytes);
        } catch {
          fail(400, "Chekni yuklab bo‘lmadi. Bot ulanishini tekshiring.");
        }
      }
      @Post("admin/telegram/broadcasts")
      @UseGuards(BroadcastUploadGuard)
      @UseInterceptors(
        FileInterceptor("media", {
          limits: {
            fileSize: 50 * 1024 * 1024,
            files: 1,
            fields: 1,
            fieldSize: 16000,
          },
          fileFilter: (_req, file, cb) => {
            if (
              !["image/jpeg", "image/png", "video/mp4"].includes(file.mimetype)
            )
              return cb(
                new HttpException(
                  { message: "JPG, PNG rasm yoki MP4 video tanlang." },
                  400,
                ),
                false,
              );
            cb(null, true);
          },
        }),
      )
      botDraft(@Body() body: any, @UploadedFile() file?: BroadcastUpload) {
        return botAction(
          async () => await telegram.createBroadcast(body?.text ?? "", file),
        );
      }
      @Get("admin/telegram/broadcasts/:id/media") async botMedia(
        @Req() req: Request,
        @Param("id") id: string,
        @Res() res: Response,
      ) {
        await auth(req, "bot.broadcasts");
        const file = await botAction(
          async () => await telegram.broadcastMedia(id),
        );
        res.setHeader("Content-Type", file.mime);
        res.setHeader("Content-Disposition", "inline");
        res.send(Buffer.from(file.bytes));
      }
      @Post("admin/telegram/broadcasts/:id/send") async botBroadcast(
        @Req() req: Request,
        @Param("id") id: string,
      ) {
        origin(req);
        await auth(req, "bot.broadcasts");
        return botAction(async () => await telegram.broadcast(id));
      }
      @Post("admin/telegram/jobs/:id/retry") async botRetry(
        @Req() req: Request,
        @Param("id") id: string,
      ) {
        origin(req);
        const admin = await auth(req);
        requirePermission(admin, await telegram.jobPermission(Number(id)));
        return botAction(async () => await telegram.retryJob(Number(id)));
      }
      @Get("quiz") async quiz(@Query("lang") lang: string) {
        const c = localizeConfig(await getConfig(), lang);
        const { locales, ...publicConfig } = c;
        return {
          ...publicConfig,
          questions: c.questions.map((q) => ({
            id: q.id, type: q.type, text: q.text,
            options: q.options.map((o) => ({ id: o.id, text: o.text })),
          })),
        };
      }
      @Post("submit") async submit(@Req() req: Request, @Body() body: any) {
        origin(req);
        throttle(req, 30, "submit");
        if (!body || typeof body !== "object" || Array.isArray(body))
          fail(400, "Javoblar noto‘g‘ri.");
        const c = await getConfig();
        if (body.version !== c.version)
          fail(409, "Test yangilandi. Sahifani yangilab qayta boshlang.");
        let result;
        try {
          result = calculate(c, body.answers);
        } catch (e) {
          clientError(e);
        }
        const id = randomBytes(12).toString("hex");
        await db
          .prepare("INSERT INTO results VALUES($1,$2,$3,$4,$5)")
          .run(
            id,
            new Date().toISOString(),
            result!.score,
            result!.category,
            c.version,
          );
        const localized = localizeConfig(c, body.language);
        return {
          id,
          title: localized.finishTitle,
          description: localized.finishDescription,
          telegramUrl:
            telegram.botUsername() || c.botUsername
              ? `https://t.me/${telegram.botUsername() || c.botUsername}?start=r_${id}`
              : null,
        };
      }
      @Post("admin/login") async login(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
        @Body() body: any,
      ) {
        origin(req);
        throttle(req, 6, "login");
        const loginPhone = normalizePhone(body?.phone);
        if (loginPhone) await limitAccount(db, loginPhone);
        const session = await admins.login(body?.phone, body?.password);
        res.cookie("session", session.token, {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          maxAge: 8 * 3600000,
          path: "/",
        });
        return { admin: session.admin };
      }
      @Post("admin/logout") async logout(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
      ) {
        origin(req);
        await admins.logout(sessionToken(req));
        res.clearCookie("session", { path: "/" });
        return { ok: true };
      }
      @Get("admin/me") async me(@Req() req: Request) {
        return { admin: await auth(req) };
      }
      @Get("admin/summary") async summary(@Req() req: Request) {
        const actor = await auth(req);
        const can = (p: Permission) => actor.permissions.includes(p);
        return {
          questions: can("site.questions")
            ? (await getConfig()).questions.length
            : null,
          results: can("site.results")
            ? (
                (await db
                  .prepare("SELECT COUNT(*) n FROM results")
                  .get()) as any
              ).n
            : null,
          pending: can("bot.orders")
            ? (
                (await db
                  .prepare(
                    "SELECT COUNT(*) n FROM tg_orders WHERE status='pending'",
                  )
                  .get()) as any
              ).n
            : null,
          admins: can("admins.manage") ? (await admins.list()).length : null,
        };
      }
      @Get("admin/accounts") async accounts(@Req() req: Request) {
        await auth(req, "admins.manage");
        return await admins.list();
      }
      @Post("admin/accounts") async createAccount(
        @Req() req: Request,
        @Body() body: any,
      ) {
        origin(req);
        const actor = await auth(req, "admins.manage");
        return botAction(async () => await admins.save(actor, body));
      }
      @Put("admin/accounts/:id") async editAccount(
        @Req() req: Request,
        @Param("id") id: string,
        @Body() body: any,
      ) {
        origin(req);
        const actor = await auth(req, "admins.manage");
        return botAction(async () => await admins.save(actor, body, id));
      }
      @Get("admin/config") async config(@Req() req: Request) {
        await auth(req, "site.questions", "site.settings");
        return await getConfig();
      }
      @Put("admin/config") async save(
        @Req() req: Request,
        @Body() body: Config,
      ) {
        origin(req);
        const actor = await auth(req, "site.questions", "site.settings");
        try {
          validate(body);
        } catch (e) {
          clientError(e);
        }
        const old = await getConfig();
        requireConfigChange(actor, old, body);
        if (body.version !== old.version)
          fail(409, "Boshqa oynada o‘zgarish bor. Sahifani yangilang.");
        const updated = { ...body, version: old.version + 1 };
        const changed = await db
          .prepare(
            "UPDATE config SET json=$1 WHERE id=1 AND (json::jsonb->>'version')::integer=$2",
          )
          .run(JSON.stringify(updated), old.version);
        if (!changed.changes)
          fail(409, "Boshqa oynada o‘zgarish bor. Sahifani yangilang.");
        return updated;
      }
      @Get("admin/results") async results(@Req() req: Request) {
        await auth(req, "site.results");
        return {
          total: (
            (await db.prepare("SELECT COUNT(*) n FROM results").get()) as any
          ).n,
          items: await db
            .prepare(
              "SELECT r.*,u.name,u.phone,u.id telegram_id FROM results r LEFT JOIN tg_claims c ON c.result_id=r.id LEFT JOIN tg_users u ON u.id=c.user_id ORDER BY r.created DESC LIMIT 100",
            )
            .all(),
        };
      }
    }
    @Module({ controllers: [AppController] })
    class AppModule {}
    async function main() {
      const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
      const express = app.getHttpAdapter().getInstance();
      express.disable("x-powered-by");
      express.set("query parser", "simple");
      if (process.env.TRUST_PROXY_HOPS === "1")
        app.getHttpAdapter().getInstance().set("trust proxy", 1);
      app.use(securityMiddleware());
      app.useBodyParser("json", { limit: "256kb", strict: true });
      await app.listen(
        Number(process.env.PORT || 4000),
        process.env.HOST || "127.0.0.1",
      );
      const server = app.getHttpServer();
      server.headersTimeout = 15000;
      server.requestTimeout = 120000;
      server.keepAliveTimeout = 5000;
      telegram.start();
      let stopping = false;
      const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        await telegram.stop();
        await app.close();
        await db.close();
      };
      process.once("SIGINT", () => void shutdown());
      process.once("SIGTERM", () => void shutdown());
    }
    await main();
  } catch (error) {
    await db.close();
    throw error;
  }
}
bootstrap().catch(() => {
  console.error(
    "API ishga tushmadi. PostgreSQL ulanishi va muhit sozlamalarini tekshiring.",
  );
  process.exitCode = 1;
});
