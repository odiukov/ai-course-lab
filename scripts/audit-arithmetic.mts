// Проверка арифметики, записанной прямо в тексте шага.
//
// Запуск:
//   npm run audit:arithmetic
//   npm run audit:arithmetic -- --phase 10
//
// Зачем. Почти все числовые ошибки, которые находились в курсе вручную, имели
// одну форму: выражение и его результат стоят рядом в одной строке, и результат
// не сходится с операндами.
//
//     120/(120+40+40)=0,75          на деле 0,6
//     J=\frac{6}{26}\approx 0,23    объединение множеств равно 36, а не 26
//     58 × 7.95B ≈ 461B             блок весит 11.32B, значит 657B
//     2·4·32·128·256000·2 ≈ 8,4 ГБ  потерян множитель, выходит 16,8
//
// Такую ошибку видно без знания предметной области: достаточно посчитать. Здесь
// нет эвристики «похоже на опечатку» — есть арифметика, которая сходится или нет.
//
// Как устроено. Текст в курсе пишут цепочками: «6*8 + 7*9 = 48 + 63 = 111».
// Поэтому строка режется по знакам `=` и `≈`, вокруг каждого берётся самый
// длинный кусок, который разбирается как арифметика, и сравниваются соседние
// звенья. Так цепочка проверяется целиком, а не разваливается на куски.
//
// Чего проверка НЕ делает, и это стоит знать перед тем, как ей доверять:
//
//   - не считает то, что не записано формулой. «Блок весит 7.95B» в одном шаге
//     против формулы в другом — расхождение реальное, но арифметикой не ловится;
//   - не судит об операндах. В «J = 6/26 ≈ 0,23» деление выполнено верно;
//     ошибка была в самом знаменателе, а это уже предметное знание;
//   - не разбирает цепочки, где множитель стоит у каждого слагаемого
//     («≈ 4.2M + 16.8M ≈ 21M»): такое звено пропускается целиком;
//   - единицы объёма и проценты пропускает намеренно — см. UNVERIFIABLE ниже.
//
// Проверено внесением настоящих ошибок, которые находились вручную: подмена
// «0,6» на «0,75» в IDF1 и «44 млн» на «30 млн» у эксперта DeepSeek ловится.
import fs from "node:fs";
import path from "node:path";

const lessonsDir = path.resolve("content/lessons");
const phaseArg = process.argv.indexOf("--phase");
const phase = phaseArg === -1 ? null : process.argv[phaseArg + 1];

/** Множители у числа: «44 млн», «11.32B», «150 тысяч», «8%». */
const SCALES: Array<[RegExp, number]> = [
  [/^\s*(?:млрд|миллиард(?:а|ов)?|B(?![a-zA-Zа-яё])|трлн)/iu, 1e9],
  [/^\s*(?:млн|миллион(?:а|ов)?|M(?![a-zA-Zа-яё]))/iu, 1e6],
  [/^\s*(?:тыс\.?|тысяч(?:и|а)?)/u, 1e3],
];

