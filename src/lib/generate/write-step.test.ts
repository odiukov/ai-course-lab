import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLesson } from "../source/catalog";
import { readLessonSource } from "../source/lesson-source";
import { readStep } from "../content/step-file";
import { appendClarification } from "../content/clarifications";
import type { StepMeta } from "../content/step-file";
import type { LessonPlan } from "../content/lesson-plan";
import { lessonPaths } from "../content/paths";
import {
  ensureSteps,
  hasDiagramSource,
  stripDiagramFences,
  excerptForStep,
  parseStepReply,
  resolveStepExcerpts,
  stripEnclosingFence,
} from "./write-step";

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

  it("кладёт в промпт вопросы, заданные на предыдущих шагах", async () => {
    const contentDir = tmpDir();
    appendClarification(contentDir, PLAN.slug, "001-t", {
      askedAt: "2026-08-10T09:00:00.000Z",
      question: "Что такое строка матрицы?",
      answer: "Горизонтальный ряд чисел.",
    });

    const run = vi.fn().mockResolvedValue("Тело.");
    await ensureSteps({ contentDir, source: SOURCE, plan: PLAN, fromIndex: 1, count: 1, deps: { run } });

    expect(run.mock.calls[0][0] as string).toContain("Что такое строка матрицы?");
  });

  const VISUAL_PLAN: LessonPlan = {
    ...PLAN,
    steps: [
      {
        id: "001-v",
        type: "visual",
        title: "Длина вектора",
        visual_brief: "вектор [3, 4] как стрелка из (0,0)",
      },
    ],
  };
  const GOOD_SVG = '<!doctype html><html><body><svg viewBox="0 0 10 10"></svg></body></html>';

  it("рисует схему шагу с visual_brief после того, как записал текст", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValueOnce("Тело шага.").mockResolvedValueOnce(GOOD_SVG);

    await ensureSteps({ contentDir, source: SOURCE, plan: VISUAL_PLAN, fromIndex: 0, deps: { run } });

    expect(readStep(contentDir, VISUAL_PLAN.slug, "001-v")?.body).toBe("Тело шага.");
    expect(fs.readFileSync(lessonPaths(contentDir, VISUAL_PLAN.slug).visualFile("001-v"), "utf8")).toContain("<svg");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("рисовальщик видит уже написанное тело шага", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValueOnce("Тело шага.").mockResolvedValueOnce(GOOD_SVG);

    await ensureSteps({ contentDir, source: SOURCE, plan: VISUAL_PLAN, fromIndex: 0, deps: { run } });

    expect(run.mock.calls[1][0] as string).toContain("Тело шага.");
  });

  it("оставляет шаг записанным, когда схема не прошла проверку", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValueOnce("Тело шага.").mockResolvedValueOnce("<html>нет схемы</html>");
    const onVisualError = vi.fn();

    const ids = await ensureSteps({
      contentDir,
      source: SOURCE,
      plan: VISUAL_PLAN,
      fromIndex: 0,
      deps: { run },
      onVisualError,
    });

    expect(ids).toEqual(["001-v"]);
    expect(readStep(contentDir, VISUAL_PLAN.slug, "001-v")?.body).toBe("Тело шага.");
    expect(fs.existsSync(lessonPaths(contentDir, VISUAL_PLAN.slug).visualFile("001-v"))).toBe(false);
    expect(onVisualError).toHaveBeenCalledWith("001-v", expect.stringMatching(/svg/i));
  });

  it("не зовёт рисовальщика для шага с готовой визуализацией из курса", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("Тело шага.");
    const plan: LessonPlan = {
      ...PLAN,
      steps: [{ id: "001-v", type: "visual", title: "Готовая", visual: "learning-visuals/lesson-02-shapes.html" }],
    };

    await ensureSteps({ contentDir, source: SOURCE, plan, fromIndex: 0, deps: { run } });

    expect(run).toHaveBeenCalledTimes(1);
  });
});

