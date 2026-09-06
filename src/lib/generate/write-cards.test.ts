import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCards } from "../cards/card";
import type { Step } from "../content/step-file";
import type { LessonSource } from "../source/lesson-source";
import { parseCardsReply, writeCardsForStep, writeCardsForSteps } from "./write-cards";

const SLUG = "01-math__01-alpha";

const STEP: Step = {
  id: "046-quiz",
  type: "theory",
  title: "Стартовый loss",
  body: "Стартовый loss при словаре из 65 символов равен примерно 4.17.",
};

/** Кусок исходника, попадающий в промпт как срез по якорю шага. */
const EXCERPT = [
  "## The Concept",
  "",
  "Кросс-энтропия необученной модели равна натуральному логарифму размера словаря.",
].join("\n");

function fakeSource(over: Partial<LessonSource> = {}): LessonSource {
  return {
    ref: {
      slug: SLUG,
      phaseDir: "01-math",
      lessonDir: "01-alpha",
      phaseNumber: 1,
      lessonNumber: 1,
      title: "Alpha",
    },
    lang: "ru",
    textPath: "in-memory.md",
    text: `# Урок\n\n${EXCERPT}\n`,
    sourceHash: "test",
    quiz: [],
    visuals: [],
    exercise: null,
    ...over,
  };
}

const SOURCE = fakeSource();

// Тот же шаг, но с уже существующими (бракованными) вопросами check во
// frontmatter — нужен для проверки, что пустой ответ на месте починки этих
// вопросов не проходит молча.
const STEP_WITH_CHECK: Step = {
  ...STEP,
  check: [
    {
      question: "Чему равен loss?",
      options: ["4.17", "6.93"],
      correct: 0,
      explanation: "",
    },
  ],
};

const GOOD = JSON.stringify({
  cards: [
    {
      kind: "numeric",
      concept: "стартовый loss равен логарифму размера словаря",
      question: "В словаре 1024 токена, модель необучена. Чему примерно равен loss?",
      answer: 6.93,
      tolerance: 0.05,
      explanation: "ln(1024) ≈ 6.93.",
    },
  ],
  check: [],
});

/**
 * Ответ агента на пачку шагов.
 *
 * Числа карточек намеренно не пересекаются с числами тела шага (4.17 и 65) —
 * иначе сработает number-overlap и тест провалится не по той причине, ради
 * которой написан.
 */
function batchReply(steps: { id: string; cards: number; check?: unknown[] }[]): string {
  return JSON.stringify({
    steps: steps.map((step) => ({
      id: step.id,
      cards: Array.from({ length: step.cards }, (_unused, index) => ({
        kind: "numeric",
        concept: `идея номер ${index} шага ${step.id}`,
        question: `В словаре ${1024 + index} токенов, модель необучена. Чему примерно равен loss?`,
        answer: 6.93,
        tolerance: 0.05,
        explanation: "ln(1024) ≈ 6.93.",
      })),
      check: step.check ?? [],
    })),
  });
}

const RECYCLED = JSON.stringify({
  cards: [
    {
      kind: "numeric",
      concept: "стартовый loss равен логарифму размера словаря",
      question: "В словаре 65 символов. Чему равен loss?",
      answer: 4.17,
      tolerance: 0.01,
      explanation: "ln(65) ≈ 4.17.",
    },
  ],
  check: [],
});

// Починенный вопрос: правильный ответ не содержит чисел из тела шага, поэтому
// проходит auditCheck по существу — используется, чтобы отличить провал по
// number-answer от провала по check-dropped.
const FIXED_CHECK_QUESTION = {
  question: "Почему стартовый loss равен логарифму размера словаря?",
  options: [
    "Потому что необученная модель распределяет вероятность поровну между токенами словаря",
    "Потому что функция потерь квадратичная",
  ],
  correct: 0,
  explanation: "Равномерное распределение по |V| вариантам даёт loss ln(|V|).",
};

const EMPTY_CHECK_REPLY = JSON.stringify({ cards: [], check: [] });
const FIXED_CHECK_REPLY = JSON.stringify({ cards: [], check: [FIXED_CHECK_QUESTION] });

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "write-cards-"));
}

function agent(replies: string[]) {
  const prompts: string[] = [];
  return {
    prompts,
    deps: {
      run: async (prompt: string) => {
        prompts.push(prompt);
        return replies[prompts.length - 1] ?? replies[replies.length - 1];
      },
    },
  };
}

