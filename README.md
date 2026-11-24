# STEP ONE — Next.js + NestJS

O‘zbek tilidagi diagnostika testi va telefon raqam hamda parol bilan himoyalangan admin panel.

## Ishga tushirish

### Tezkor mahalliy ishga tushirish (Windows/macOS/Linux)

Node.js 24+ va PostgreSQL 18+ o‘rnatilgach loyiha ildiz papkasida:

```sh
npm run setup
npm run db:start
npm run dev
```

`setup` ikkala qism bog‘liqliklarini lock fayllari bo‘yicha o‘rnatadi va yetishmayotgan `.env` fayllarini yaratadi. Admin paroli va sessiya kaliti tasodifiy yaratiladi; mavjud `.env` fayllari saqlanadi. Admin telefon/parolini `api/.env` ichidagi `ADMIN_PHONE` va `ADMIN_PASSWORD`dan oling. Bu faylni boshqalarga yubormang.

Sayt: http://127.0.0.1:3000 · Admin: http://127.0.0.1:3000/admin. Ikkala xizmatni to‘xtatish: `Ctrl+C`. 3000 va 4000 portlari bo‘sh bo‘lishi kerak. Telegram tokeni mahalliy saytni ishga tushirish uchun shart emas.

Production buildni mahalliy tekshirish:

```sh
npm test
npm run build
npm start
```

Serverga joylash uchun quyidagi HTTPS va doimiy baza sozlamalarini ham bajaring.

### Qismlarni alohida ishga tushirish

Node.js 24+, npm va PostgreSQL kerak. `api` va `web` bir-biridan mustaqil: har birida o‘z `package.json`, `node_modules` va `.env` bor. Har birini alohida o‘rnating:

```sh
cd api && npm install
cd web && npm install
```

Har bir papkadagi `.env.example` faylini `.env` nomi bilan nusxalang (`api/.env`, `web/.env`). `api/.env`da `ADMIN_PHONE` admin telefon raqami, `ADMIN_PASSWORD` production uchun kamida 12 va ko‘pi bilan 200 belgi, `SESSION_SECRET` kamida 32 tasodifiy belgi bo‘lsin; `web/.env`da `API_URL` backend manzili. Namuna parollari productionda qabul qilinmaydi.

Ikkita alohida terminalda:

```sh
cd api && npm run build && npm start
cd web && npm run build && npm start
```

Sayt: http://127.0.0.1:3000 · Admin: http://127.0.0.1:3000/admin

Ishlab chiqish rejimi: har bir papkada `npm run dev`. Mahalliy ishlab chiqishda `localhost` va `127.0.0.1` bir xil protokol va portda ishlaydi. Productionda `api/.env` ichidagi `APP_ORIGIN` sayt manziliga aynan mos bo‘lishi kerak. Port 3000 frontend, 4000 backend uchun. Frontend `/api/*` so‘rovlarini backendga yo‘naltiradi.

## Admin imkoniyatlari

- Savol qo‘shish, o‘chirish, matnini va turini almashtirish, tartibini o‘zgartirish.
- Har savolda 2–12 variant; variant matni, balli yoki kategoriya kalitini tahrirlash.
- 1–100 savol; ko‘pi bilan bitta kategoriya savoli. Ball: 0–100.
- Brend, kirish/yakun sarlavhalari va tavsiflari, taxminiy vaqtni tahrirlash.
- Telegram bot nomini o‘zgartirish. Bo‘sh bo‘lsa natija saytning o‘zida yakunlanadi.
- Testlar umumiy soni va oxirgi 100 yakunlangan testning sanasi, balli, kategoriyasi va versiyasi.
- O‘zgarishlar “O‘zgarishlarni saqlash” bosilgach hamma uchun kuchga kiradi. Saqlashgacha sahifani yangilab o‘zgarishlardan voz kechish mumkin.

## Telegram bot

Bot backend bilan bitta jarayonda long polling orqali ishlaydi. Alohida webhook kerak emas. Bot tokeni bo‘lmasa sayt va admin panel ishlashda davom etadi; Telegram yuborish ishlamaydi.

