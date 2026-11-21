# Xavfsizlik tekshiruvi — 2026-11-21

Mahalliy Next.js/NestJS kodi, SQL so‘rovlari, admin ruxsatlari, sessiyalar, Telegram oqimlari, fayl yuklash/yuklab olish, Caddy sozlamalari va npm bog‘liqliklari tekshirildi. O‘zgarishlar shu checkoutga yozildi. Ommaviy serverga deploy yoki tashqi pentest bajarilmadi; Git metama’lumotlari mavjud emas, shuning uchun tarixdagi sirlarni tekshirish imkoni bo‘lmadi. Joylash sozlamalari keyinchalik Node.js va mahalliy PostgreSQL uchun moslashtirildi; quyidagi tekshiruv dalillari dastlabki auditga tegishli.

## Topilgan va tuzatilgan muammolar

| Muammo | Tuzatish |
| --- | --- |
| Frontendda CSP va clickjacking himoyasi yo‘q | Har javobga 32 baytli nonce; production skriptlarida `unsafe-inline`/`unsafe-eval` yo‘q. `frame-ancestors 'none'`, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy. Nonce uchun dinamik render va private/no-store. |
| Login faqat IP bo‘yicha cheklangan | IPga 6/minut; normallashtirilgan telefon hisobiga 20/15 daqiqa. Hisob limiti PostgreSQLda saqlanadi, IP almashtirish yoki API restarti uni tozalamaydi. Telefonlar limit jadvalida SHA-256 bilan saqlanadi. |
| Sinxron scrypt event loopni to‘sadi | Asinxron scrypt va bir vaqtda ko‘pi bilan 4 parol operatsiyasi. Login va hisob yangilanishi tranzaksiyaga olindi, login qatori qulflanadi. |
| Barcha API yo‘llarida umumiy limit yo‘q | Jarayon/IP uchun 180/minut; xotiradagi cheklagich 10 000 kalitdan oshmaydi va to‘lganda yangi kalitlarni rad etadi. Cross-site Fetch Metadata so‘rovlari rad qilinadi. |
| Ayrim catch bloklari istalgan xato matnini qaytaradi | Faqat `InputError` biznes xatolari va HTTP xatolari qaytariladi; ichki DB/tarmoq xatolari umumiy 500 javobga aylantiriladi. |
| Cheklar tashqi Content-Type bilan inline ochiladi va cheksiz buferlanadi | PDF/PNG/JPG bayt imzosi tekshiriladi, oqim 10 MB bilan cheklanadi, attachment + sandbox + nosniff ishlatiladi. Yuklab olish redirectlari rad qilinadi. Imzo tekshiruvi antivirus o‘rnini bosmaydi. |
| Sozlamalarda begona maydonlar va noto‘g‘ri ichki obyektlar qabul qilinadi | Ruxsatli maydonlar ro‘yxati; rezerv IDlar va prototipdan meros javoblar rad qilinadi. Ommaviy savol javobida faqat ruxsatli maydonlar beriladi. |
| Parallel to‘lov tasdiqlari bir holatni ikki marta o‘qishi mumkin | Buyurtmani tekshirishda `SELECT ... FOR UPDATE`; takroriy PDF navbatga qo‘yilmaydi. |
| HTTP yuklamasi va upload xotirasi cheklovlari yetarli emas | JSON 256 KB; Caddy 55 MB; broadcast fayllari uchun bir vaqtda ko‘pi bilan 2 upload; HTTP header/body timeoutlari. |
| Ilova portlari tashqi tarmoqqa ochilmasligi kerak | API/web localhostda tinglaydi. Domen Caddy proxyi APIga bitta mijoz IPsini uzatadi; server yo‘riqnomasida `TRUST_PROXY_HOPS=1` belgilangan. |
| Kuchsiz production paroli yoki HTTP origin bilan start mumkin | Production admin paroli 12–200 belgi; namuna qiymatlari rad qilinadi; APP_ORIGIN aniq HTTPS origin bo‘lishi shart. |

Mavjud himoyalar ham tekshirildi: parametrli SQL, HttpOnly/Secure/SameSite=Strict cookie, serverda xeshlangan sessiya tokenlari, sessiya bekor qilinishi, rol/ruxsat nazorati va Telegram kontakt egasini tekshirish.

## Tekshiruv dalillari

- `npm test`: 50/50 test o‘tdi, PostgreSQL testlari alohida vaqtinchalik sxemalarda bajarildi.
- `npm run build`: backend TypeScript va frontend production build o‘tdi.
- `npm run check:access`: hisob ruxsatlari, shaxsiy ma’lumotlar filtrlanishi, ruxsat bekor qilinishi va logout o‘tdi.
- `npm run check:production`: auth, CSRF/Origin, noto‘g‘ri/katta JSON, begona config maydonlari, xavfsizlik headerlari, cookie va IP/hisob limitlari o‘tdi. Bot tokeni o‘chirilgan, baza ajratilgan.
- `npm run check:web-security`: har javobning nonce qiymati yangi, barcha framework/inline scriptlar nonce bilan, client yuborgan CSP almashtiriladi, productionda unsafe script siyosati yo‘q.
- Brauzerda production bosh sahifa va login sahifasi yuklandi, React ishladi, CSP sababli sahifa yuklash xatolari kuzatilmadi. Alohida headless Chrome sinovida ilova bergan CSP bilan oddiy nonce-siz HTML script bloklandi, ruxsatli nonce script ishladi.
- `npm audit --json`: API va web uchun 0 ma’lum zaiflik. Bu barcha noma’lum zaifliklar yo‘qligini anglatmaydi.

## Serverga chiqarish

Mahalliy `.env`dagi mavjud admin paroli 8 belgili. U o‘zgartirilmadi. Productionga chiqarishdan oldin `ADMIN_PASSWORD`ni kuchli 12–200 belgili qiymatga almashtiring; owner paroli o‘zgarsa eski owner sessiyalari bekor qilinadi. Sirlar hisobotga yoki logga chiqarilmadi.

`npm run build`dan keyin API/webni production muhitida qayta ishga tushiring. API yangi `002_login_limits.sql` migratsiyasini avtomatik bajaradi; avval bazani zaxiralang. Mavjud host TLS proxyiga `deploy/domain-proxy.Caddyfile` namunasidagi yo‘llar va HSTS headerini qo‘shing, konfiguratsiyani tekshirib qayta yuklang. Proxy zanjiri haqiqiy serverda tekshirilishi kerak. Batafsil: `deploy/README.md`.

Umumiy API/IP va upload limitlari bitta jarayon ichida; bir nechta API nusxasi yoki katta trafik uchun edge/distributed limit ham kerak bo‘ladi. Kirishning hisob limiti esa umumiy PostgreSQLda saqlanadi. PostgreSQL xizmatining tashqi tarmoqqa ochilmaganini, TLS sertifikatini, firewallni, zaxiralarni va serverdagi amaldagi secretlarni deploy muhitida alohida tekshiring. Ushbu tekshiruv mutlaq xavfsizlik kafolati emas.

## Manbalar

- [Next.js CSP va nonce qo‘llanmasi](https://nextjs.org/docs/app/guides/content-security-policy)
- [Express production xavfsizlik amaliyotlari](https://expressjs.com/en/advanced/best-practice-security/)
- [Caddy trusted proxy sozlamalari](https://caddyserver.com/docs/caddyfile/options#trusted-proxies)
