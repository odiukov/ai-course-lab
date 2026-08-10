// Изображает CLI-агента: печатает построчный JSON в формате claude stream-json.
const prompt = process.argv[process.argv.length - 1];

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
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "думаю…" }] } }));
  setInterval(() => {}, 1000);
} else {
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "часть 1 " }] } }));
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "часть 2" }] } }));
  console.log(JSON.stringify({ type: "result", result: "часть 1 часть 2" }));
}