1. BotFather orqali bot yarating va tokenni serverdagi `api/.env` faylida `BOT_TOKEN=...` qatoriga kiriting. Backendni qayta ishga tushiring.
2. Botga `/id` yuboring. Admin → Adminlar bo‘limida hisobga Telegram IDni biriktiring va kerakli ruxsatlarni belgilang.
3. Admin → Telegram bot → Bot ulanishi bo‘limida foydalanuvchilar ochadigan sayt manzilini sozlang. Mahalliy URL boshqa telefonda ochilmaydi.
4. Telegram admin hisobidan telefonni ulashing, so‘ng `/pdf` yuborib kundalik PDFini document sifatida yuklang. Admin buyruqlari: `/admin_add ID`, `/admin_remove ID`, `/admins`.
5. Web admin → Telegram bot → Bot sozlamalarida PDF/bosma narx, to‘lov rekvizitlari, yetkazish tartibi va yordam ma’lumotlarini saqlang.

Bot tokeni faqat `BOT_TOKEN` muhit sozlamasidan olinadi. Panel, HTTP API va Telegram orqali token almashtirish olib tashlangan. Token GET javoblarida qaytarilmaydi va bazada saqlanmaydi; eski saqlangan tokenlar va almashtirish navbati ishga tushishda tozalanadi. Tokenni o‘zgartirgach backendni qayta ishga tushiring. `TELEGRAM_ADMIN_IDS` va `PUBLIC_SITE_URL` boshlang‘ich adminlar va sayt manzili uchun ishlatiladi.

**Foydalanuvchi:** Start → o‘z telefonini tugma bilan ulashish → natija yoki menyu. Boshqa odamning kontakti qabul qilinmaydi. Saytda testni tugatib “Natijani Telegram’da olish” bosilganda serverdagi tasodifiy natija IDsi botga beriladi; ball havoladan olinmaydi. Natija faqat bitta Telegram hisobiga biriktiriladi. Oldingi `t_BALL_KATEGORIYA` havolalari natija sifatida qabul qilinmaydi; yangi test topshirish kerak.

**Buyurtma:** PDF yoki bosma kundalik tanlanadi. Bosma uchun ism-familiya va to‘liq manzil olinadi. Rekvizitlar ko‘rsatiladi; foydalanuvchi chekni rasm yoki PDF sifatida yuboradi. Admin panelda chek ochiladi va **qo‘lda tekshiriladi**: bankdan avtomatik to‘lov verifikatsiyasi mavjud emas. Tasdiqlansa PDF botdan avtomatik yuboriladi. Bosma buyurtma uchun admin mahsulotni amalda jo‘natadi, kuryer/kuzatuv ma’lumotini kiritib “Jo‘natildi”ni bosadi; bot mijozga xabar beradi. Bot jismoniy jo‘natishni o‘zi bajarmaydi. Rad etilgan chek uchun sabab yuborish mumkin. To‘lovsiz buyurtmalarni `/cancel` yoki admin orqali bekor qilish mumkin.

**Ommaviy xabar:** web panelda matn yozing va ixtiyoriy JPG/PNG rasm (10 MB gacha) yoki MP4 video (50 MB gacha) tanlang. Media izohi 1024, oddiy matn 4000 belgigacha. Faylni oldindan ko‘rib qoralama yarating; “Hammaga yuborish” tasdiqlangach botni ishga tushirgan barcha faol foydalanuvchilarga, telefonini ulashmaganlarga ham, Telegram orqali yuboriladi. Botni bloklaganlar chiqarib tashlanadi. Tayyor Telegram posti uchun admin hisobidan `/broadcast`, keyin postni yuboring/forward qiling. Yuborildi/xato/navbatda sonlari avtomatik yangilanadi. Bir marta tasdiqlangan qoralama yana tarqatilmaydi. Media bazada saqlanadi va qayta ishga tushishda yo‘qolmaydi; Telegram bergan fayl IDsi keyingi oluvchilar uchun qayta ishlatiladi.

Xabarlar PostgreSQL navbatida saqlanadi, vaqtinchalik xatolarda qayta uriniladi va Telegram 429 kutish muddati hisobga olinadi. Botni bloklagan foydalanuvchilar nofaol belgilanadi. Xatoli xabarlarni paneldan qayta yuborish mumkin. Tarmoq uzilishi paytida Telegram xabarni qabul qilgan bo‘lsa, javob yo‘qolishi sababli qayta urinishda dublikat ehtimoli bor. Bitta token bilan faqat bitta backend nusxasini ishlating; webhook o‘rnatilgan bo‘lsa avval olib tashlang.