describe("parseCardsReply", () => {
  it("достаёт JSON из ответа, обрамлённого текстом", () => {
    const parsed = parseCardsReply(
      `Вот карточки:\n\`\`\`json\n${batchReply([{ id: STEP.id, cards: 1 }])}\n\`\`\`\nГотово.`,
      [STEP.id],
    );
    expect(parsed.byStep.get(STEP.id)?.cards).toHaveLength(1);
    expect(parsed.byStep.get(STEP.id)?.check).toEqual([]);
  });

  it("на мусоре вместо JSON возвращает пустую карту, а не бросает", () => {
    expect(parseCardsReply("Извини, не понял задачу.", [STEP.id]).byStep.size).toBe(0);
  });

  it("раскладывает пачку по id шагов", () => {
    const parsed = parseCardsReply(
      batchReply([
        { id: "046-quiz", cards: 1 },
        { id: "047-perehod", cards: 0 },
      ]),
      ["046-quiz", "047-perehod"],
    );
    expect(parsed.byStep.get("046-quiz")?.cards).toHaveLength(1);
    expect(parsed.byStep.get("047-perehod")?.cards).toEqual([]);
  });

  it("шаг, которого в задании не было, в ответе игнорируется", () => {
    const parsed = parseCardsReply(
      batchReply([
        { id: "046-quiz", cards: 1 },
        { id: "099-chuzhoi", cards: 1 },
      ]),
      ["046-quiz"],
    );
    expect([...parsed.byStep.keys()]).toEqual(["046-quiz"]);
  });

  it("шаг, пропущенный в ответе, в карту не попадает", () => {
    const parsed = parseCardsReply(batchReply([{ id: "046-quiz", cards: 1 }]), [
      "046-quiz",
      "047-perehod",
    ]);
    expect(parsed.byStep.has("047-perehod")).toBe(false);
  });

  it("плоский ответ без обёртки steps принимается для пачки из одного шага", () => {
    const parsed = parseCardsReply(GOOD, [STEP.id]);
    expect(parsed.byStep.get(STEP.id)?.cards).toHaveLength(1);
  });

  it("плоский ответ на пачке из нескольких шагов не принимается — непонятно, чей он", () => {
    expect(parseCardsReply(GOOD, ["046-quiz", "047-perehod"]).byStep.size).toBe(0);
  });
});

