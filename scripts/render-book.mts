import fs from "node:fs";
import path from "node:path";
import { buildPhaseBook } from "../src/lib/book/build";
import { renderBookHtml } from "../src/lib/book/document";
import { loadConfig } from "../src/lib/config";

const phase = Number(process.argv[2]);
const output = process.argv[3] ? path.resolve(process.argv[3]) : null;
if (!Number.isInteger(phase) || phase < 1 || !output) {
  throw new Error("Использование: render-book.mts <phase> <output.html>");
}

const root = process.cwd();
const book = buildPhaseBook(loadConfig(process.env, root), phase);
if (!book || book.lessons.length === 0) {
  throw new Error(`В фазе ${phase} нет подготовленных уроков`);
}
fs.writeFileSync(output, renderBookHtml(book, root), "utf8");