Bot bo‘limlari: natijalar, test topshirish, PDF kundalik, bosma kundalik, buyurtmalarim va yordam. `/id` — ID ko‘rish, `/cancel` — joriy jarayonni bekor qilish.

## Saqlash va himoya

Barcha server ma’lumotlari PostgreSQLda saqlanadi. Ulanish: api/.env ichidagi DATABASE_URL. DATABASE_URL bo‘sh bo‘lsa PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD qo‘llanadi. SSL uchun PostgreSQL sertifikat sozlamalaridan foydalaning. Versiyali SQL migratsiyalar api/migrations papkasida; API ularni avtomatik qo‘llaydi. Qo‘lda: npm run db:migrate. Boshlang‘ich savollar faqat bo‘sh config uchun api/src/seed.jsondan olinadi.

Mahalliy yordamchi: npm run db:start — alohida PostgreSQL klasterini 127.0.0.1:5433 da, api/data/postgres papkasida yaratadi; tasodifiy parolli DATABASE_URL api/.envga yoziladi. npm run db:stop faqat shu klasterni to‘xtatadi. Windowsda PostgreSQL boshqa papkada bo‘lsa PG_BINni belgilang. Tashqi baza ishlatsangiz DATABASE_URLni sozlang va db:startni o‘tkazib yuboring.

### Mavjud SQLite bazasini ko‘chirish

Eski API/botni to‘xtatib SQLite zaxirasini oling. PostgreSQL bazasi bo‘sh bo‘lsin va yangi API hali ishga tushirilmagan bo‘lsin. DATABASE_URLni belgilang, so‘ng loyiha ildizidan:

```sh
npm run db:import -- data/stepone.sqlite
npm run dev
```

Import manbani faqat o‘qiydi, barcha jadvallarni bitta tranzaksiyada ko‘chiradi, satr sonlarini tekshiradi va navbat sequence qiymatini tiklaydi. Manbada yo‘q yangi jadvallar bo‘sh qoladi. Eski saqlangan bot tokenlari ko‘chirilmaydi. PostgreSQLda yozuvlar bo‘lsa import rad etiladi; xatoda barcha ko‘chirilgan satrlar bekor qilinadi. SESSION_SECRET va admin sozlamalarini saqlang. API birinchi ishga tushgach config/admin avtomatik yaratilishi sababli importni avval bajarish kerak.

Zaxira: pg_dump/pg_restore. Orqaga qaytish uchun yangi API/botni to‘xtating va eski kod hamda SQLite zaxirasini tiklang. PostgreSQLda keyin yozilgan ma’lumotlar SQLitega avtomatik ko‘chmaydi.

Admin sessiyasi HttpOnly/SameSite=Strict cookie orqali 8 soat ishlaydi; productionda Secure cookie. Parollar alohida scrypt xeshlari bilan tekshiriladi. Tasodifiy sessiya tokenining faqat SHA-256 xeshi PostgreSQLda saqlanadi. Logout sessiyani serverda bekor qiladi. Yozish so‘rovlarida Origin tekshiriladi. Login va natija yozishga tezlik cheklovi bor. Ballar public APIga berilmaydi. Eski test versiyasini topshirish yoki parallel admin oynasidan eskirgan saqlash 409 bilan rad etiladi. Serverdagi ADMIN_PHONE/ADMIN_PASSWORD yoki SESSION_SECRET o‘zgarsa backendni qayta ishga tushiring. Paneldagi alohida hisob va huquq o‘zgarishlari darhol ishlaydi.

Sayt testida tasodifiy ID, sana, ball, kategoriya va test versiyasi saqlanadi. Telegram bot foydalanuvchisining Telegram IDsi, ismi, username va ulashgan telefoni saqlanadi; natija shu hisobga bog‘lanadi. Buyurtmada manzil, summa, holat va Telegram chek fayli IDsi saqlanadi. Bu ma’lumotlar faqat autentifikatsiyadan o‘tgan admin panelida ko‘rinadi. Baza va zaxiralarini shaxsiy ma’lumot sifatida saqlang. Rate limit bitta Node jarayoni uchun; ko‘p nusxali hosting uchun umumiy Redis limit qo‘shish kerak; Telegram polling uchun bitta backend ishlatiladi.

