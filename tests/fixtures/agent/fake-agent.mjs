// Изображает CLI-агента: печатает построчный JSON в формате claude stream-json.
// Форма строк — та же, что в записанном claude-partial-stream.jsonl: текст
// приезжает дельтами `stream_event`, а строка `assistant` следом повторяет уже
// собранное сообщение целиком. Адаптер обязан брать текст только из дельт,
// иначе каждый ответ удвоится.
const prompt = process.argv[process.argv.length - 1];

const delta = (text) =>
  JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  });

const assistant = (text) =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });

if (prompt === "FAIL") {
  console.log(JSON.stringify({ type: "result", is_error: true, result: "boom" }));
  process.exit(1);
}
if (prompt === "LIMIT") {
  console.log(JSON.stringify({ type: "result", is_error: true, result: "usage limit reached" }));
  process.exit(1);
}
if (prompt === "HANG") {
  // Изображает зависший CLI: начало ответа есть, конца не будет никогда.
  // Нужен для проверки таймаута в runner.
  console.log(delta("думаю…"));
  setInterval(() => {}, 1000);
} else {
  console.log(delta("часть 1 "));
  console.log(delta("часть 2"));
  console.log(assistant("часть 1 часть 2"));
  console.log(JSON.stringify({ type: "result", result: "часть 1 часть 2" }));
}
