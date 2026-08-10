#!/usr/bin/env node
// Подделка интерпретатора для тестов runBench: печатает фикстуру или мусор.
import fs from "node:fs";
import path from "node:path";

const mode = process.env.FAKE_BENCH_MODE ?? "ok";
if (mode === "garbage") {
  process.stdout.write("Traceback (most recent call last):\n  ImportError\n");
  process.exit(1);
} else if (mode === "hang") {
  // Долгий замер: на нём проверяется, что отмена запроса убивает процесс, а не
  // ждёт двухминутного таймаута.
  setTimeout(() => process.exit(0), 60_000);
} else {
  process.stdout.write(
    fs.readFileSync(path.join(process.cwd(), "tests/fixtures/practice/bench-output.json"), "utf8"),
  );
}