## Serverga chiqarish

**intizomkalit.uz uchun Node.js, PostgreSQL va HTTPS sozlamalari:** [serverga joylash yo‘riqnomasi](deploy/README.md). Domen proxyi uchun `deploy/domain-proxy.Caddyfile` namunasidan foydalaning. Production autentifikatsiyasini mahalliy vaqtinchalik bazada tekshirish: `npm run check:production`.

Bu loyiha alohida NestJS jarayonini talab qiladi; Cloudflare Workers/Sites hostingiga o‘zgartirmasdan joylanmaydi. Internetga hozircha chiqarilmagan.

Serverda `api/.env`da `APP_ORIGIN=https://sizning-domeningiz.uz` va PostgreSQL uchun `DATABASE_URL`ni belgilang. Loyiha ildizida `npm run build`, so‘ng production muhitida `npm start` ishga tushiring. Nginx/Caddy orqali `/api/*` so‘rovlarini `/api` prefiksini olib tashlab `127.0.0.1:4000`ga, qolgan so‘rovlarni `127.0.0.1:3000`ga yo‘naltiring. Production admin cookie HTTPS talab qiladi. Ilova va baza portlari faqat localhostda tinglasin. Shriftlar tizimdan olinadi; tashqi shrift tarmoq so‘rovi yo‘q.

## Tekshiruv

`api` papkasida `npm test` — 44 test: test balli va validatsiyasi, telefon va Origin tekshiruvi, bot kontakt talabi, natijani hisobga bog‘lash, PDF/bosma buyurtmalar, admin tasdiqlashi, ommaviy xabarlar, takroriy update va navbat xatolaridan tiklanish. Testlar haqiqiy PostgreSQLdagi alohida tasodifiy sxemalarda bajariladi. TEST_DATABASE_URL berilmasa DATABASE_URL ishlatiladi. Import, rollback, BIGINT/BYTEA va parallel tranzaksiyalar ham tekshiriladi. Telegram transporti testlarda soxta transport bilan almashtiriladi; haqiqiy foydalanuvchilarga test xabarlari yuborilmaydi. `npm run build` — NestJS va Next.js production build.

HTTP orqali qo‘shimcha tekshirildi: ruxsatsiz admin 401, login/logout, savol tahririning public APIga chiqishi, eskirgan versiya 409, noto‘g‘ri javob 400, 55 ball hisoblanishi va natija bazaga yozilishi, boshqa Origin 403. Brauzerda kirish sahifasi, testni boshlash va admin panel ko‘rildi. Mobil CSS mavjud; haqiqiy telefonlarda alohida sinov o‘tkazilmadi.

Loyiha tuzilishi: `web` — Next.js App Router; `api` — NestJS, server validatsiyasi, autentifikatsiya, PostgreSQL.

Telegram qo‘shimchasi HTTP tekshiruvi: ruxsatsiz bot paneli 401, avtorizatsiyadan keyin 200, noto‘g‘ri savdo sozlamalari 400, natijalar va Telegram JOIN so‘rovi 200. Admin panel brauzerda tekshirildi. Haqiqiy Telegram yuborish tarmog‘i ushbu o‘zgarishda sinov xabarlari bilan tekshirilmagan.

Ulanish boshqaruvi: API orqali token yuborish rad etiladi. Testlar token faqat muhit sozlamasidan olinishi, eski saqlangan tokenlar ishlatilmasligi va Telegram orqali token almashtirib bo‘lmasligini tekshiradi.

## Admin hisoblari va bo‘lim huquqlari

**Admin → Adminlar** bo‘limida alohida hisob yarating. Saytga kirish uchun telefon/parol, botga kirish uchun Telegram ID kiriting. Bitta hisob ikkala yo‘nalishda ham ishlashi mumkin. Faqat Telegram IDsi bor hisob saytga parolsiz kira olmaydi.

**Bot sozlamalari → Bot profili va rasmi** orqali Telegramdagi bot nomi, boshlash oynasidagi tavsifi, qisqa profil matni va JPG profil rasmi boshqariladi. Avval “Telegram profilini yuklash” tugmasini bosing; har bir matn alohida saqlanadi. JPG rasm 10 MB gacha yuklanadi, joriy rasmni olib tashlash ham mumkin. Bu amallar `bot.settings` huquqini talab qiladi. Mavjud adminga ushbu huquqni yoki “To‘liq ruxsat” shablonini **Adminlar** bo‘limida bering. Bot username va egaligi @BotFather orqali boshqariladi; token serverdagi BOT_TOKEN orqali belgilanadi. Profil amallari Telegram Bot APIga darhol yuboriladi, ilovaning 5 soniyalik yangilanishi Telegram profiliga takroriy so‘rov yubormaydi.

