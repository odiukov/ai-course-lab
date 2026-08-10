// Печатает аргументы запуска адаптера по одному в строке.
// Нужен записи фикстур: запись должна идти ровно теми флагами, которыми
// приложение реально запускает CLI, иначе фикстуры молча разойдутся с кодом.
// Запуск: npx tsx scripts/print-agent-args.mts claude|codex "<промпт>"
import { claudeAdapter } from "@/lib/agent/claude-adapter";
import { codexAdapter } from "@/lib/agent/codex-adapter";

const [name, prompt] = process.argv.slice(2);
if (name !== "claude" && name !== "codex") {
  console.error("Укажи агента: claude или codex");
  process.exit(2);
}
const adapter = name === "codex" ? codexAdapter : claudeAdapter;
for (const arg of adapter.args(prompt ?? "")) console.log(arg);
