# intizomkalit.uz uchun Node.js va PostgreSQL bilan joylash

Asosiy domen: https://intizomkalit.uz, admin: https://intizomkalit.uz/admin.
Serverda Node.js 24+, npm, PostgreSQL 18+ va HTTPS proxy kerak. DNS yozuvlarini serverning amaldagi IP manziliga yo‘naltiring.

## Sozlash

Loyiha ildizida `npm run setup` bajaring. Bu bog‘liqliklarni o‘rnatadi va yetishmayotgan `.env` fayllarini yaratadi; yangi admin paroli va sessiya kaliti tasodifiy yaratiladi.

`api/.env`da quyidagilarni sozlang:

```dotenv
APP_ORIGIN=https://intizomkalit.uz
PUBLIC_SITE_URL=https://intizomkalit.uz
HOST=127.0.0.1
PORT=4000
TRUST_PROXY_HOPS=1
```

`ADMIN_PHONE`, kuchli `ADMIN_PASSWORD`, `SESSION_SECRET`, zarur bo‘lsa `BOT_TOKEN` va `TELEGRAM_ADMIN_IDS`ni kiriting. PostgreSQL xizmatini ishga tushirib, alohida foydalanuvchi va baza yarating; `DATABASE_URL`ni shu bazaga moslang. Paroldagi maxsus belgilarni URL formatida kodlang. PostgreSQL faqat mahalliy ulanishlarni qabul qilsin.

Muqobil ravishda `npm run db:start` alohida mahalliy klasterni `127.0.0.1:5433`da yaratadi va `DATABASE_URL`ni yozadi. Ma’lumotlar `api/data/postgres`da saqlanadi; server qayta yoqilganda klasterni ham ishga tushirish kerak.

`web/.env`da:

```dotenv
API_URL=http://127.0.0.1:4000
SITE_URL=https://intizomkalit.uz
```

Linux serverda loyiha ildizidan:

```sh
chmod 600 api/.env web/.env
npm run build
NODE_ENV=production npm start
```

Doimiy ishlash uchun start buyrug‘ini systemd yoki mavjud jarayon boshqaruvchisi orqali, loyiha katalogida va alohida oddiy foydalanuvchi ostida ishga tushiring. Xizmat muhitida `NODE_ENV=production` bo‘lsin. API migratsiyalarni avtomatik bajaradi va bo‘sh config uchun boshlang‘ich savollarni yaratadi. Bitta bot tokeni bilan bitta backend ishlating.

## HTTPS proxy

`deploy/domain-proxy.Caddyfile`dagi domen bloklarini mavjud host Caddy konfiguratsiyasiga qo‘shing va konfiguratsiyani tekshirib qayta yuklang. Domen proxyi TLS va HTTP → HTTPSni boshqaradi. `/api/*` so‘rovlari prefiks olib tashlanib `127.0.0.1:4000`ga, boshqa so‘rovlar `127.0.0.1:3000`ga uzatiladi. API mijoz IPsini bitta ishonchli proxy orqali oladi (`TRUST_PROXY_HOPS=1`). Namuna Caddy internet so‘rovlarini bevosita qabul qilishini nazarda tutadi; qo‘shimcha tashqi proxy bo‘lsa mijoz IP sozlamalarini server topologiyasiga moslang.

3000, 4000 va PostgreSQL portlarini tashqariga ochmang.

## Eski SQLite ma’lumotlarini ko‘chirish

Eski bot/API nusxalarini to‘xtating, SQLite va maxfiy sozlamalarni zaxiralang. Yangi PostgreSQL bazasi bo‘sh bo‘lsin. **Yangi API birinchi marta ishga tushishidan oldin**, loyiha ildizidan:

```sh
npm run db:import -- api/data/stepone.sqlite
```

Import barcha ma’lumotlarni bitta tranzaksiyada ko‘chiradi va satr sonlarini tekshiradi. Manba o‘zgarmaydi. PostgreSQLda yozuv bo‘lsa import to‘xtaydi. Xatoda qisman ko‘chirilgan ma’lumotlar saqlanmaydi. Eski bot tokenlari ko‘chirilmaydi; `BOT_TOKEN` muhit sozlamasidan olinadi.

## Tekshirish

```sh
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:3000/api/health
curl https://intizomkalit.uz/api/health
```

Healthcheck PostgreSQLga ham so‘rov yuboradi. Admin orqali login, savol saqlash, test topshirish va bot sozlamalarini tekshiring. Secure cookie sabab admin uchun HTTPS domenidan foydalaning. Loglarni jarayon boshqaruvchisidan ko‘ring. Mahalliy izolyatsiyalangan tekshiruvlar: `npm test`, `npm run check:production`, `npm run check:access`.

## Yangilash, zaxira va tiklash

Yangilashdan oldin bazani zaxiralang. API/web xizmatini to‘xtating, yangilangan loyiha ildizida `npm run setup` va `npm run build` bajaring, so‘ng xizmatni qayta ishga tushiring. PostgreSQL xizmatini mustaqil boshqaring; mahalliy yordamchi klaster uchun `npm run db:stop` mavjud.

PostgreSQL ulanish sozlamalarini `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` va himoyalangan parol fayli orqali bering. Zaxira va yangi bo‘sh bazaga tiklash:

```sh
pg_dump -Fc -f stepone.dump
createdb stepone_restore
pg_restore -d stepone_restore --exit-on-error stepone.dump
```

Tiklangan bazani tekshirib, API uchun `DATABASE_URL`ni shu bazaga o‘zgartiring va API xizmatini qayta ishga tushiring. Maxfiy `.env` va dump fayllarini himoyalangan joyda saqlang. SQLitega qaytish uchun eski kod va zaxirani tiklang; PostgreSQLda keyin yozilgan yangi ma’lumotlar alohida ko‘chirilishi kerak.
