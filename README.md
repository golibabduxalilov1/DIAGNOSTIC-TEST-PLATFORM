# STEP ONE — Next.js + NestJS

O‘zbek tilidagi diagnostika testi va telefon raqam hamda parol bilan himoyalangan admin panel.

## Ishga tushirish

Node.js 24+ va npm kerak. `api` va `web` bir-biridan mustaqil: har birida o‘z `package.json`, `node_modules` va `.env` bor. Har birini alohida o‘rnating:

```sh
cd api && npm install
cd web && npm install
```

Har bir papkadagi `.env.example` faylini `.env` nomi bilan nusxalang (`api/.env`, `web/.env`). `api/.env`da `ADMIN_PHONE` admin telefon raqami, `ADMIN_PASSWORD` kamida 12 belgi, `SESSION_SECRET` kamida 32 tasodifiy belgi bo‘lsin; `web/.env`da `API_URL` backend manzili.

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

1. BotFather orqali bot yarating. Saytdagi **Admin → Telegram bot → Bot ulanishi** bo‘limiga tokenni kiriting. Token Telegram getMe orqali tekshiriladi; noto‘g‘ri token avvalgi ulanishni buzmaydi.
2. Tokenni saqlagach botga `/id` yuboring. Admin → Adminlar bo‘limida mavjud hisobga shu Telegram IDni biriktiring yoki yangi Telegram hisobi yarating va kerakli ruxsatlarni belgilang.
3. Shu bo‘limdagi sayt manzilini foydalanuvchilar ochadigan URLga qo‘ying. Mahalliy URL boshqa telefonda ochilmaydi. Token yoki adminlar saqlangach backend avtomatik yangilanadi; qo‘lda qayta ishga tushirish kerak emas.
4. Telegram admin hisobidan telefonni ulashing, so‘ng `/pdf` yuborib kundalik PDFini document sifatida yuklang. `/admin` yoki **Admin boshqaruvi** menyusi orqali buyruqlarni ko‘ring: `/admin_add ID`, `/admin_remove ID`, `/admins`, `/token`.
5. `/token`dan keyin shu botning yangi tokenini yuborish mumkin. Token yozilgan xabar o‘chirish navbatiga ustuvor qo‘yiladi, token shifrlanib saqlanadi va tekshirilgach qo‘llanadi. Oddiy foydalanuvchilar bu buyruqlar bilan huquq yoki ulanishni o‘zgartira olmaydi. Birinchi adminni saytdan kiriting.
6. Web admin → Telegram bot → Bot sozlamalarida PDF/bosma narx, to‘lov rekvizitlari, yetkazish tartibi va yordam ma’lumotlarini saqlang. Narx 0 yoki rekvizit bo‘sh bo‘lsa savdo yopiq; PDF fayli ham talab qilinadi.

Token serverdagi SQLite bazasida AES-256-GCM bilan shifrlanadi; kalit `SESSION_SECRET`dan olinadi. Token GET javoblarida qaytarilmaydi. `SESSION_SECRET` almashtirilsa tokenni paneldan qayta kiriting. `BOT_TOKEN`, `TELEGRAM_ADMIN_IDS` va `PUBLIC_SITE_URL` muhit sozlamalari boshlang‘ich zaxira sifatida qo‘llanadi; panelda saqlangan qiymatlar ustun. Tokenni bo‘sh qoldirib saqlash mavjud tokenni saqlaydi. Foydalanuvchilari bor loyihada boshqa botga o‘tish bloklanadi; shu botning tokenini yangilash mumkin.

**Foydalanuvchi:** Start → o‘z telefonini tugma bilan ulashish → natija yoki menyu. Boshqa odamning kontakti qabul qilinmaydi. Saytda testni tugatib “Natijani Telegram’da olish” bosilganda serverdagi tasodifiy natija IDsi botga beriladi; ball havoladan olinmaydi. Natija faqat bitta Telegram hisobiga biriktiriladi. Oldingi `t_BALL_KATEGORIYA` havolalari natija sifatida qabul qilinmaydi; yangi test topshirish kerak.

**Buyurtma:** PDF yoki bosma kundalik tanlanadi. Bosma uchun ism-familiya va to‘liq manzil olinadi. Rekvizitlar ko‘rsatiladi; foydalanuvchi chekni rasm yoki PDF sifatida yuboradi. Admin panelda chek ochiladi va **qo‘lda tekshiriladi**: bankdan avtomatik to‘lov verifikatsiyasi mavjud emas. Tasdiqlansa PDF botdan avtomatik yuboriladi. Bosma buyurtma uchun admin mahsulotni amalda jo‘natadi, kuryer/kuzatuv ma’lumotini kiritib “Jo‘natildi”ni bosadi; bot mijozga xabar beradi. Bot jismoniy jo‘natishni o‘zi bajarmaydi. Rad etilgan chek uchun sabab yuborish mumkin. To‘lovsiz buyurtmalarni `/cancel` yoki admin orqali bekor qilish mumkin.

