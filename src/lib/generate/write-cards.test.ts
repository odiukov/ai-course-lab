import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCards } from "../cards/card";
import type { Step } from "../content/step-file";
import type { LessonSource } from "../source/lesson-source";
import { parseCardsReply, writeCardsForStep } from "./write-cards";

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
    const parsed = parseCardsReply(`Вот карточки:\n\`\`\`json\n${GOOD}\n\`\`\`\nГотово.`);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.check).toEqual([]);
  });

  it("на мусоре вместо JSON возвращает пустые списки, а не бросает", () => {
    expect(parseCardsReply("Извини, не понял задачу.")).toEqual({ cards: [], check: [] });
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
