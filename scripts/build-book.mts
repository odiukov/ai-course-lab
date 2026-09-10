import fs from "node:fs";
import path from "node:path";
import {
  availableBookPhases,
  bookFilename,
  resolveChromeExecutable,
} from "../src/lib/book/build";
import { completePdf, generateBookPdf } from "../src/lib/book/pdf";
import { loadConfig } from "../src/lib/config";

const root = process.cwd();
const output = path.resolve(
  process.argv[2] ?? path.join(root, "output", "pdf", bookFilename(null)),
);
const config = loadConfig(process.env, root);
const phases = availableBookPhases(config);
const chrome = resolveChromeExecutable();

if (phases.length === 0) throw new Error("Нет подготовленных фаз для книги");
if (!chrome) throw new Error("Chrome не найден. Укажи путь к нему в CHROME_PATH.");

const pdf = await generateBookPdf({
  config,
  phases,
  chrome,
  root,
  onPhase: (phase, index, total) => {
    console.log(`Печатаю фазу ${phase} (${index + 1}/${total})`);
  },
});
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, pdf);
if (!completePdf(output)) throw new Error("Собранный PDF не завершён");
console.log(`Книга собрана: ${output} (${(pdf.byteLength / 1024 / 1024).toFixed(1)} МБ)`);
