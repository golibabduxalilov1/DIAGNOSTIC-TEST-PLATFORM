// Shared by the dashboard preview and API. Only Telegram's supported subset is accepted.
export function telegramHtmlError(html: string, limit = 3800): string | null {
  if (!html.trim() || html.length > limit) return `Matn 1–${limit} belgi bo‘lsin.`;
  const stack: string[] = [];
  for (const token of html.match(/<[^>]*>|[^<]+|</g) || []) {
    if (!token.startsWith('<')) {
      if (/[<>]|&(?!lt;|gt;|amp;|quot;|#\d+;|#x[0-9a-fA-F]+;)/.test(token))
        return 'Maxsus belgilar uchun &lt;, &gt; va &amp; ishlating.';
      continue;
    }
    const close = token.match(/^<\/(b|i|u|s|blockquote|code|pre|tg-spoiler|a|tg-time)>$/);
    if (close) {
      if (stack.pop() !== close[1]) return 'Format teglari to‘g‘ri yopilmagan.';
      continue;
    }
    let tag = token.match(/^<(b|i|u|s|blockquote|code|pre|tg-spoiler)>$/)?.[1];
    const link = token.match(/^<a href="([^"<>]+)">$/);
    if (link) {
      try {
        const url = new URL(link[1].replace(/&amp;/g, '&'));
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
          return 'Havola http:// yoki https:// bilan boshlansin.';
      } catch { return 'Havola noto‘g‘ri.'; }
      tag = 'a';
    }
    if (/^<tg-time unix="\d{1,12}">$/.test(token)) tag = 'tg-time';
    if (!tag) return 'Qo‘llab-quvvatlanmaydigan format. Format tugmalaridan foydalaning.';
    if ((['code','pre'].includes(tag) && stack.length) || stack.some(t => ['code','pre'].includes(t)) ||
        (tag === 'blockquote' && stack.includes(tag)) || (tag === 'a' && stack.includes(tag)))
      return 'Bu formatlarni bir-birining ichiga joylashtirib bo‘lmaydi.';
    stack.push(tag);
  }
  return stack.length ? 'Format teglari to‘g‘ri yopilmagan.' : null;
}

export function escapeTelegramText(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
