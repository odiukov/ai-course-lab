import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLesson } from "../source/catalog";
import { readLessonSource } from "../source/lesson-source";
import { readStep } from "../content/step-file";
import type { StepMeta } from "../content/step-file";
import type { LessonPlan } from "../content/lesson-plan";
import { ensureSteps, excerptForStep, resolveStepExcerpts, stripEnclosingFence } from "./write-step";

const COURSE = path.resolve(__dirname, "../../../tests/fixtures/course");
const SOURCE = readLessonSource(COURSE, findLesson(COURSE, "01-math-foundations__02-beta")!);

const PLAN: LessonPlan = {
  slug: SOURCE.ref.slug,
  title: "Beta",
  lang: SOURCE.lang,
  sourcePath: SOURCE.textPath,
  sourceHash: SOURCE.sourceHash,
  generatedAt: "2026-08-09T00:00:00.000Z",
  steps: [
    { id: "001-t", type: "theory", title: "Зачем", source_anchor: "### Транспонирование" },
    { id: "002-c", type: "code", title: "transpose", exercise_fn: "transpose" },
    { id: "003-t", type: "theory", title: "Дальше" },
    { id: "004-c", type: "code", title: "matmul", exercise_fn: "matmul" },
  ],
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "steps-"));
}

function fakeSource(text: string) {
  return {
    ref: SOURCE.ref,
    lang: "ru" as const,
    textPath: "in-memory.md",
    text,
    sourceHash: "test",
    quiz: [],
    visuals: [],
    exercise: null,
  };
}

describe("excerptForStep — границы среза", () => {
  it("останавливается на следующем заголовке того же уровня, а не идёт до конца", () => {
    const source = fakeSource(
      ["# Lesson", "", "### Transpose", "", "Transpose content here.", "", "### Matmul", "", "Matmul content here."].join(
        "\n",
      ),
    );

    const text = excerptForStep(source, "### Transpose");
    expect(text).toContain("Transpose content here.");
    expect(text).not.toContain("Matmul content here.");
  });

  it("включает более глубокие подзаголовки — они не считаются границей", () => {
    const source = fakeSource(
      [
        "# Lesson",
        "",
        "## The Concept",
        "",
        "### Sub One",
        "",
        "Detail one.",
        "",
        "### Sub Two",
        "",
        "Detail two.",
        "",
        "## Next Big Section",
        "",
        "Something else.",
      ].join("\n"),
    );

    const text = excerptForStep(source, "## The Concept");
    expect(text).toContain("Detail one.");
    expect(text).toContain("Detail two.");
    expect(text).not.toContain("Something else.");
  });
});

describe("resolveStepExcerpts", () => {
  it("шаги с одинаковым заголовком получают свой, а не чужой раздел", () => {
    const source = fakeSource(
      ["# Lesson", "", "### Example", "", "First example text.", "", "### Example", "", "Second example text."].join(
        "\n",
      ),
    );
    const steps: StepMeta[] = [
      { id: "s1", type: "theory", title: "One", source_anchor: "### Example" },
      { id: "s2", type: "theory", title: "Two", source_anchor: "### Example" },
    ];

    const excerpts = resolveStepExcerpts(source, steps);

    expect(excerpts.get("s1")).toContain("First example text");
    expect(excerpts.get("s1")).not.toContain("Second example text");
    expect(excerpts.get("s2")).toContain("Second example text");
    expect(excerpts.get("s2")).not.toContain("First example text");
  });
});

describe("excerptForStep", () => {
  it("режет исходник по якорю до следующего заголовка того же уровня", () => {
    const text = excerptForStep(SOURCE, "### Транспонирование");
    expect(text).toContain("Переворачиваем строки");
    expect(text).not.toContain("# Урок");
  });

  it("без якоря отдаёт начало урока", () => {
    expect(excerptForStep(SOURCE).length).toBeGreaterThan(0);
  });
});

