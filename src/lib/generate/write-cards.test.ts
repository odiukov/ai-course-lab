import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCards } from "../cards/card";
import type { Step } from "../content/step-file";
import { parseCardsReply, writeCardsForStep } from "./write-cards";

const SLUG = "01-math__01-alpha";

const STEP: Step = {
  id: "046-quiz",
  type: "theory",
  title: "Стартовый loss",
  body: "Стартовый loss при словаре из 65 символов равен примерно 4.17.",
};

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
    const result = await writeCardsForStep({ contentDir: dir, slug: SLUG, step: STEP, deps });

    expect(result.findings).toEqual([]);
    expect(result.cards).toHaveLength(1);
    expect(readCards(dir, SLUG, "046-quiz")).toHaveLength(1);
  });

  it("переспрашивает один раз, отдав замечания, и принимает исправленное", async () => {
    const dir = tmpDir();
    const { deps, prompts } = agent([RECYCLED, GOOD]);
    const result = await writeCardsForStep({ contentDir: dir, slug: SLUG, step: STEP, deps });

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("number-overlap");
    expect(result.findings).toEqual([]);
    expect(readCards(dir, SLUG, "046-quiz")).toHaveLength(1);
  });

  it("на повторном провале ничего не пишет и возвращает замечания", async () => {
    const dir = tmpDir();
    const { deps } = agent([RECYCLED, RECYCLED]);
    const result = await writeCardsForStep({ contentDir: dir, slug: SLUG, step: STEP, deps });

    expect(result.findings.map((f) => f.rule)).toContain("number-overlap");
    expect(result.cards).toEqual([]);
    expect(readCards(dir, SLUG, "046-quiz")).toBeNull();
  });

  it("пустой список карточек — законный ответ для шага без запоминаемой идеи", async () => {
    const dir = tmpDir();
    const { deps } = agent([JSON.stringify({ cards: [], check: [] })]);
    const result = await writeCardsForStep({ contentDir: dir, slug: SLUG, step: STEP, deps });

    expect(result.cards).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(readCards(dir, SLUG, "046-quiz")).toBeNull();
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
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("check-dropped");
    expect(result.check).toEqual([FIXED_CHECK_QUESTION]);
    expect(result.findings).toEqual([]);
  });

  it("у шага не было вопросов — пустой check в ответе не порождает замечания", async () => {
    const dir = tmpDir();
    const { deps } = agent([JSON.stringify({ cards: [], check: [] })]);
    const result = await writeCardsForStep({ contentDir: dir, slug: SLUG, step: STEP, deps });

    expect(result.check).toEqual([]);
    expect(result.findings).toEqual([]);
  });
});
