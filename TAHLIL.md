# Manba sayt tahlili

Manba: https://steponeplanner.uz/test/index.php — 2026-11-01 kuni ochiq sahifa ko‘rinishi va brauzerga beriladigan HTML/JavaScript tekshirildi. Ichki server kodi, admin qismi, bot suhbatlari va yopiq bazalar ochiq emas; ularning mavjudligi yoki ishlashi haqida xulosa qilinmadi.

## Foydalanuvchi oqimi

1. Kirish: bitta sarlavha, 12 savol / taxminan 3 daqiqa tavsifi va boshlash tugmasi.
2. Savollar: har ekranda bitta savol, javob variantlari, orqaga tugmasi, savol raqami va segmentli progress. Variant tanlansa keyingi savolga avtomatik o‘tadi. Oldingi javob qayta tanlanishi mumkin.
3. Yakun: tayyor natija xabari, Telegramga o‘tish va testni qayta boshlash.

## Kontent va hisoblash

12 savol mavjud: 11 tasi odatlar, rejalash, fokus, moliya va maqsadlar bo‘yicha 0/3/5 ball beradi. Maksimal yig‘indi 55. To‘qqizinchi savol olti yo‘nalishdan birini tanlatadi: vaqt, maqsad, moliya, fokus, ish, sog‘liq. Bu savol ballga qo‘shilmaydi. Savollar hozirgi manbada JavaScript massiviga yozilgan.

Natija saytda ko‘rsatilmaydi. Ball va kategoriya `t_<ball>_<kategoriya>` shaklida Telegram deep-link argumentiga joylanadi. Manba StepOneUzBot botiga yo‘naltiradi; bu tugmani bosishning o‘zi botning javob yuborishini kafolatlamaydi.

## Dizayn va texnika

To‘q ko‘kimtir fon, xira radial yorug‘lik, oq serif sarlavhalar, sans-serif matn, ko‘k gradient tugma. Kontent markazda 660–700 px atrofida. Katta ekranlarda olti variantli savol ikki ustun bo‘ladi; kichik ekranlarda bitta ustun. Reduced-motion sozlamasiga mos animatsiya qoidalari bor. Google Fonts: Fraunces va Inter. Ochiq HTMLda Meta Pixel skripti mavjud; yangi loyihaga uchinchi tomon kuzatuvi ko‘chirilmagan.

Manbada ball brauzerda hisoblanadi va deep-link ichida ochiq uzatiladi. Ushbu qayta ishlangan variantda yakuniy ball NestJSda qayta hisoblanadi; savol konfiguratsiyasi serverda saqlanadi. Telegram deep-link baribir foydalanuvchi o‘zgartira oladigan havola bo‘lgani sababli uni tasdiqlangan sertifikat yoki to‘lov huquqi uchun ishlatmaslik kerak.

## Tayyorlangan variantdagi qo‘shimchalar

Next.js frontend va NestJS backend; parolli admin panel; savol/variant/ball/tartib boshqaruvi; sahifa matnlari va Telegram bot sozlamalari; SQLite saqlash; yakunlangan testlar statistikasi; server validatsiyasi va versiya nazorati. Boshlang‘ich savollar manbadagi oqimni takrorlash uchun kiritilgan va admin orqali to‘liq almashtirilishi mumkin.
