import type { Config } from "./domain";

export function maximumScore(config: Config) {
  return config.questions.filter(q => q.type === "scored")
    .reduce((sum, q) => sum + Math.max(...q.options.map(o => o.score)), 0);
}

export function resultMessage(score: number, maxScore: number | null) {
  if (!maxScore || !Number.isFinite(score))
    return `Test natijangiz: ${score} ball.\nFoizli tahlil uchun testni qayta topshiring.\n\nO'zgarish kundaligiga buyurtma berish uchun quyidagi tugmani bosing.`;
  const percent = Math.max(0, Math.min(100, Math.round(score / maxScore * 100)));
  const text = percent >= 75 ? good : percent >= 45 ? medium : low;
  const label = percent >= 75 ? "Intizomingiz yaxshi" : percent >= 45
    ? "Intizomni kuchaytirish kerak" : "O'zgarishni boshlash vaqti keldi";
  return `<b>Natijangiz: ${percent}% — ${label}</b>\n\n${text}`;
}

const good = `🟢 <b>Intizomingiz yaxshi, lekin hali yanada yuqori natijalarga erishishingiz mumkin!</b>
Natijangiz yaxshi. Siz vaqtingizni boshqarish, maqsadlaringiz sari harakat qilish va kundalik vazifalarni bajarishda ancha yaxshi natijaga egasiz.
Lekin bir savol bor:
<b>Hozirgi tartibingiz bilan 1 yil davomida davom etsangiz, o'zingiz istagan inson darajasiga erisha olasizmi?</b>
Sizda yaxshi poydevor bor. Endi uni yanada mustahkamlash va har kuni o'z ustingizda ishlashni tizimga solish vaqti keldi.
<b>O'zgarish kundaligi sizga quyidagilarda yordam beradi:</b>
• Kunlik rejalaringizni tartibga solish
• Maqsadlaringizni belgilash va kuzatish
• Foydali odatlarni shakllantirish
• Vaqtingizdan unumli foydalanish
• Har kungi natijalaringizni tahlil qilish
• 30 kun davomida o'zgarishingizni kuzatish
<i>Intizomni saqlash ham uni shakllantirish kabi muhim.</i>
<b>Bugungi tartibingizni ertangi muvaffaqiyatingizga aylantiring!</b>
Quyidagi tugmani bosib, O'zgarish kundaligiga buyurtma bering.`;

const medium = `🟡 <b>Sizda harakat bor, ammo izchillik yetishmayapti!</b>
Natijangiz shuni ko'rsatadiki, siz o'zgarishni xohlaysiz va ba'zida yaxshi natijalarga ham erishasiz.
Ammo rejalaringiz doim ham amalga oshmaydi. Ba'zi kunlari faol bo'lasiz, boshqa kunlari esa vaqt qanday o'tib ketganini sezmay qolasiz.
O'zingizga bergan va'dalaringiz qanchalik tez-tez bajarilmay qoladi?
Muammo sizda imkoniyat yo'qligida emas. Muammo — har kungi harakatlaringizni nazorat qiladigan aniq tizim yo'qligida bo'lishi mumkin.
<b>O'zgarish kundaligi sizga quyidagilarda yordam beradi:</b>
• Har kuningizni oldindan rejalashtirish
• 30 kunlik maqsadlar belgilash
• Yangi foydali odatlar shakllantirish
• Dangasalik va chalg'ituvchi narsalarni nazorat qilish
• Kun yakunida o'z natijalaringizni baholash
• Intizom va mas'uliyatni kuchaytirish
Sizga yana bir motivatsion video yoki vaqtinchalik ilhom emas, har kuni amal qiladigan oddiy tizim kerak.
<b>O'zgarishni keyinga qoldirmang. Bugun boshlang!</b>
Quyidagi tugmani bosib, O'zgarish kundaligiga buyurtma bering.`;

const low = `🔴 <b>Sizga hayotingizda jiddiy o'zgarish kerak!</b>
Diagnostika natijangiz kundalik hayotingizda reja, tartib va izchillik yetishmayotganini ko'rsatmoqda.
Bir o'ylab ko'ring:
• Kun davomida ko'p vaqt sarflaysiz, lekin muhim ishlaringiz bajarilmay qoladi.
• Maqsadlar qo'yasiz, ammo ularni amalga oshirishni ortga surasiz.
• Yangi odatlarni boshlaysiz, lekin davom ettira olmaysiz.
• Kun oxirida bugun nima foydali ish qilganingizni ham aniq aytish qiyin.
Eng achinarlisi, bugungi kunlaringiz shu tarzda o'taversa, 1 yildan keyin ham aynan shu muammolar bilan yashashingiz mumkin.
Lekin buni o'zgartirish hali kech emas!
<b>O'zgarish kundaligi aynan birinchi qadamni tashlashingiz uchun yaratilgan.</b>
U sizga:
• Har kuningizni rejalashtirish
• O'z oldingizga aniq maqsadlar qo'yish
• 8 ta kunlik odatingizni kuzatish
• Foydasiz odatlardan voz kechish
• Kunlik natijalaringizni tahlil qilish
• 30 kun davomida o'zingizni nazorat qilishda yordam beradi.
Sizga murakkab rejalar kerak emas. Sizga har kuni amal qilinadigan oddiy tizim kerak.
<b>Hayotingiz o'z-o'zidan o'zgarmaydi. O'zgarish bugungi qaroringizdan boshlanadi!</b>
Quyidagi tugmani bosing va O'zgarish kundaligiga buyurtma bering.`;
