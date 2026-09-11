// Проверка формул в шагах — ловит прозу, утянутую в математику.
//
// Запуск:
//   npm run audit:math
//   npm run audit:math -- --phase 17
//
// Зачем. Знак `$` для remark-math открывает формулу, поэтому денежная сумма,
// написанная в тексте как `$10 000`, схлопывает всё до следующего `$` в
// inlineMath. На странице пропадают и знаки доллара, и проза между ними:
//
//     ВХОД : Ошибка на $10 000, а для одного особняка — на $50 000.
//     [inlineMath] содержимое: "10 000, а для одного особняка — на "
//
// Автор такую поломку не видит: markdown в редакторе выглядит нормально.
// Лечится экранированием — `\$10 000` в прозе; внутри формул `$...$` это не
// работает, там спан всё равно закрывается на первом же долларе.
//
// Проверка разбирает шаг тем же конвейером, что и сайт (normalizeMath, затем
// remark-gfm и remark-math), и смотрит на получившиеся формульные узлы. Судим
// по содержимому: русская проза внутри формулы — это захват, а не математика.
import fs from "node:fs";
import path from "node:path";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { normalizeMath } from "../src/lib/site/markdown.js";

interface MathNode {
  type: string;
  value: string;
}

interface Problem {
  lesson: string;
  step: string;
  line: number;
  kind: string;
  value: string;
}

const lessonsDir = path.resolve("content/lessons");
const phaseArg = process.argv.indexOf("--phase");
const phase = phaseArg === -1 ? null : process.argv[phaseArg + 1];

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** Тело шага без frontmatter и длина отрезанного куска. */
function splitFrontmatter(source: string): { body: string } {
  const match = /^---\n[\s\S]*?\n---\n/.exec(source);
  return { body: match ? source.slice(match[0].length) : source };
}

/** Узел mdast в объёме, который нужен этой проверке. */
interface TreeNode {
  type?: string;
  value?: unknown;
  children?: TreeNode[];
}

function mathNodes(tree: TreeNode): MathNode[] {
  const found: MathNode[] = [];
  const walk = (node: TreeNode) => {
    if (node.type === "inlineMath" || node.type === "math") {
      found.push({ type: node.type, value: String(node.value ?? "") });
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return found;
}

/**
 * Что считаем захватом.
 *
 * Русские слова внутри формулы — самый надёжный признак: настоящая математика
 * их не содержит, а `\text{...}` мы предварительно вырезаем, потому что там
 * кириллица законна.
 *
 * Второй случай — денежная арифметика вида `$1{,}80 + $3`: букв нет, но спан
 * обрывается на операторе, потому что закрывающим долларом стала следующая
 * сумма.
 *
 * Третий — огрызок, оканчивающийся одиночным обратным слэшем: так выглядит
 * спан, закрытый об экранированный `\$` внутри формулы.
 */
function classify(node: MathNode): string | null {
  if (node.type !== "inlineMath") return null;
  const core = node.value.replace(/\\(?:text|mathrm|mathit|operatorname)\s*\{[^{}]*\}/g, "");
  if (/[а-яё]{3,}/i.test(core)) return "в формулу утянута проза";
  if (node.value.trimEnd().endsWith("\\")) return "формула закрылась об экранированный \\$";
  if (!node.value.includes("\\") && /\d/.test(node.value)) {
    const trimmed = node.value.trim();
    if (trimmed !== "" && (/[+\-–—×*/=:]$/.test(trimmed) || node.value !== node.value.trimEnd())) {
      return "денежная сумма открыла формулу";
    }
  }
  return null;
}

/** Номер строки в исходном файле — ищем содержимое формулы как есть. */
function lineOf(source: string, value: string): number {
  const index = source.indexOf(value);
  if (index === -1) return 0;
  return source.slice(0, index).split("\n").length;
}

const problems: Problem[] = [];
let steps = 0;
let formulas = 0;

for (const entry of fs.readdirSync(lessonsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (phase && !entry.name.startsWith(phase)) continue;
  const stepsDir = path.join(lessonsDir, entry.name, "steps");
  if (!fs.existsSync(stepsDir)) continue;

  for (const file of fs.readdirSync(stepsDir).filter((name) => name.endsWith(".md")).sort()) {
    const source = fs.readFileSync(path.join(stepsDir, file), "utf8");
    const { body } = splitFrontmatter(source);
    steps += 1;

    const nodes = mathNodes(processor.runSync(processor.parse(normalizeMath(body))) as TreeNode);
    formulas += nodes.length;

    for (const node of nodes) {
      const kind = classify(node);
      if (!kind) continue;
      problems.push({
        lesson: entry.name,
        step: file,
        line: lineOf(source, node.value),
        kind,
        value: node.value.replace(/\s+/g, " ").trim().slice(0, 90),
      });
    }
  }
}

console.log(JSON.stringify({ steps, formulas, problems: problems.length }, null, 2));

if (problems.length > 0) {
  console.error(`\nНайдено поломанных формул: ${problems.length}`);
  for (const problem of problems) {
    console.error(`- ${problem.lesson}/steps/${problem.step}:${problem.line} — ${problem.kind}`);
    console.error(`    съедено: «${problem.value}»`);
  }
  console.error(
    "\nПочинка: экранируй доллар в прозе — `\\$10 000`. Внутри инлайновой формулы" +
      " `\\$` не помогает, спан всё равно закроется на первом долларе.",
  );
  process.exitCode = 1;
} else {
  console.log("\nФормулы целы: прозы внутри математики не найдено.");
}