/** Приводим KaTeX и типографику к виду, который умеет считать парсер. */
function normalize(source: string): string {
  return source
    .replace(/`+[^`\n]*`+/g, " ")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\(?:cdot|times)/g, "*")
    .replace(/\\approx/g, "≈")
    .replace(/\{,\}/g, ",")
    .replace(/\\ /g, " ")
    .replace(/\\%/g, "%")
    .replace(/\\[,;:!]/g, "")
    .replace(/\\(?:text|mathrm|mathit)\{([^{}]*)\}/g, "$1")
    .replace(/\^\{(\d+)\}/g, "^$1")
    .replace(/\\left|\\right/g, "")
    .replace(/[×·]/g, "*")
    // Тире в русском тексте — пунктуация, а не минус: «вес — 0,2/0,5».
    // Приводим только настоящий математический минус U+2212.
    .replace(/−/g, "-")
    .replace(/\$+|\\\(|\\\)|\\\[|\\\]/g, " ")
    // «2(0,8-1)» — умножение, которое в тексте не пишут знаком.
    .replace(/(\d|\))\s*\(/g, "$1*(")
    .replace(/÷/g, "/");
}

const THIN = String.raw`[ \u00a0\u202f]`;
const NUMBER = String.raw`\d{1,3}(?:${THIN}\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;

function toNumber(raw: string): number {
  return Number(raw.replace(/[ \u00a0\u202f]/gu, "").replace(",", "."));
}

/** Крошечный разбор арифметики. eval сюда не пускаем. */
function evaluate(text: string): number | null {
  const tokens = text.match(new RegExp(String.raw`${NUMBER}|[()+\-*/^]`, "gu"));
  const strip = (value: string) => value.replace(/\s/gu, "");
  if (!tokens || strip(tokens.join("")).length !== strip(text).length) return null;
  let position = 0;
  const peek = () => tokens[position];

  const primary = (): number | null => {
    const token = tokens[position];
    if (token === undefined) return null;
    if (token === "(") {
      position += 1;
      const inner = additive();
      if (peek() !== ")") return null;
      position += 1;
      return inner;
    }
    if (token === "-") {
      position += 1;
      const inner = primary();
      return inner === null ? null : -inner;
    }
    if (!/^\d/.test(token)) return null;
    position += 1;
    return toNumber(token);
  };
  const power = (): number | null => {
    const base = primary();
    if (base === null || peek() !== "^") return base;
    position += 1;
    const exponent = power();
    return exponent === null ? null : base ** exponent;
  };
  const multiplicative = (): number | null => {
    let value = power();
    while (value !== null && (peek() === "*" || peek() === "/")) {
      const operator = tokens[position];
      position += 1;
      const right = power();
      if (right === null || (operator === "/" && right === 0)) return null;
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const additive = (): number | null => {
    let value = multiplicative();
    while (value !== null && (peek() === "+" || peek() === "-")) {
      const operator = tokens[position];
      position += 1;
      const right = multiplicative();
      if (right === null) return null;
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };

  const result = additive();
  return position === tokens.length && result !== null && Number.isFinite(result) ? result : null;
}

interface Side {
  value: number;
  /** Единица за числом может относиться и к операндам: «16,8 + 4,2 = 41,9 млн». */
  scale: number;
  text: string;
  /** Половина последнего значащего разряда — на столько текст вправе округлить. */
  halfUlp: number;
}

/**
 * Чего проверить нельзя. Единицы объёма: слева байты, справа «16 ГБ», а двоичная
 * это система или десятичная — из текста не следует, и разница как раз такая,
 * что ошибку от конвенции не отличить. Проценты: в «0.9 × 2 + 0.1 × 30 = 4.8%»
 * операнды уже в процентах, множитель применять не к чему.
 *
 * Граница слова здесь просмотром вперёд, а не `\b`: в JavaScript `\b` считает
 * по ASCII, поэтому после кириллической «Б» границы не видит.
 */
const UNVERIFIABLE = /^\s*(?:%|(?:[КМГТ]и?Б|[KMGT]i?B|байт|bytes?|бит|bits?)(?![\p{L}\p{N}]))/iu;

function scaleAfter(tail: string): number {
  for (const [pattern, factor] of SCALES) if (pattern.test(tail)) return factor;
  return 1;
}

/**
 * Насколько грубо записано число: «0,67» — до 0.005, «44» — до 0.5.
 *
 * Округление — свойство записанного результата, а не вычисления. У выражения
 * вроде «120/(120+40+40)» допуска нет: оно считается точно. Раньше здесь брался
 * последний операнд, и допуск 0.5 от «40» перекрывал расхождение 0.6 против
 * 0.75 — та самая ошибка, ради которой проверка и писалась.
 */
function halfUlpOf(text: string): number {
  if (/[+\-*/^]/u.test(text.trim().replace(/^-/u, ""))) return 0;
  const last = /(\d[\d \u00a0\u202f]*)(?:[.,](\d+))?\s*$/u.exec(text.trim());
  if (!last) return 0;
  if (last[2]) return 0.5 * 10 ** -last[2].length;
  // У целого числа хвостовые нули незначащие: «≈ 1 000 000» округляет грубо,
  // а «≈ 22» — до единицы. Отсюда и разный спрос с этих двух записей.
  const digits = last[1].replace(/[ \u00a0\u202f]/gu, "");
  const trailingZeros = /0*$/u.exec(digits)?.[0].length ?? 0;
  return 0.5 * 10 ** trailingZeros;
}

const MAX_SPAN = 70;

/** Самый длинный разбираемый кусок слева от знака равенства. */
function leftSide(text: string): Side | null {
  const window = text.slice(Math.max(0, text.length - MAX_SPAN));
  for (let start = 0; start < window.length; start += 1) {
    // Начало куска не должно резать переменную пополам: в «2x_1+2+2»
    // подстрока «1+2+2» арифметикой не является.
    if (start > 0 && /[\p{L}_\d]/u.test(window[start - 1] ?? "")) continue;
    // Смотрим назад по непрерывному куску без пробелов: если там переменная,
    // это формула вида «2x_1 + 2 + 2 = 8», и подвыражение «2 + 2» ни при чём.
    // Пробел обрывает просмотр, поэтому слова из прозы (IDF1, float32) не мешают.
    const run = /[^\s=≈]*$/u.exec(window.slice(0, start))?.[0] ?? "";
    if (/[\p{L}_]/u.test(run)) continue;
    const candidate = window.slice(start).trim();
    if (!/^[-\d(]/u.test(candidate) || !/\d\s*\)?$/u.test(candidate)) continue;
    // Знак равенства в тексте чаще присваивание («шаг = 3»), чем утверждение.
    // Проверять есть смысл только вычисление, то есть хотя бы один оператор.
    if (!/[\d)]\s*[+\-*/^]/u.test(candidate)) continue;
    const value = evaluate(candidate);
    if (value !== null) return { value, scale: 1, text: candidate, halfUlp: halfUlpOf(candidate) };
  }
  return null;
}

/** Самый длинный разбираемый кусок справа плюс единица измерения за ним. */
function rightSide(text: string): Side | null {
  const window = text.slice(0, MAX_SPAN);
  for (let end = window.length; end > 0; end -= 1) {
    const candidate = window.slice(0, end).trim();
    if (!/^[-\d(]/u.test(candidate) || !/\d\s*\)?$/u.test(candidate)) continue;
    const value = evaluate(candidate);
    if (value === null) continue;
    const tail = window.slice(end);
    if (UNVERIFIABLE.test(tail)) return null;
    // «= 2H» — переменная, а не результат. Единицу измерения при этом пропускаем:
    // «44 млн» и «16 ГБ» — законная запись.
    if (/^[\p{L}_]/u.test(tail) && scaleAfter(tail) === 1) return null;
    const scale = scaleAfter(tail);
    return { value, scale, text: candidate, halfUlp: halfUlpOf(candidate) };
  }
  return null;
}

interface Problem {
  lesson: string;
  step: string;
  line: number;
  left: string;
  right: string;
  leftValue: number;
  rightValue: number;
}

/**
 * Места, где расхождение стоит намеренно и правилом не отличается от ошибки.
 * Ключ — урок и шаг; список короткий именно потому, что остальное ловится
 * правилами выше.
 */
const ALLOWED: Array<[string, string, string]> = [
  [
    "01-math-foundations__01-linear-algebra-intuition/051-numpy.md",
    "12 * 12",
    "«если калькулятор выдаст, что 12 × 12 = 1444» — пример неверного ответа",
  ],
  [
    "01-math-foundations__13-numerical-stability/065-nedeterminizm-gpu.md",
    "100000000 + ((-100000000) + 1)",
    "порядок сложения меняет результат — в этом и смысл шага",
  ],
  [
    "06-speech-and-audio__13-neural-audio-codecs/005-rvq.md",
    "1024^8",
    "1024^8 ≈ 10^24 — оценка порядка величины, а не равенство",
  ],
  [
    "12-multimodal-ai__05-llava-visual-instruction-tuning/016-param-economy.md",
    "1024 * 4096 + 4096 * 4096",
    "звено цепочки записано в миллионах, а слагаемые — в штуках",
  ],
  [
    "14-agent-engineering__04-tree-of-thoughts-lats/001-pryamaya-liniya.md",
    "12 * 8",
    "«12 × 8 = 86» — галлюцинация модели, которую шаг и разбирает",
  ],
];

function isAllowed(lesson: string, step: string, expression: string): boolean {
  return ALLOWED.some(([where, expr]) => where === `${lesson}/${step}` && expression === expr);
}

const problems: Problem[] = [];
let checked = 0;

for (const entry of fs.readdirSync(lessonsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (phase && !entry.name.startsWith(phase)) continue;
  const stepsDir = path.join(lessonsDir, entry.name, "steps");
  if (!fs.existsSync(stepsDir)) continue;

  for (const file of fs.readdirSync(stepsDir).filter((name) => name.endsWith(".md")).sort()) {
    const source = fs.readFileSync(path.join(stepsDir, file), "utf8");
    const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(source);
    const skipLines = frontmatter ? frontmatter[0].split("\n").length - 1 : 0;

    source.split("\n").forEach((rawLine, index) => {
      if (index < skipLines) return;
      const line = normalize(rawLine);
      // Логарифмы, корни и суммы — не плоская арифметика: считать такую
      // строку по операторам бессмысленно, аргумент функции примут за слагаемое.
      if (/\\(?:ln|log|exp|sqrt|sin|cos|tan|max|min|sum|prod|int)(?![a-z])/u.test(rawLine)) return;
      for (const sign of line.matchAll(/[=≈]/gu)) {
        const at = sign.index ?? 0;
        if (line[at - 1] === "=" || line[at + 1] === "=" || line[at + 1] === "≈") continue;
        const beforeSign = line.slice(0, at);
        const afterSign = line.slice(at + 1);

        // `\exp(-4) ≈ 0,018` — это значение функции, а не арифметика в скобках.
        if (/(?:[A-Za-zА-Яа-яёΑ-Ωα-ω}]|\\[a-z]+)\s*\([^()]*\)\s*$/u.test(beforeSign)) continue;

        const left = leftSide(beforeSign);
        const right = rightSide(afterSign);
        if (!left || !right) continue;

        checked += 1;
        // Текст вправе округлять: допуск — половина последнего разряда обеих
        // записей плюс 0.5% на накопленное округление в длинной цепочке.
        // «=» требует точности, «≈» разрешает округлить: «1024 * 10 ≈ 10 000».
        // Спрос задаёт точность записи, а не плоский процент: «≈ 22 млн» обязано
        // сойтись до единицы миллионов, «≈ 1 000 000» — лишь до порядка.
        const relative = sign[0] === "≈" ? 0.005 : 0.001;
        // Множитель у результата может относиться и к операндам, и только к нему.
        // Придираемся, лишь если не сходится ни одно прочтение.
        const fits = [1, right.scale].some((scale) => {
          const stated = right.value * scale;
          const tolerance =
            Math.max(left.halfUlp, right.halfUlp * scale) +
            relative * Math.max(Math.abs(left.value), Math.abs(stated));
          return Math.abs(left.value - stated) <= tolerance;
        });
        if (fits) continue;

        if (isAllowed(entry.name, file, left.text)) continue;
        problems.push({
          lesson: entry.name,
          step: file,
          line: index + 1,
          left: left.text.slice(-50),
          right: right.text.slice(0, 30),
          leftValue: left.value,
          rightValue: right.value * right.scale,
        });
      }
    });
  }
}

const format = (value: number) =>
  Math.abs(value) >= 1e7 || (Math.abs(value) < 1e-4 && value !== 0)
    ? value.toExponential(3)
    : String(Math.round(value * 1e6) / 1e6);

console.log(JSON.stringify({ checkedEqualities: checked, problems: problems.length }, null, 2));

if (problems.length > 0) {
  console.error(`\nАрифметика не сходится: ${problems.length}`);
  for (const problem of problems) {
    console.error(`- ${problem.lesson}/steps/${problem.step}:${problem.line}`);
    console.error(
      `    «${problem.left}» = ${format(problem.leftValue)}, а записано «${problem.right}» = ${format(problem.rightValue)}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log("\nВся записанная в тексте арифметика сходится.");
}