describe("stripEnclosingFence", () => {
  it("снимает ```markdown, обёрнутый вокруг всего ответа", () => {
    const body = ["```markdown", "# Заголовок", "", "Текст.", "```"].join("\n");
    expect(stripEnclosingFence(body)).toBe("# Заголовок\n\nТекст.");
  });

  it("снимает внешнюю обёртку, но сохраняет блоки кода внутри", () => {
    const body = [
      "```markdown",
      "Вот пример:",
      "",
      "```python",
      "print(1)",
      "```",
      "",
      "Готово.",
      "```",
    ].join("\n");
    const out = stripEnclosingFence(body);
    expect(out.startsWith("Вот пример:")).toBe(true);
    expect(out).toContain("```python");
    expect(out).toContain("print(1)");
    expect(out.endsWith("Готово.")).toBe(true);
  });

  it("не трогает обычное тело без обёртки", () => {
    const body = "Просто текст.\n\n```python\nprint(1)\n```\n\nи ещё текст.";
    expect(stripEnclosingFence(body)).toBe(body);
  });

  it("не трогает тело, которое начинается и кончается блоком кода", () => {
    const body = ["```python", "print(1)", "```", "", "Текст.", "", "```python", "print(2)", "```"].join("\n");
    expect(stripEnclosingFence(body)).toBe(body);
  });

  it("не снимает ничего, если закрывающего забора нет", () => {
    const body = "```markdown\nТекст без закрытия.";
    expect(stripEnclosingFence(body)).toBe(body);
  });
});

describe("ensureSteps", () => {
  it("снимает обёртку из ```markdown перед записью на диск", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("```markdown\n# Заголовок\n\nТело шага.\n```");
    await ensureSteps({ contentDir, source: SOURCE, plan: PLAN, fromIndex: 0, count: 1, deps: { run } });
    expect(readStep(contentDir, PLAN.slug, "001-t")?.body).toBe("# Заголовок\n\nТело шага.");
  });

  it("генерит окно из трёх шагов", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("Тело шага.");
    const ids = await ensureSteps({ contentDir, source: SOURCE, plan: PLAN, fromIndex: 0, deps: { run } });
    expect(ids).toEqual(["001-t", "002-c", "003-t"]);
    expect(readStep(contentDir, PLAN.slug, "002-c")?.body).toBe("Тело шага.");
    expect(readStep(contentDir, PLAN.slug, "002-c")?.exercise_fn).toBe("transpose");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("не перегенерирует уже существующие шаги", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("Тело шага.");
    await ensureSteps({ contentDir, source: SOURCE, plan: PLAN, fromIndex: 0, count: 1, deps: { run } });
    await ensureSteps({ contentDir, source: SOURCE, plan: PLAN, fromIndex: 0, count: 2, deps: { run } });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("не вылезает за конец плана", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("Тело.");
    const ids = await ensureSteps({ contentDir, source: SOURCE, plan: PLAN, fromIndex: 3, deps: { run } });
    expect(ids).toEqual(["004-c"]);
  });

  it("в соседях нет текущего шага, но есть соседний", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("Тело.");
    await ensureSteps({ contentDir, source: SOURCE, plan: PLAN, fromIndex: 1, count: 1, deps: { run } });

    const prompt = run.mock.calls[0][0] as string;
    const match = /Соседние шаги, чтобы не повторяться:\n([\s\S]*?)\n\nКусок/.exec(prompt);
    expect(match).not.toBeNull();
    const neighbours = match![1];

    expect(neighbours).not.toContain("transpose");
    expect(neighbours).toContain("Зачем");
    expect(neighbours).toContain("Дальше");
  });

  it("сохраняет visual и baseline из плана шага в файле", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("Тело.");
    const planWithExtras: LessonPlan = {
      ...PLAN,
      steps: [
        {
          id: "005-v",
          type: "visual",
          title: "Смотрим на матрицу",
          visual: "p01-l02-beta-demo",
          baseline: {
            lesson: "01-math-foundations__01-alpha",
            fn: "transpose",
            changes: "теперь принимает матрицу NxM",
          },
        },
      ],
    };

    await ensureSteps({ contentDir, source: SOURCE, plan: planWithExtras, fromIndex: 0, deps: { run } });
    const step = readStep(contentDir, planWithExtras.slug, "005-v");

    expect(step?.visual).toBe("p01-l02-beta-demo");
    expect(step?.baseline).toEqual({
      lesson: "01-math-foundations__01-alpha",
      fn: "transpose",
      changes: "теперь принимает матрицу NxM",
    });
  });
});
