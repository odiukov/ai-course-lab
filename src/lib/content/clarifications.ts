import fs from "node:fs";
import path from "node:path";
import { lessonPaths } from "./paths";

export interface Clarification {
  askedAt: string;
  question: string;
  answer: string;
}

const MARKER_LINE = /^<!-- clarification: (.+?) -->\s*$/;

// Ответ агента — произвольный markdown, и теоретически он может содержать
// строку, неотличимую от разделителя блоков. Такая строка сдвигается на один
// пробел вправо: регулярка привязана к началу строки и перестаёт срабатывать,
// а в отрисованном markdown комментарий как был невидим, так и остался.
//
// Чтобы это было обратимо, а не однонаправленной порчей текста, экранируем
// заодно и любую строку, которая уже сама начинается с пробела — «экранируем
// экранирование». Тогда расшифровка («если строка начинается с пробела —
// снять ровно один») — биекция для любого входа, включая ответ, где маркер
// встречается несколько раз или уже есть строки с ведущими пробелами.
function escapeAnswerLine(line: string): string {
  return line.startsWith(" ") || MARKER_LINE.test(line) ? ` ${line}` : line;
}

function unescapeAnswerLine(line: string): string {
  return line.startsWith(" ") ? line.slice(1) : line;
}

function neutralizeMarkers(text: string): string {
  return text.split("\n").map(escapeAnswerLine).join("\n");
}

// Вопрос живёт на одной строке заголовка, но пользователь может ввести
// вопрос из нескольких строк или с повторяющимися пробелами — оба должны
// пережить круг без потерь. Переносим строку и обратный слэш в escape-
// последовательности (в этом порядке важен только сам факт экранирования
// обратного слэша первым — иначе "\n", появившийся из экранирования
// реального слэша, было бы не отличить от экранированного переноса строки).
function encodeQuestion(question: string): string {
  return question.trim().replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

function decodeQuestion(line: string): string {
  let out = "";
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\\" && i + 1 < line.length) {
      const next = line[i + 1];
      if (next === "n") {
        out += "\n";
        i += 1;
        continue;
      }
      if (next === "\\") {
        out += "\\";
        i += 1;
        continue;
      }
    }
    out += char;
  }
  return out;
}

export function serializeClarification(item: Clarification): string {
  const question = encodeQuestion(item.question);
  const answer = neutralizeMarkers(item.answer.trim());
  return `<!-- clarification: ${item.askedAt} -->\n## ${question}\n\n${answer}\n`;
}

export function parseClarifications(markdown: string): Clarification[] {
  const out: Clarification[] = [];
  let askedAt: string | null = null;
  let collected: string[] = [];

  const flush = () => {
    if (askedAt === null) return;
    const [head, ...rest] = collected;
    const question = decodeQuestion((head ?? "").replace(/^#+\s*/, "").trim());
    if (question.length > 0) {
      const answer = rest.map(unescapeAnswerLine).join("\n").trim();
      out.push({ askedAt, question, answer });
    }
    askedAt = null;
    collected = [];
  };

  for (const line of markdown.split("\n")) {
    const marker = MARKER_LINE.exec(line);
    if (marker) {
      flush();
      askedAt = marker[1];
      continue;
    }
    if (askedAt === null) continue;
    if (collected.length === 0 && line.trim().length === 0) continue;
    collected.push(line);
  }

  flush();
  return out;
}

export function readClarifications(
  contentDir: string,
  slug: string,
  stepId: string,
): Clarification[] {
  const file = lessonPaths(contentDir, slug).clarificationFile(stepId);
  if (!fs.existsSync(file)) return [];
  return parseClarifications(fs.readFileSync(file, "utf8"));
}

export function appendClarification(
  contentDir: string,
  slug: string,
  stepId: string,
  item: Clarification,
): void {
  const file = lessonPaths(contentDir, slug).clarificationFile(stepId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const prefix = existing.trim().length > 0 ? `${existing.trimEnd()}\n\n` : "";
  fs.writeFileSync(file, `${prefix}${serializeClarification(item)}`, "utf8");
}

export function readLessonClarifications(
  contentDir: string,
  slug: string,
): Map<string, Clarification[]> {
  const dir = lessonPaths(contentDir, slug).clarificationsDir;
  const byStep = new Map<string, Clarification[]>();
  if (!fs.existsSync(dir)) return byStep;

  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) continue;
    const items = parseClarifications(fs.readFileSync(path.join(dir, name), "utf8"));
    if (items.length > 0) byStep.set(name.slice(0, -3), items);
  }
  return byStep;
}
