// Разбор уроков отдельным процессом — мимо очереди dev-сервера.
//
// Запуск:
//   tsx scripts/write-lesson.mts <slug|--phase NN> [--from N] [--agent claude|codex]
//
// Зачем отдельный процесс: очередь агента (src/lib/agent/queue.ts) живёт в
// модуле, то есть на процесс. Всё, что запущено из dev-сервера, идёт по одному,
// и второй урок ждёт первого. Свой процесс — своя очередь, и два урока пишутся
// одновременно. Файлы у них разные, общего мутабельного состояния нет.
//
// Чего скрипт НЕ делает: не импортирует урок из курса. Импорт — это git и
// копирование файлов, его дешевле сделать кнопкой в каталоге или запросом к
// /api/catalog/import.
//
// Останавливается сам в двух случаях: исчерпан лимит (код 2) и серия таймаутов
// подряд (код 3). Второе означает упавшую сеть: агент ничего не отвечает, а
// каждый урок стоит десять минут ожидания — за ночь так набегает вся фаза,
// помеченная провалом без единой настоящей попытки.
import { isLimitError, isTimeoutError } from "../src/lib/agent/error-message.js";
import { defaultDeps } from "../src/lib/agent/factory.js";
import { loadConfig } from "../src/lib/config.js";
import { buildLesson } from "../src/lib/generate/build-lesson.js";
import { readCatalog } from "../src/lib/source/catalog.js";

/**
 * Сколько таймаутов подряд считать упавшей сетью, а не бедой одного урока.
 *
 * Три: одиночный таймаут случается и на живой сети — урок бывает тяжёлый, — а
 * три кряду означают, что отвечать некому.
 */
const MAX_TIMEOUTS_IN_ROW = 3;

interface Args {
  slugs: string[];
  from: number;
  agent: "claude" | "codex" | null;
}

function parseArgs(argv: string[]): Args {
  const slugs: string[] = [];
  let from = 0;
  let agent: Args["agent"] = null;
  let phase: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from") {
      from = Number(argv[++i]);
      continue;
    }
    if (arg === "--agent") {
      const value = argv[++i];
      if (value !== "claude" && value !== "codex") {
        throw new Error(`--agent принимает claude или codex, получено: ${value}`);
      }
      agent = value;
      continue;
    }
    if (arg === "--phase") {
      phase = argv[++i];
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Неизвестный ключ: ${arg}`);
    slugs.push(arg);
  }

  if (!Number.isInteger(from) || from < 0) throw new Error("--from ждёт целое число ≥ 0");

  if (phase) {
    // Номер фазы, а не её каталог: «--phase 6» короче и не заставляет помнить
    // полное имя. Берутся только импортированные уроки — исходник урока лежит
    // в source/, и без него писать нечего.
    const number = Number(phase);
    if (!Number.isInteger(number)) throw new Error("--phase ждёт номер фазы, например 6");
    const config = loadConfig();
    const found = readCatalog(config.sourceDir).find((item) => item.number === number);
    if (!found) throw new Error(`Фаза ${number} в source/ не найдена — сначала импортируй уроки`);
    slugs.push(...found.lessons.map((lesson) => lesson.slug));
  }

  if (slugs.length === 0) throw new Error("Не передан ни один урок: <slug> или --phase NN");
  // --from имеет смысл только для одного урока: у остальных свои планы, и
  // «начать с девятого» означало бы у каждого своё.
  if (slugs.length > 1 && from > 0) throw new Error("--from работает только с одним уроком");

  return { slugs, from, agent };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const agent = args.agent ?? config.agent;
  // Настройка агента из интерфейса (её держит progress.db) здесь намеренно не
  // читается: смысл скрипта — писать вторым агентом, пока первый занят.
  const deps = defaultDeps(config, { agent });

  console.log(`Агент: ${agent}. Уроков: ${args.slugs.length}.`);

  const failed: string[] = [];
  // Таймауты подряд. Один — случайность конкретного урока, серия — сеть.
  let timeouts = 0;
  for (const [index, slug] of args.slugs.entries()) {
    const position = `[${index + 1}/${args.slugs.length}]`;
    console.log(`\n${position} ${slug}`);
    try {
      const ids = await buildLesson({
        config,
        slug,
        fromIndex: args.from,
        all: true,
        deps,
        onProgress: (_stage, text) => console.log(`  ${text}`),
        onSoftError: (message) => console.warn(`  · ${message}`),
      });
      console.log(`  Готово: написано шагов ${ids.length}`);
      timeouts = 0;
    } catch (error) {
      // Исчерпанный лимит — единственная поломка, после которой продолжать
      // бессмысленно: следующий урок упадёт на первом же обращении к агенту.
      // Без этой остановки очередь прогорала вхолостую до последнего урока и
      // метила провалом те, к которым попытки, по сути, не было.
      if (isLimitError(error)) {
        console.error(`  Лимит исчерпан: ${(error as Error).message}`);
        console.error(
          `Очередь остановлена на ${slug}. Не начаты: ${args.slugs.length - index - 1}. ` +
            `Перезапусти тем же вызовом, когда лимит вернётся — написанное пропустится.`,
        );
        process.exitCode = 2;
        return;
      }
      // Прочая поломка одного урока остальных не отменяет: очередь длинная, и
      // падение на третьем не должно стоить оставшихся четырнадцати.
      console.error(`  Урок не разобрался: ${(error as Error).message}`);
      failed.push(slug);

      timeouts = isTimeoutError(error) ? timeouts + 1 : 0;
      if (timeouts >= MAX_TIMEOUTS_IN_ROW) {
        console.error(
          `Таймаутов подряд: ${timeouts} — похоже, сеть недоступна. Очередь остановлена на ${slug}. ` +
            `Не начаты: ${args.slugs.length - index - 1}. Перезапусти тем же вызовом, когда связь вернётся.`,
        );
        process.exitCode = 3;
        return;
      }
    }
  }

  if (failed.length > 0) {
    console.error(`\nНе разобрались: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

await main();
