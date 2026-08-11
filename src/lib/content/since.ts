const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Русское склонение по числу: 1 день, 2 дня, 5 дней.
 *
 * Отдельная ветка на 11–14 обязательна: они кончаются на 1–4, но берут форму
 * «дней», а не «день»/«дня».
 */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n % 100 >= 11 && n % 100 <= 14) return many;
  const last = n % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/**
 * «Сколько прошло» по-русски, для строки каталога.
 *
 * Точная дата там не нужна и мешает: вопрос у строки один — насколько
 * несвежий у меня урок, и «11 дней назад» отвечает на него быстрее, чем
 * «11.08.2026», которое ещё надо вычесть из сегодняшнего.
 */
export function since(iso: string, now: Date = new Date()): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "";

  const elapsed = now.getTime() - at;
  if (elapsed < 0) return "только что";
  if (elapsed < HOUR) return "только что";
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  }

  const days = Math.floor(elapsed / DAY);
  if (days === 1) return "вчера";
  return `${days} ${plural(days, "день", "дня", "дней")} назад`;
}
