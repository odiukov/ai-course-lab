import { describe, expect, it } from "vitest";
import type { BenchReport } from "@/lib/practice/bench";
import { buildReviewPrompt, formatMetrics, formatRuff, formatTests, reviewCode } from "./review-code";

const row: BenchReport["functions"][number] = {
  fn: "transpose",
  written: true,
  mine: { lines: 3, loops: 2, depth: 2, branches: 0, us: 41.2 },
  ref: { lines: 1, loops: 1, depth: 1, branches: 0, us: 18.4 },
  ratio: 2.239,
  status: "very-slow",
};

const request = {
  lessonTitle: "Векторы и матрицы",
  stepTitle: "Транспонирование",
  fn: "transpose",
  mineCode: "def transpose(M):\n    return [[row[i] for row in M] for i in range(len(M[0]))]",
  solutionCode: "def transpose(M):\n    return [list(row) for row in zip(*M)]",
  tests: "3 из 3 зелёные",
  metrics: formatMetrics(row),
  ruff: "чисто",
};

describe("formatTests", () => {
  it("говорит счётом, а не процентами", () => {
    expect(formatTests({ passed: 3, total: 3, warning: null })).toBe("3 из 3 зелёные");
  });

  it("предупреждение о неточном фильтре доезжает до промпта", () => {
    expect(formatTests({ passed: 17, total: 17, warning: "Фильтр -k foo не выбрал" })).toContain(
      "Фильтр -k foo",
    );
  });
});

describe("formatMetrics", () => {
  it("складывает строку «ты / эталон» по каждой метрике", () => {
    const text = formatMetrics(row);
    expect(text).toContain("строк: 3 / 1");
    expect(text).toContain("циклов: 2 / 1");
    expect(text).toContain("время: 41.2 / 18.4 мкс");
    expect(text).toContain("медленнее эталона в 2.24 раза");
  });

  it("без замера честно говорит, что чисел нет", () => {
    expect(formatMetrics(undefined)).toBe("(замер не удался)");
  });

  it("разницу в пределах шума называет шумом", () => {
    expect(formatMetrics({ ...row, ratio: 1.04, status: "ok" })).toContain("в пределах шума");
  });
});

describe("formatRuff", () => {
  it("перечисляет находки по этой функции", () => {
    const report: BenchReport["ruff"] = {
      available: true,
      findings: [{ code: "PERF401", line: 2, message: "Use a list comprehension" }],
    };
    expect(formatRuff(report, "transpose")).toContain("PERF401");
  });

  it("отсутствие линтера — не пустая строка, а факт", () => {
    expect(formatRuff({ available: false, findings: [] }, "transpose")).toContain("не установлен");
  });

  it("чистый прогон так и называет", () => {
    expect(formatRuff({ available: true, findings: [] }, "transpose")).toBe("чисто");
  });
});

describe("buildReviewPrompt", () => {
  it("подставляет код, эталон и числа", () => {
    const prompt = buildReviewPrompt(request);
    expect(prompt).toContain("range(len(M[0]))");
    expect(prompt).toContain("zip(*M)");
    expect(prompt).toContain("3 из 3 зелёные");
    expect(prompt).toContain("Функция: transpose");
  });
});

describe("reviewCode", () => {
  it("снимает обрамляющий fence с ответа", async () => {
    const text = await reviewCode({
      request,
      deps: { run: async () => "```markdown\nХорошо получилось.\n```" },
    });
    expect(text).toBe("Хорошо получилось.");
  });

  it("пустой ответ агента — ошибка, а не пустой разбор", async () => {
    await expect(reviewCode({ request, deps: { run: async () => "   " } })).rejects.toThrow(/пуст/i);
  });
});
