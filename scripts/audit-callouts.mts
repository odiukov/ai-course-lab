// Врезки «На пальцах», которые перезапускают образ из тела своего же шага.
//
// Запуск:
//   npm run audit:callouts
//   npm run audit:callouts -- --phase 14
//
// Зачем. Правило в prompts/write-step.md раньше прямо предписывало «подхвати
// образ, уже начатый в основном тексте». Получалось, что тело вводит сцену, а
// врезка проходит по ней второй раз:
//
//     ТЕЛО:   «Ты как будто выделил маркером не три абзаца, а сразу всё.»
//     ВРЕЗКА: «Выдели маркером в договоре одну строчку — глаз находит её мгновенно…»
//
// Читателю это даёт не вторую опору, а повтор. Правило исправлено, но раньше
// написанные шаги остались, и находить их удобнее списком.
//
// ЭТО ОТЧЁТ, А НЕ ВОРОТА. Код возврата всегда 0. Признак — совпадение корня
// предмета врезки со словом в теле, и он ошибается примерно в половине случаев:
// ловит омонимы («методы в редакторе» про редактор кода против «Представь
// редактора» про человека) и обычные слова, попавшие в предложение со
// сравнением. Поэтому список нужно просматривать, а не применять механически.
// Проверено чтением: из девяти случайных находок настоящими оказались четыре.
import fs from "node:fs";
import path from "node:path";

const lessonsDir = path.resolve("content/lessons");
const phaseArg = process.argv.indexOf("--phase");
const phase = phaseArg === -1 ? null : process.argv[phaseArg + 1];

const BLOCK = /^> 🎒 \*\*На пальцах\.\*\*(.*(?:\n>.*)*)/m;

/** Зачин врезки снимаем, чтобы добраться до предмета сцены. */
const OPENING = /^\s*(?:Представь(?:,)?\s+(?:себе\s+)?(?:что\s+(?:ты\s+)?)?|Это\s+как\s+|Как\s+|Ты\s+)?([а-яё]{6,})/i;

/**
 * Предложение в теле считается образом, только если в нём есть сравнение.
 *
 * Границы слова здесь просмотрами, а не \b: в JavaScript \b считает по ASCII и
 * на кириллице не срабатывает вовсе — «как будто» мимо \bкак\b проходит молча.
 */
const SIMILE = /(?<!\p{L})как(?!\p{L})|похож|словно|представь|вроде/iu;

/** Слова, которые встречаются в любом шаге и потому ничего не говорят. */
const COMMON = new Set(
  `модель модели данных значение значения функция функции вектор матрица токен токены слой сеть
   градиент ошибка ошибки шаг шага шагов пример примера примеры число числа список текст текста
   строка строки результат результата параметр параметры задача задачи ответ ответа система
   запрос запроса память время работа работы часть части набор набора порядок правило правила
   человек человека сначала теперь каждый каждая каждое который которая которое`
    .split(/\s+/)
    .filter(Boolean),
);

function stem(word: string): string {
  return word.slice(0, Math.max(5, word.length - 2));
}

interface Finding {
  file: string;
  subject: string;
  body: string;
  callout: string;
}

const findings: Finding[] = [];
let callouts = 0;

for (const entry of fs.readdirSync(lessonsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (phase && !entry.name.startsWith(phase)) continue;
  const stepsDir = path.join(lessonsDir, entry.name, "steps");
  if (!fs.existsSync(stepsDir)) continue;

  for (const file of fs.readdirSync(stepsDir).filter((name) => name.endsWith(".md")).sort()) {
    const source = fs.readFileSync(path.join(stepsDir, file), "utf8");
    const type = /^type:\s*(\S+)/m.exec(source)?.[1];
    if (type !== "theory" && type !== "code") continue;

    const parts = source.split("---");
    const body = parts.length > 2 ? parts.slice(2).join("---") : source;
    const match = BLOCK.exec(body);
    if (!match) continue;
    callouts += 1;

    const before = body.slice(0, match.index);
    const callout = match[1].replace(/\n>\s*/g, " ").trim();
    const subject = OPENING.exec(callout)?.[1]?.toLowerCase();
    if (!subject || COMMON.has(subject) || subject.startsWith("представ")) continue;

    const root = new RegExp(stem(subject), "i");
    for (const sentence of before.split(/(?<=[.!?])\s+/)) {
      if (!root.test(sentence) || !SIMILE.test(sentence)) continue;
      findings.push({
        file: `${entry.name}/steps/${file}`,
        subject,
        body: sentence.replace(/\s+/g, " ").trim().slice(0, 160),
        callout: callout.slice(0, 160),
      });
      break;
    }
  }
}

console.log(JSON.stringify({ callouts, candidates: findings.length }, null, 2));

if (findings.length > 0) {
  console.log(`\nВрезки, где образ мог прийти из тела — ${findings.length} шт. Примерно половина`);
  console.log("совпадений случайна, поэтому список читают, а не применяют механически.\n");
  for (const finding of findings) {
    console.log(`- ${finding.file}  (предмет: ${finding.subject})`);
    console.log(`    ТЕЛО  : ${finding.body}`);
    console.log(`    ВРЕЗКА: ${finding.callout}`);
  }
} else {
  console.log("\nВрезок, повторяющих образ из тела, не нашлось.");
}