const CHECK_PLAN: LessonPlan = {
  ...PLAN,
  steps: [{ id: "005-check", type: "check", title: "Проверка: формы" }],
};

const CHECK_REPLY = [
  "---",
  "check:",
  '  - question: "Какие формы состыкуются?"',
  "    options:",
  '      - "2x3 и 3x2"',
  '      - "2x3 и 2x3"',
  "    correct: 0",
  '    explanation: "Внутренние размерности должны совпасть."',
  "---",
  "",
  "Тело шага-проверки.",
].join("\n");

describe("parseStepReply", () => {
  it("достаёт вопросы из frontmatter, тело — отдельно", () => {
    const reply = parseStepReply(CHECK_REPLY, true);
    expect(reply.body).toBe("Тело шага-проверки.");
    expect(reply.check).toEqual([
      {
        question: "Какие формы состыкуются?",
        options: ["2x3 и 3x2", "2x3 и 2x3"],
        correct: 0,
        explanation: "Внутренние размерности должны совпасть.",
      },
    ]);
  });

  it("для шага не типа check frontmatter не разбирается: --- в теле — это линия", () => {
    const body = ["Первая мысль.", "", "---", "", "Вторая мысль."].join("\n");
    expect(parseStepReply(body, false)).toEqual({ body });
  });

  it("ответ без frontmatter даёт тело и никаких вопросов", () => {
    expect(parseStepReply("Просто тело.", true)).toEqual({ body: "Просто тело." });
  });

  it("вопросы не той формы отбрасываются, тело остаётся", () => {
    const reply = parseStepReply(
      ["---", "check:", '  - question: "Без вариантов"', "---", "", "Тело."].join("\n"),
      true,
    );
    expect(reply.check).toBeUndefined();
    expect(reply.body).toBe("Тело.");
  });

  it("пустой список вопросов — это отсутствие вопросов", () => {
    expect(parseStepReply(["---", "check: []", "---", "", "Тело."].join("\n"), true).check).toBeUndefined();
  });

  it("обёртка из ```markdown снимается и здесь", () => {
    expect(parseStepReply(`\`\`\`markdown\n${CHECK_REPLY}\n\`\`\``, true).check).toHaveLength(1);
  });
});

describe("ensureSteps и шаги-проверки", () => {
  it("вопросы из ответа агента попадают в файл шага", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue(CHECK_REPLY);
    await ensureSteps({ contentDir, source: SOURCE, plan: CHECK_PLAN, fromIndex: 0, deps: { run } });

    const step = readStep(contentDir, CHECK_PLAN.slug, "005-check")!;
    expect(step.check).toHaveLength(1);
    expect(step.check![0].correct).toBe(0);
    expect(step.body).toBe("Тело шага-проверки.");
  });

  it("промпт объясняет, как прислать вопросы", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue(CHECK_REPLY);
    await ensureSteps({ contentDir, source: SOURCE, plan: CHECK_PLAN, fromIndex: 0, deps: { run } });
    expect(run.mock.calls[0][0] as string).toContain("check:");
  });

  it("ответ без вопросов даёт одну повторную попытку", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValueOnce("Тело без вопросов.").mockResolvedValueOnce(CHECK_REPLY);

    const ids = await ensureSteps({
      contentDir,
      source: SOURCE,
      plan: CHECK_PLAN,
      fromIndex: 0,
      deps: { run },
    });

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0] as string).toContain("не дала ни одного вопроса");
    expect(ids).toEqual(["005-check"]);
    expect(readStep(contentDir, CHECK_PLAN.slug, "005-check")?.check).toHaveLength(1);
  });

  it("два промаха подряд — шаг не записан, и об этом сказано", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("Тело без вопросов.");

    await expect(
      ensureSteps({ contentDir, source: SOURCE, plan: CHECK_PLAN, fromIndex: 0, deps: { run } }),
    ).rejects.toThrow(/005-check/);

    expect(run).toHaveBeenCalledTimes(2);
    // Главное: пустая проверка не легла на диск как готовый шаг.
    expect(readStep(contentDir, CHECK_PLAN.slug, "005-check")).toBeNull();
  });

  it("остальные шаги окна всё равно записаны и названы в ошибке", async () => {
    const contentDir = tmpDir();
    const plan: LessonPlan = {
      ...PLAN,
      steps: [
        { id: "001-t", type: "theory", title: "Зачем" },
        { id: "002-check", type: "check", title: "Проверка" },
      ],
    };
    const run = vi.fn().mockResolvedValue("Тело без вопросов.");

    await expect(
      ensureSteps({ contentDir, source: SOURCE, plan, fromIndex: 0, deps: { run } }),
    ).rejects.toThrow(/записаны: 001-t/);
    expect(readStep(contentDir, plan.slug, "001-t")).not.toBeNull();
  });

  it("шаг не типа check вопросов не получает и повторов не вызывает", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("Тело.");
    await ensureSteps({ contentDir, source: SOURCE, plan: PLAN, fromIndex: 0, count: 1, deps: { run } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(readStep(contentDir, PLAN.slug, "001-t")?.check).toBeUndefined();
  });
});