**Ommaviy xabar:** web panelda matn qoralamasi yarating. Video, rasm yoki post uchun Telegram admin hisobidan `/broadcast`, keyin bitta xabar yuboring/forward qiling. Qoralama panelda paydo bo‘ladi; admin “Hammaga yuborish”ni tasdiqlagach telefonini ulashgan faol foydalanuvchilarga yuboriladi. Himoyalangan post ko‘chirilmaydi; albom elementlari alohida xabarlar. Yuborildi/xato/navbatda sonlari panelda ko‘rinadi. Bir marta tasdiqlangan qoralama yana tarqatilmaydi.

Xabarlar SQLite navbatida saqlanadi, vaqtinchalik xatolarda qayta uriniladi va Telegram 429 kutish muddati hisobga olinadi. Botni bloklagan foydalanuvchilar nofaol belgilanadi. Xatoli xabarlarni paneldan qayta yuborish mumkin. Tarmoq uzilishi paytida Telegram xabarni qabul qilgan bo‘lsa, javob yo‘qolishi sababli qayta urinishda dublikat ehtimoli bor. Bitta token bilan faqat bitta backend nusxasini ishlating; webhook o‘rnatilgan bo‘lsa avval olib tashlang.

Bot bo‘limlari: natijalar, test topshirish, PDF kundalik, bosma kundalik, buyurtmalarim va yordam. `/id` — ID ko‘rish, `/cancel` — joriy jarayonni bekor qilish.

## Saqlash va himoya

SQLite fayli odatda `api/data/stepone.sqlite`da. `DATA_DIR` bilan doimiy papka belgilang. Bazani zaxiralashda SQLite backup usulidan foydalaning yoki xizmatni to‘xtatib data papkasini to‘liq ko‘chiring. Boshlang‘ich 12 savol faqat bo‘sh baza yaratilganda `api/src/seed.json`dan olinadi.

Admin sessiyasi HttpOnly/SameSite=Strict cookie orqali 8 soat ishlaydi; productionda Secure cookie. Parollar alohida scrypt xeshlari bilan tekshiriladi. Tasodifiy sessiya tokenining faqat SHA-256 xeshi SQLite’da saqlanadi. Logout sessiyani serverda bekor qiladi. Yozish so‘rovlarida Origin tekshiriladi. Login va natija yozishga tezlik cheklovi bor. Ballar public APIga berilmaydi. Eski test versiyasini topshirish yoki parallel admin oynasidan eskirgan saqlash 409 bilan rad etiladi. Serverdagi ADMIN_PHONE/ADMIN_PASSWORD yoki SESSION_SECRET o‘zgarsa backendni qayta ishga tushiring. Paneldagi alohida hisob va huquq o‘zgarishlari darhol ishlaydi.

Sayt testida tasodifiy ID, sana, ball, kategoriya va test versiyasi saqlanadi. Telegram bot foydalanuvchisining Telegram IDsi, ismi, username va ulashgan telefoni saqlanadi; natija shu hisobga bog‘lanadi. Buyurtmada manzil, summa, holat va Telegram chek fayli IDsi saqlanadi. Bu ma’lumotlar faqat autentifikatsiyadan o‘tgan admin panelida ko‘rinadi. SQLite fayli va zaxiralarini shaxsiy ma’lumot sifatida saqlang. Rate limit bitta Node jarayoni uchun; ko‘p nusxali hosting uchun Redis limit va umumiy baza qo‘shish kerak.

## Serverga chiqarish

Bu loyiha alohida NestJS jarayonini talab qiladi; Cloudflare Workers/Sites hostingiga o‘zgartirmasdan joylanmaydi. Internetga hozircha chiqarilmagan.

Serverda `api/.env`da `APP_ORIGIN=https://sizning-domeningiz.uz` yozing, so‘ng `api` va `web` papkalarida alohida `npm run build` va `npm start` ishga tushiring. Nginx/Caddy orqali HTTPS domeningizni `127.0.0.1:3000`ga yo‘naltiring. Production admin cookie HTTPS talab qiladi. Faqat frontend portini proxy qiling; backend porti yopiq qoladi. SQLite uchun `DATA_DIR` doimiy papkani ko‘rsating. Shriftlar tizimdan olinadi; tashqi shrift tarmoq so‘rovi yo‘q.

## Tekshiruv

`api` papkasida `npm test` — 37 test: test balli va validatsiyasi, telefon va Origin tekshiruvi, bot kontakt talabi, natijani hisobga bog‘lash, PDF/bosma buyurtmalar, admin tasdiqlashi, ommaviy xabarlar, takroriy update va navbat xatolaridan tiklanish. Telegram transporti testlarda soxta transport bilan almashtiriladi; haqiqiy foydalanuvchilarga test xabarlari yuborilmaydi. `npm run build` — NestJS va Next.js production build.

HTTP orqali qo‘shimcha tekshirildi: ruxsatsiz admin 401, login/logout, savol tahririning public APIga chiqishi, eskirgan versiya 409, noto‘g‘ri javob 400, 55 ball hisoblanishi va natija bazaga yozilishi, boshqa Origin 403. Brauzerda kirish sahifasi, testni boshlash va admin panel ko‘rildi. Mobil CSS mavjud; haqiqiy telefonlarda alohida sinov o‘tkazilmadi.

