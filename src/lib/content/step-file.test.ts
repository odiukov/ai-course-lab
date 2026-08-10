import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseStep, readStepsById, serializeStep, writeStep, type Step } from "./step-file";

const SAMPLE = `---
id: "003-broadcasting"
type: theory
title: Броадкастинг
source_anchor: "## Broadcasting"
---

Тело шага.
`;

describe("parseStep", () => {
  it("читает frontmatter и тело", () => {
    const step = parseStep(SAMPLE);
    expect(step.id).toBe("003-broadcasting");
    expect(step.type).toBe("theory");
    expect(step.title).toBe("Броадкастинг");
    expect(step.body.trim()).toBe("Тело шага.");
  });

  it("падает на неизвестном типе", () => {
    expect(() => parseStep(SAMPLE.replace("type: theory", "type: video")))
      .toThrow(/type/);
  });

  it("падает без id", () => {
    expect(() => parseStep(SAMPLE.replace('id: "003-broadcasting"\n', "")))
      .toThrow(/id/);
  });

  it("читает вопросы шага check", () => {
    const md = `---
id: "004-check"
type: check
title: Проверка
check:
  - question: Что должно совпасть?
    options: ["внешние", "внутренние"]
    correct: 1
    explanation: Столбцы A равны строкам B.
---
`;
    const step = parseStep(md);
    expect(step.check?.[0].correct).toBe(1);
  });

  it("отклоняет пустой visual_brief", () => {
    const markdown = [
      "---",
      "id: 001-v",
      "type: visual",
      "title: Схема",
      'visual_brief: ""',
      "---",
      "",
      "Текст.",
    ].join("\n");

    expect(() => parseStep(markdown)).toThrow();
  });
});

describe("serializeStep", () => {
  it("делает полный круг без потерь", () => {
    const step: Step = {
      id: "005-matmul",
      type: "code",
      title: "Пишем matmul",
      exercise_fn: "matmul",
      body: "Реализуй функцию.",
    };
    const round = parseStep(serializeStep(step));
    expect(round).toEqual(step);
  });

  it("не пишет пустые поля", () => {
    const out = serializeStep({ id: "001-a", type: "theory", title: "А", body: "Б" });
    expect(out).not.toContain("visual");
    expect(out).not.toContain("exercise_fn");
    // Must contain required fields with correct values
    expect(out).toContain("id: 001-a");
    expect(out).toContain("type: theory");
    expect(out).toContain("title: А");
  });
});

describe("readStepsById", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function contentDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steps-"));
    dirs.push(dir);
    return dir;
  }

  it("отдаёт написанные шаги под их id, а дыры просто отсутствуют", () => {
    const dir = contentDir();
    const ids = ["001-a", "002-b", "003-c", "004-d"];
    for (const id of ["002-b", "004-d"]) {
      writeStep(dir, "slug", { id, type: "theory", title: `Шаг ${id}`, body: `тело ${id}` });
    }

    const steps = readStepsById(dir, "slug", ids);

    expect(Object.keys(steps).sort()).toEqual(["002-b", "004-d"]);
    // Ключ — id из плана, а не позиция: дыра на 001 не сдвигает 002 на нулевое место.
    expect(steps["002-b"].body).toBe("тело 002-b");
    expect(steps["001-a"]).toBeUndefined();
    expect(steps["003-c"]).toBeUndefined();
  });

  it("на пустой директории отдаёт пустой объект, а не падает", () => {
    expect(readStepsById(contentDir(), "slug", ["001-a"])).toEqual({});
  });
});