Har bir hisob uchun mustaqil huquqlar: savollar va savol tarjimalari; sayt matnlari va tarjimalari; test natijalari; bot mijozlari; buyurtma/cheklar/yetkazish; ommaviy xabarlar; mahsulot/to‘lov sozlamalari; bot holati/sayt manzili; adminlarni boshqarish. Tayyor shablonlar: Operator, Kontent muharriri va To‘liq ruxsat. Adminlarni boshqarish huquqiga ega hisob boshqa admin huquqlarini ham o‘zgartira oladi — bu ishonchli boshqaruvchi roli.

Server har bir so‘rovda hisobning hozirgi huquqlarini tekshiradi. Ruxsat olinmagan ma’lumotlar bot dashboard javobida ham yashiriladi. Savol muharriri sayt metama’lumotlarini, sayt muharriri esa savollar/ballarni o‘zgartira olmaydi. Hisobni o‘chirish o‘rniga Nofaol qiling: mavjud sessiyasi ham darhol ishlamaydi. Parol yoki login telefoni o‘zgarsa sessiyalar bekor qilinadi.

Asosiy admin serverdagi ADMIN_PHONE/ADMIN_PASSWORD orqali tiklanadi, to‘liq huquqlari bloklanmaydi. Uning ismi va Telegram IDsi panelda tahrirlanadi. Avvalgi Telegram admin IDlari bir marta alohida hisoblarga ko‘chiriladi; keyinchalik adminlarni **Adminlar** bo‘limida boshqaring. Bot ulanishidagi eski ID ro‘yxati alohida huquq manbai bo‘lib qolmaydi. Botdagi /admin_add ID faqat admin boshqarish huquqi bor hisobga ishlaydi va yangi hisobga cheklangan bot operatori huquqlarini beradi (mijozlar va buyurtmalar). Kengaytirish panel orqali amalga oshiriladi.

## Til va ko‘rinish

Sayt va admin interfeysi: O‘zbek / Русский / English. Testning boshlang‘ich savollari va javoblari uch tilda mavjud. **Sayt sozlamalari** va **Savollar** ichidagi til yorliqlarida o‘z tarjimalaringizni kiriting. Bo‘sh tarjima uchun o‘zbekcha matn ko‘rsatiladi. Botning mijoz xabarlari hozircha o‘zbek tilida.

Foydalanuvchi sahifasining yuqori panelida faqat til tanlash bor. Admin → Sayt sozlamalari bo‘limida brend nomi, brend ostidagi va sahifa pastidagi matnlar, rang rejimi, ixcham ko‘rinish va yirik matn boshqariladi. Saqlangan ko‘rinish barcha foydalanuvchilarga qo‘llanadi; oldingi qurilma ko‘rinish sozlamalari uni almashtirmaydi. Admin interfeysining shaxsiy ko‘rinish tanlovi alohida localStorage’da saqlanadi. Boshlangan test progressi ham qurilmada saqlanadi, bir hafta ichida va shu test versiyasi uchun tiklanadi. Foydalanuvchi saqlangan testni × orqali bekor qilishi mumkin. Natija topshirilgach progress o‘chadi.

Admin panelida guruhlangan menyu, bo‘lim qidiruvi, tezkor kartalar, admin/mijoz/buyurtma/natija qidiruvi va buyurtma holat filtri bor. Telefonda menyu yig‘iladi. Og‘ir admin bo‘limlari next/dynamic bilan zarur paytda yuklanadi. Tashqi shrift va yangi UI kutubxonasi qo‘shilmagan. Ishlab chiqish serverining tezligi production tezligi sifatida o‘lchanmagan.

Huquqlarni HTTP orqali izolyatsiyalangan vaqtinchalik bazada tekshirish: api papkasida npm run build, so‘ng node scripts/check-access.cjs. Bu tekshiruv haqiqiy botga xabar yubormaydi va asosiy bazani o‘zgartirmaydi.