Loyiha tuzilishi: `web` — Next.js App Router; `api` — NestJS, server validatsiyasi, autentifikatsiya, SQLite.

Telegram qo‘shimchasi HTTP tekshiruvi: ruxsatsiz bot paneli 401, avtorizatsiyadan keyin 200, noto‘g‘ri savdo sozlamalari 400, natijalar va Telegram JOIN so‘rovi 200. Admin panel brauzerda tekshirildi. Haqiqiy Telegram yuborish tarmog‘i ushbu o‘zgarishda sinov xabarlari bilan tekshirilmagan.

Ulanish boshqaruvi HTTP tekshiruvi: ruxsatsiz o‘zgartirish 401, noto‘g‘ri token 400, avtorizatsiyalangan GET javobida ulanish ma’lumoti bor va token yo‘q. Tokenni almashtirish va bot ichidagi admin buyruqlari test Telegram transporti bilan tekshirildi.

## Admin hisoblari va bo‘lim huquqlari

**Admin → Adminlar** bo‘limida alohida hisob yarating. Saytga kirish uchun telefon/parol, botga kirish uchun Telegram ID kiriting. Bitta hisob ikkala yo‘nalishda ham ishlashi mumkin. Faqat Telegram IDsi bor hisob saytga parolsiz kira olmaydi.

Har bir hisob uchun mustaqil huquqlar: savollar va savol tarjimalari; sayt matnlari va tarjimalari; test natijalari; bot mijozlari; buyurtma/cheklar/yetkazish; ommaviy xabarlar; mahsulot/to‘lov sozlamalari; bot tokeni/ulanish; adminlarni boshqarish. Tayyor shablonlar: Operator, Kontent muharriri va To‘liq ruxsat. Adminlarni boshqarish huquqiga ega hisob boshqa admin huquqlarini ham o‘zgartira oladi — bu ishonchli boshqaruvchi roli.

Server har bir so‘rovda hisobning hozirgi huquqlarini tekshiradi. Ruxsat olinmagan ma’lumotlar bot dashboard javobida ham yashiriladi. Savol muharriri sayt metama’lumotlarini, sayt muharriri esa savollar/ballarni o‘zgartira olmaydi. Hisobni o‘chirish o‘rniga Nofaol qiling: mavjud sessiyasi ham darhol ishlamaydi. Parol yoki login telefoni o‘zgarsa sessiyalar bekor qilinadi.

Asosiy admin serverdagi ADMIN_PHONE/ADMIN_PASSWORD orqali tiklanadi, to‘liq huquqlari bloklanmaydi. Uning ismi va Telegram IDsi panelda tahrirlanadi. Avvalgi Telegram admin IDlari bir marta alohida hisoblarga ko‘chiriladi; keyinchalik adminlarni **Adminlar** bo‘limida boshqaring. Bot ulanishidagi eski ID ro‘yxati alohida huquq manbai bo‘lib qolmaydi. Botdagi /admin_add ID faqat admin boshqarish huquqi bor hisobga ishlaydi va yangi hisobga cheklangan bot operatori huquqlarini beradi (mijozlar va buyurtmalar). Kengaytirish panel orqali amalga oshiriladi.

## Til va ko‘rinish

Sayt va admin interfeysi: O‘zbek / Русский / English. Testning boshlang‘ich savollari va javoblari uch tilda mavjud. **Sayt sozlamalari** va **Savollar** ichidagi til yorliqlarida o‘z tarjimalaringizni kiriting. Bo‘sh tarjima uchun o‘zbekcha matn ko‘rsatiladi. Botning mijoz xabarlari hozircha o‘zbek tilida.

Yuqori panelda dark/light va til tugmalari bor. Ko‘rinish menyusida qurilmaga mos rang rejimi, ixcham ko‘rinish va yirik matn tanlanadi. Tanlov qurilmadagi localStorage’da saqlanadi. Boshlangan test progressi ham qurilmada saqlanadi, bir hafta ichida va shu test versiyasi uchun tiklanadi. Foydalanuvchi saqlangan testni × orqali bekor qilishi mumkin. Natija topshirilgach progress o‘chadi.

Admin panelida guruhlangan menyu, bo‘lim qidiruvi, tezkor kartalar, admin/mijoz/buyurtma/natija qidiruvi va buyurtma holat filtri bor. Telefonda menyu yig‘iladi. Og‘ir admin bo‘limlari next/dynamic bilan zarur paytda yuklanadi. Tashqi shrift va yangi UI kutubxonasi qo‘shilmagan. Ishlab chiqish serverining tezligi production tezligi sifatida o‘lchanmagan.

Huquqlarni HTTP orqali izolyatsiyalangan vaqtinchalik bazada tekshirish: api papkasida npm run build, so‘ng node scripts/check-access.cjs. Bu tekshiruv haqiqiy botga xabar yubormaydi va asosiy bazani o‘zgartirmaydi.