describe("ensureSteps и итоговый квиз", () => {
  const QUIZ_PLAN: LessonPlan = {
    ...PLAN,
    steps: [{ id: "006-quiz", type: "quiz", title: "Итоговая проверка урока" }],
  };

  it("вопросы квиза попадают в frontmatter шага, а не в тело", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue(CHECK_REPLY);
    await ensureSteps({ contentDir, source: SOURCE, plan: QUIZ_PLAN, fromIndex: 0, deps: { run } });

    const step = readStep(contentDir, QUIZ_PLAN.slug, "006-quiz")!;
    expect(step.check).toHaveLength(1);
    expect(step.body).toBe("Тело шага-проверки.");
    // Ровно тот баг, из-за которого учащийся видел на итоговом экране сырой YAML.
    expect(step.body).not.toContain("check:");
  });

  it("квиз без вопросов записывается всё равно: у него есть quiz.json курса", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("Итог урока без вопросов.");

    const ids = await ensureSteps({ contentDir, source: SOURCE, plan: QUIZ_PLAN, fromIndex: 0, deps: { run } });

    // Одна повторная попытка — вопросы по-русски лучше английских из quiz.json,
    // но их отсутствие шаг не отменяет, в отличие от шага-проверки.
    expect(run).toHaveBeenCalledTimes(2);
    expect(ids).toEqual(["006-quiz"]);
    expect(readStep(contentDir, QUIZ_PLAN.slug, "006-quiz")?.check).toBeUndefined();
  });
});