describe("writeCardsForStep", () => {
  it("пишет карточки на диск и не жалуется", async () => {
    const dir = tmpDir();
    const { deps } = agent([GOOD]);
    const result = await writeCardsForStep({
      contentDir: dir,
      slug: SLUG,
      step: STEP,
      deps,
      source: SOURCE,
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });

    expect(result.findings).toEqual([]);
    expect(result.cards).toHaveLength(1);
    expect(readCards(dir, SLUG, "046-quiz")).toHaveLength(1);
  });

  it("переспрашивает один раз, отдав замечания, и принимает исправленное", async () => {
    const dir = tmpDir();
    const { deps, prompts } = agent([RECYCLED, GOOD]);
    const result = await writeCardsForStep({
      contentDir: dir,
      slug: SLUG,
      step: STEP,
      deps,
      source: SOURCE,
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("number-overlap");
    expect(result.findings).toEqual([]);
    expect(readCards(dir, SLUG, "046-quiz")).toHaveLength(1);
  });

  it("на повторном провале ничего не пишет и возвращает замечания", async () => {
    const dir = tmpDir();
    const { deps } = agent([RECYCLED, RECYCLED]);
    const result = await writeCardsForStep({
      contentDir: dir,
      slug: SLUG,
      step: STEP,
      deps,
      source: SOURCE,
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });

    expect(result.findings.map((f) => f.rule)).toContain("number-overlap");
    expect(result.cards).toEqual([]);
    expect(readCards(dir, SLUG, "046-quiz")).toBeNull();
  });

  it("пустой список карточек — законный ответ для шага без запоминаемой идеи", async () => {
    const dir = tmpDir();
    const { deps } = agent([JSON.stringify({ cards: [], check: [] })]);
    const result = await writeCardsForStep({
      contentDir: dir,
      slug: SLUG,
      step: STEP,
      deps,
      source: SOURCE,
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });

    expect(result.cards).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(readCards(dir, SLUG, "046-quiz")).toBeNull();
  });
});

describe("writeCardsForStep — устаревшие карточки на диске", () => {
  it("шаг перестал давать карточки — прежний файл удаляется", async () => {
    const dir = tmpDir();
    const good = agent([GOOD]);
    await writeCardsForStep({
      contentDir: dir,
      slug: SLUG,
      step: STEP,
      deps: good.deps,
      source: SOURCE,
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });
    expect(readCards(dir, SLUG, STEP.id)).toHaveLength(1);

    const empty = agent([JSON.stringify({ cards: [], check: [] })]);
    const result = await writeCardsForStep({
      contentDir: dir,
      slug: SLUG,
      step: STEP,
      deps: empty.deps,
      source: SOURCE,
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });

    expect(result.findings).toEqual([]);
    expect(readCards(dir, SLUG, STEP.id)).toBeNull();
  });

  it("шаг забракован аудитом — прежний файл остаётся нетронутым", async () => {
    const dir = tmpDir();
    const good = agent([GOOD]);
    await writeCardsForStep({
      contentDir: dir,
      slug: SLUG,
      step: STEP,
      deps: good.deps,
      source: SOURCE,
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });

    const bad = agent([RECYCLED, RECYCLED]);
    const result = await writeCardsForStep({
      contentDir: dir,
      slug: SLUG,
      step: STEP,
      deps: bad.deps,
      source: SOURCE,
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });

    expect(result.findings.map((f) => f.rule)).toContain("number-overlap");
    expect(readCards(dir, SLUG, STEP.id)).toHaveLength(1);
  });
});

describe("writeCardsForStep — материал вопроса", () => {
  it("срез исходника уходит в промпт", async () => {
    const { deps, prompts } = agent([GOOD]);
    await writeCardsForStep({
      contentDir: tmpDir(),
      slug: SLUG,
      step: STEP,
      deps,
      source: SOURCE,
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });

    expect(prompts[0]).toContain(
      "Кросс-энтропия необученной модели равна натуральному логарифму размера словаря",
    );
  });

  it("вопросы quiz.json уходят в промпт вместе с правильным ответом", async () => {
    const { deps, prompts } = agent([GOOD]);
    await writeCardsForStep({
      contentDir: tmpDir(),
      slug: SLUG,
      step: STEP,
      deps,
      source: fakeSource({
        quiz: [
          {
            stage: "post",
            question: "What does the rank of a matrix tell you?",
            options: ["The largest value", "The number of independent columns"],
            correct: 1,
            explanation: "Rank counts independent columns.",
          },
        ],
      }),
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });

    expect(prompts[0]).toContain("What does the rank of a matrix tell you?");
    expect(prompts[0]).toContain("The number of independent columns");
  });

  it("код шва упражнения уходит в промпт для code-шага", async () => {
    const exerciseDir = tmpDir();
    fs.mkdirSync(path.join(exerciseDir, "solution"));
    fs.writeFileSync(
      path.join(exerciseDir, "solution", "exercise.py"),
      "def transpose(M):\n    return [list(row) for row in zip(*M)]\n",
    );

    const { deps, prompts } = agent([GOOD]);
    await writeCardsForStep({
      contentDir: tmpDir(),
      slug: SLUG,
      step: { ...STEP, type: "code", exercise_fn: "transpose" },
      deps,
      source: fakeSource({
        exercise: {
          slug: "p01-l01-alpha",
          dir: exerciseDir,
          multi: false,
          functions: [{ file: "exercise.py", fn: "transpose" }],
        },
      }),
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });

    expect(prompts[0]).toContain("return [list(row) for row in zip(*M)]");
  });

  it("идеи, уже занятые карточками урока, уходят в промпт", async () => {
    const { deps, prompts } = agent([GOOD]);
    await writeCardsForStep({
      contentDir: tmpDir(),
      slug: SLUG,
      step: STEP,
      deps,
      source: SOURCE,
      sourceExcerpt: EXCERPT,
      coveredConcepts: ["длина вектора считается как корень из суммы квадратов координат"],
    });

    expect(prompts[0]).toContain(
      "длина вектора считается как корень из суммы квадратов координат",
    );
  });

  it("у первого шага урока занятых идей ещё нет", async () => {
    const { deps, prompts } = agent([GOOD]);
    await writeCardsForStep({
      contentDir: tmpDir(),
      slug: SLUG,
      step: STEP,
      deps,
      source: SOURCE,
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });

    expect(prompts[0]).toContain("это первые карточки урока");
  });

  it("шаг без шва кода не роняет сборку промпта", async () => {
    const { deps, prompts } = agent([GOOD]);
    await writeCardsForStep({
      contentDir: tmpDir(),
      slug: SLUG,
      step: STEP,
      deps,
      source: SOURCE,
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });

    expect(prompts[0]).toContain("не относится к конкретному шву кода");
  });
});

describe("writeCardsForStep — пропажа существующих check-вопросов", () => {
  it("у шага были вопросы, агент дважды вернул пустой список — замечание есть, ничего не пишется", async () => {
    const dir = tmpDir();
    const { deps } = agent([EMPTY_CHECK_REPLY, EMPTY_CHECK_REPLY]);
    const result = await writeCardsForStep({
      contentDir: dir,
      slug: SLUG,
      step: STEP_WITH_CHECK,
      deps,
      source: SOURCE,
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });

    expect(result.findings.map((f) => f.rule)).toContain("check-dropped");
    expect(result.check).toEqual([]);
    expect(readCards(dir, SLUG, STEP_WITH_CHECK.id)).toBeNull();
  });

  it("вопросы пропали в первом ответе и вернулись починенными во втором", async () => {
    const dir = tmpDir();
    const { deps, prompts } = agent([EMPTY_CHECK_REPLY, FIXED_CHECK_REPLY]);
    const result = await writeCardsForStep({
      contentDir: dir,
      slug: SLUG,
      step: STEP_WITH_CHECK,
      deps,
      source: SOURCE,
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("check-dropped");
    expect(result.check).toEqual([FIXED_CHECK_QUESTION]);
    expect(result.findings).toEqual([]);
  });

  it("у шага не было вопросов — пустой check в ответе не порождает замечания", async () => {
    const dir = tmpDir();
    const { deps } = agent([JSON.stringify({ cards: [], check: [] })]);
    const result = await writeCardsForStep({
      contentDir: dir,
      slug: SLUG,
      step: STEP,
      deps,
      source: SOURCE,
      sourceExcerpt: EXCERPT,
      coveredConcepts: [],
    });

    expect(result.check).toEqual([]);
    expect(result.findings).toEqual([]);
  });
});

// Пачка шагов: второй шаг нужен, чтобы отличить «агент промолчал про шаг» от
// «агент решил, что карточек здесь нет» — на одном шаге эти случаи неразличимы.
const STEP_TWO: Step = {
  id: "047-perehod",
  type: "theory",
  title: "Переход",
  body: "Дальше разберём, как считается перплексия.",
};

const EXCERPTS = new Map([
  [STEP.id, EXCERPT],
  [STEP_TWO.id, "## Perplexity\n\nПерплексия — экспонента кросс-энтропии."],
]);

describe("writeCardsForSteps — пачка шагов", () => {
  it("один вызов на всю пачку, карточки раскладываются по своим шагам", async () => {
    const dir = tmpDir();
    const { deps, prompts } = agent([
      batchReply([
        { id: STEP.id, cards: 2 },
        { id: STEP_TWO.id, cards: 1 },
      ]),
    ]);

    const results = await writeCardsForSteps({
      contentDir: dir,
      slug: SLUG,
      steps: [STEP, STEP_TWO],
      deps,
      source: SOURCE,
      sourceExcerpts: EXCERPTS,
      coveredConcepts: [],
    });

    expect(prompts).toHaveLength(1);
    expect(results.map((result) => result.cards.length)).toEqual([2, 1]);
    expect(readCards(dir, SLUG, STEP.id)).toHaveLength(2);
    expect(readCards(dir, SLUG, STEP_TWO.id)).toHaveLength(1);
  });

  it("материал обоих шагов уходит в один промпт", async () => {
    const { deps, prompts } = agent([
      batchReply([
        { id: STEP.id, cards: 1 },
        { id: STEP_TWO.id, cards: 1 },
      ]),
    ]);

    await writeCardsForSteps({
      contentDir: tmpDir(),
      slug: SLUG,
      steps: [STEP, STEP_TWO],
      deps,
      source: SOURCE,
      sourceExcerpts: EXCERPTS,
      coveredConcepts: [],
    });

    expect(prompts[0]).toContain("Перплексия — экспонента кросс-энтропии");
    expect(prompts[0]).toContain(
      "Кросс-энтропия необученной модели равна натуральному логарифму размера словаря",
    );
    expect(prompts[0]).toContain(STEP.id);
    expect(prompts[0]).toContain(STEP_TWO.id);
  });

  it("повтор уходит только по забракованному шагу, соседний не переписывается", async () => {
    const dir = tmpDir();
    const bad = {
      kind: "numeric",
      concept: "переписанное число из шага",
      question: "В словаре 65 символов. Чему равен loss?",
      answer: 4.17,
      tolerance: 0.01,
      explanation: "ln(65) ≈ 4.17.",
    };
    const first = JSON.stringify({
      steps: [
        { id: STEP.id, cards: [bad], check: [] },
        JSON.parse(batchReply([{ id: STEP_TWO.id, cards: 1 }])).steps[0],
      ],
    });

    const { deps, prompts } = agent([first, batchReply([{ id: STEP.id, cards: 1 }])]);
    const results = await writeCardsForSteps({
      contentDir: dir,
      slug: SLUG,
      steps: [STEP, STEP_TWO],
      deps,
      source: SOURCE,
      sourceExcerpts: EXCERPTS,
      coveredConcepts: [],
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("number-overlap");
    expect(prompts[1]).toContain(STEP.id);
    expect(prompts[1]).not.toContain(STEP_TWO.title);
    expect(results.every((result) => result.findings.length === 0)).toBe(true);
    expect(readCards(dir, SLUG, STEP.id)).toHaveLength(1);
    expect(readCards(dir, SLUG, STEP_TWO.id)).toHaveLength(1);
  });

  it("идеи, принятые в этой же пачке, уходят в повтор как занятые", async () => {
    const bad = {
      kind: "numeric",
      concept: "переписанное число из шага",
      question: "В словаре 65 символов. Чему равен loss?",
      answer: 4.17,
      tolerance: 0.01,
      explanation: "ln(65) ≈ 4.17.",
    };
    const first = JSON.stringify({
      steps: [
        { id: STEP.id, cards: [bad], check: [] },
        JSON.parse(batchReply([{ id: STEP_TWO.id, cards: 1 }])).steps[0],
      ],
    });

    const { deps, prompts } = agent([first, batchReply([{ id: STEP.id, cards: 1 }])]);
    await writeCardsForSteps({
      contentDir: tmpDir(),
      slug: SLUG,
      steps: [STEP, STEP_TWO],
      deps,
      source: SOURCE,
      sourceExcerpts: EXCERPTS,
      coveredConcepts: [],
    });

    expect(prompts[1]).toContain("идея номер 0 шага 047-perehod");
  });

  it("шаг, пропущенный в ответе, не считается шагом без карточек и не стирает диск", async () => {
    const dir = tmpDir();
    const full = agent([
      batchReply([
        { id: STEP.id, cards: 1 },
        { id: STEP_TWO.id, cards: 1 },
      ]),
    ]);
    await writeCardsForSteps({
      contentDir: dir,
      slug: SLUG,
      steps: [STEP, STEP_TWO],
      deps: full.deps,
      source: SOURCE,
      sourceExcerpts: EXCERPTS,
      coveredConcepts: [],
    });
    expect(readCards(dir, SLUG, STEP_TWO.id)).toHaveLength(1);

    // Обрыв ответа на середине: первый шаг разобран, второго в ответе нет.
    const cut = agent([batchReply([{ id: STEP.id, cards: 1 }])]);
    const results = await writeCardsForSteps({
      contentDir: dir,
      slug: SLUG,
      steps: [STEP, STEP_TWO],
      deps: cut.deps,
      source: SOURCE,
      sourceExcerpts: EXCERPTS,
      coveredConcepts: [],
    });

    expect(results[1].findings.map((finding) => finding.rule)).toContain("step-missing");
    expect(readCards(dir, SLUG, STEP_TWO.id)).toHaveLength(1);
  });

  it("пропущенный шаг переспрашивается один раз и принимается", async () => {
    const dir = tmpDir();
    const { deps, prompts } = agent([
      batchReply([{ id: STEP.id, cards: 1 }]),
      batchReply([{ id: STEP_TWO.id, cards: 1 }]),
    ]);

    const results = await writeCardsForSteps({
      contentDir: dir,
      slug: SLUG,
      steps: [STEP, STEP_TWO],
      deps,
      source: SOURCE,
      sourceExcerpts: EXCERPTS,
      coveredConcepts: [],
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("step-missing");
    expect(results[1].cards).toHaveLength(1);
    expect(readCards(dir, SLUG, STEP_TWO.id)).toHaveLength(1);
  });

  it("порядок результатов повторяет порядок шагов, а не порядок ответа", async () => {
    const { deps } = agent([
      batchReply([
        { id: STEP_TWO.id, cards: 1 },
        { id: STEP.id, cards: 2 },
      ]),
    ]);

    const results = await writeCardsForSteps({
      contentDir: tmpDir(),
      slug: SLUG,
      steps: [STEP, STEP_TWO],
      deps,
      source: SOURCE,
      sourceExcerpts: EXCERPTS,
      coveredConcepts: [],
    });

    expect(results.map((result) => result.stepId)).toEqual([STEP.id, STEP_TWO.id]);
    expect(results.map((result) => result.cards.length)).toEqual([2, 1]);
  });
});

// Карточка, ломающая схему по superRefine: индекс верного ответа вне списка
// вариантов. Ровно такой брак стоил уроку 27 фазы 14 шести шагов разом — до
// поштучного разбора он ронял safeParse всего ответа.
const BROKEN_CARD = {
  kind: "choice",
  concept: "защита от инъекции промпта",
  question: "Что делает фильтр на границе внешнего текста?",
  options: ["Отсекает инструкции", "Ничего"],
  correct: 7,
  explanation: "Индекс 7 вне списка из двух вариантов.",
};

describe("writeCardsForSteps — битая карточка в пачке", () => {
  it("роняет только свой шаг, соседний по пачке пишется на диск", async () => {
    const dir = tmpDir();
    const first = JSON.stringify({
      steps: [
        { id: STEP.id, cards: [BROKEN_CARD], check: [] },
        JSON.parse(batchReply([{ id: STEP_TWO.id, cards: 1 }])).steps[0],
      ],
    });

    const { deps, prompts } = agent([first, batchReply([{ id: STEP.id, cards: 1 }])]);
    const results = await writeCardsForSteps({
      contentDir: dir,
      slug: SLUG,
      steps: [STEP, STEP_TWO],
      deps,
      source: SOURCE,
      sourceExcerpts: EXCERPTS,
      coveredConcepts: [],
    });

    expect(readCards(dir, SLUG, STEP_TWO.id)).toHaveLength(1);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).not.toContain(STEP_TWO.title);
    expect(results.every((result) => result.findings.length === 0)).toBe(true);
    expect(readCards(dir, SLUG, STEP.id)).toHaveLength(1);
  });

  it("замечание называет поле, а не голое «не той формы»", async () => {
    const first = JSON.stringify({
      steps: [{ id: STEP.id, cards: [BROKEN_CARD], check: [] }],
    });

    const { deps, prompts } = agent([first, first]);
    const results = await writeCardsForSteps({
      contentDir: tmpDir(),
      slug: SLUG,
      steps: [STEP],
      deps,
      source: SOURCE,
      sourceExcerpts: EXCERPTS,
      coveredConcepts: [],
    });

    expect(results[0].findings.map((finding) => finding.rule)).toEqual(["step-malformed"]);
    expect(results[0].findings[0].message).toContain("correct");
    expect(prompts[1]).toContain("correct");
  });

  it("битый шаг отличается от пропущенного — правило другое", async () => {
    const first = JSON.stringify({
      steps: [
        { id: STEP.id, cards: [BROKEN_CARD], check: [] },
        // STEP_TWO в ответе отсутствует вовсе.
      ],
    });

    const { deps } = agent([first, first]);
    const results = await writeCardsForSteps({
      contentDir: tmpDir(),
      slug: SLUG,
      steps: [STEP, STEP_TWO],
      deps,
      source: SOURCE,
      sourceExcerpts: EXCERPTS,
      coveredConcepts: [],
    });

    expect(results[0].findings.map((finding) => finding.rule)).toEqual(["step-malformed"]);
    expect(results[1].findings.map((finding) => finding.rule)).toEqual(["step-missing"]);
  });
});