describe("ensureSteps — дорисовка пропавших схем", () => {
  const WITH_VISUAL: LessonPlan = {
    ...PLAN,
    steps: [
      { id: "001-t", type: "theory", title: "Зачем", visual_brief: "стрелка из (0,0) в (3,2)" },
      ...PLAN.steps.slice(1),
    ],
  };

  // Схема, у которой сорвалась генерация, не оставляет файла, а шаг остаётся
  // на диске — и прежде генерация к нему больше не возвращалась. Урок навсегда
  // оставался без картинки, вернуть её можно было только удалив шаг руками.
  it("рисует схему шага, который уже написан, но остался без неё", async () => {
    const contentDir = tmpDir();
    // Во втором заходе шаг уже написан, поэтому единственный вызов агента —
    // это рисование схемы.
    const run = vi
      .fn()
      .mockResolvedValue('<!doctype html><html><body><svg viewBox="0 0 10 10"></svg></body></html>');

    // Первый заход: шаг записан, схема провалилась.
    const failing = vi.fn().mockResolvedValueOnce("Тело шага.").mockResolvedValue("извини, не могу");
    const problems: string[] = [];
    await ensureSteps({
      contentDir,
      source: SOURCE,
      plan: WITH_VISUAL,
      fromIndex: 0,
      count: 1,
      deps: { run: failing },
      onVisualError: (_id, problem) => problems.push(problem),
    });
    expect(problems).toHaveLength(1);
    const visual = path.join(contentDir, "lessons", PLAN.slug, "visuals", "001-t.html");
    expect(fs.existsSync(visual)).toBe(false);

    // Второй заход: шаг не переписывается, а схема дорисовывается.
    const written = await ensureSteps({
      contentDir,
      source: SOURCE,
      plan: WITH_VISUAL,
      fromIndex: 0,
      count: 1,
      deps: { run },
    });
    expect(written).toEqual([]);
    expect(fs.existsSync(visual)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("не зовёт агента, когда схема уже на месте", async () => {
    const contentDir = tmpDir();
    const run = vi
      .fn()
      .mockResolvedValueOnce("Тело шага.")
      .mockResolvedValue('<!doctype html><html><body><svg viewBox="0 0 10 10"></svg></body></html>');
    await ensureSteps({
      contentDir, source: SOURCE, plan: WITH_VISUAL, fromIndex: 0, count: 1, deps: { run },
    });
    expect(run).toHaveBeenCalledTimes(2);

    await ensureSteps({
      contentDir, source: SOURCE, plan: WITH_VISUAL, fromIndex: 0, count: 1, deps: { run },
    });
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("hasDiagramSource / stripDiagramFences", () => {
  const MERMAID = [
    "Дефицит ранга — когда пространство схлопывается.",
    "",
    "```mermaid",
    "graph LR",
    '  A1["квадрат"] -->|"матрица A"| A2["наклон"]',
    "```",
    "",
    "Именно поэтому матрицу нельзя обратить.",
  ].join("\n");

  it("узнаёт забор с mermaid", () => {
    expect(hasDiagramSource(MERMAID)).toBe(true);
  });

  it.each(["dot", "graphviz", "plantuml", "puml", "tikz"])("узнаёт забор с %s", (lang) => {
    expect(hasDiagramSource(`текст\n\n\`\`\`${lang}\nA -> B\n\`\`\`\n`)).toBe(true);
  });

  // Код на code-шаге — законная часть урока, и вырезать его нельзя.
  it("не трогает обычный блок кода", () => {
    const python = "Пишем функцию:\n\n```python\ndef transpose(m):\n    ...\n```\n";
    expect(hasDiagramSource(python)).toBe(false);
    expect(stripDiagramFences(python)).toBe(python.trim());
  });

  it("вырезает диаграмму, оставляя текст вокруг", () => {
    const cleaned = stripDiagramFences(MERMAID);
    expect(cleaned).toContain("Дефицит ранга");
    expect(cleaned).toContain("Именно поэтому");
    expect(cleaned).not.toContain("graph LR");
    expect(cleaned).not.toContain("```");
  });

  it("не оставляет после себя дыру из пустых строк", () => {
    expect(stripDiagramFences(MERMAID)).not.toMatch(/\n{3,}/);
  });
});

describe("ensureSteps — диаграмма в теле", () => {
  it("не пускает исходник mermaid в файл шага", async () => {
    const contentDir = tmpDir();
    const run = vi
      .fn()
      .mockResolvedValue("Текст шага.\n\n```mermaid\ngraph LR\n  A --> B\n```\n\nХвост.");
    await ensureSteps({ contentDir, source: SOURCE, plan: PLAN, fromIndex: 0, count: 1, deps: { run } });

    const body = readStep(contentDir, PLAN.slug, "001-t")?.body ?? "";
    expect(body).toContain("Текст шага.");
    expect(body).toContain("Хвост.");
    expect(body).not.toContain("mermaid");
    expect(body).not.toContain("graph LR");
  });
});
