import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LessonPlan } from "./lesson-plan";
import {
  formatCourseContext,
  formatPhaseOutlines,
  readPhaseOutlines,
  readPreviousPhases,
} from "./phase-outlines";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "outlines-"));
}

function writePlan(contentDir: string, slug: string, title: string, titles: string[]): void {
  const plan: LessonPlan = {
    slug,
    title,
    lang: "ru",
    sourcePath: "source/x.md",
    sourceHash: "hash",
    generatedAt: "2026-08-11T00:00:00.000Z",
    steps: titles.map((stepTitle, index) => ({
      id: `${String(index + 1).padStart(3, "0")}-s`,
      type: "theory" as const,
      title: stepTitle,
    })),
  };
  const dir = path.join(contentDir, "lessons", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "lesson.json"), JSON.stringify(plan), "utf8");
}

describe("readPhaseOutlines", () => {
  it("без соседей отдаёт пустой список", () => {
    const contentDir = tmpDir();
    writePlan(contentDir, "01-math__01-alpha", "Alpha", ["Вектор"]);
    expect(readPhaseOutlines(contentDir, "01-math__01-alpha")).toEqual([]);
  });

  it("собирает соседей своей фазы и сортирует по номеру урока", () => {
    const contentDir = tmpDir();
    writePlan(contentDir, "01-math__03-gamma", "Gamma", ["Ранг"]);
    writePlan(contentDir, "01-math__01-alpha", "Alpha", ["Вектор", "Длина"]);
    writePlan(contentDir, "01-math__02-beta", "Beta", ["Матрица"]);

    const outlines = readPhaseOutlines(contentDir, "01-math__02-beta");

    expect(outlines.map((o) => o.number)).toEqual([1, 3]);
    expect(outlines[0].title).toBe("Alpha");
    expect(outlines[0].steps.map((s) => s.title)).toEqual(["Вектор", "Длина"]);
  });

  // Соседняя фаза — другой предмет; тащить её оглавление значит забивать
  // промпт тем, на что урок всё равно не должен ссылаться.
  it("не берёт уроки чужой фазы", () => {
    const contentDir = tmpDir();
    writePlan(contentDir, "01-math__01-alpha", "Alpha", ["Вектор"]);
    writePlan(contentDir, "02-ml__01-delta", "Delta", ["Регрессия"]);
    expect(readPhaseOutlines(contentDir, "01-math__01-alpha")).toEqual([]);
  });

  it("пропускает урок, у которого плана ещё нет", () => {
    const contentDir = tmpDir();
    writePlan(contentDir, "01-math__01-alpha", "Alpha", ["Вектор"]);
    fs.mkdirSync(path.join(contentDir, "lessons", "01-math__02-beta"), { recursive: true });
    expect(readPhaseOutlines(contentDir, "01-math__01-alpha")).toEqual([]);
  });

  it("не падает, когда каталога контента ещё нет", () => {
    expect(readPhaseOutlines(path.join(tmpDir(), "нет"), "01-math__01-alpha")).toEqual([]);
  });
});

describe("readPreviousPhases", () => {
  it("берёт фазы с меньшим номером и сортирует их по порядку курса", () => {
    const contentDir = tmpDir();
    writePlan(contentDir, "03-dl__01-perceptron", "Perceptron", ["Нейрон"]);
    writePlan(contentDir, "01-math__20-fourier", "Fourier Transform", ["Спектр"]);
    writePlan(contentDir, "02-ml__05-svm", "SVM", ["Зазор"]);

    const phases = readPreviousPhases(contentDir, "03-dl__01-perceptron");

    expect(phases.map((phase) => phase.number)).toEqual([1, 2]);
    expect(phases[0].title).toBe("Math");
    expect(phases[0].lessons).toEqual([{ number: 20, title: "Fourier Transform" }]);
  });

  // Своя фаза приезжает отдельно и подробно, шагами: попади она ещё и сюда,
  // планировщик увидел бы соседей дважды.
  it("не берёт свою фазу и фазы после неё", () => {
    const contentDir = tmpDir();
    writePlan(contentDir, "02-ml__01-alpha", "Alpha", ["Регрессия"]);
    writePlan(contentDir, "02-ml__02-beta", "Beta", ["Классификация"]);
    writePlan(contentDir, "03-dl__01-gamma", "Gamma", ["Нейрон"]);

    expect(readPreviousPhases(contentDir, "02-ml__01-alpha")).toEqual([]);
  });

  it("пропускает урок без плана и не падает без каталога контента", () => {
    const contentDir = tmpDir();
    writePlan(contentDir, "01-math__01-alpha", "Alpha", ["Вектор"]);
    fs.mkdirSync(path.join(contentDir, "lessons", "01-math__02-beta"), { recursive: true });

    const phases = readPreviousPhases(contentDir, "02-ml__01-delta");

    expect(phases).toHaveLength(1);
    expect(phases[0].lessons.map((lesson) => lesson.number)).toEqual([1]);
    expect(readPreviousPhases(path.join(tmpDir(), "нет"), "02-ml__01-delta")).toEqual([]);
  });
});

describe("formatCourseContext", () => {
  it("своя фаза идёт шагами, пройденные — только названиями уроков", () => {
    const text = formatCourseContext(
      [
        {
          slug: "06-speech__01-alpha",
          number: 1,
          title: "Audio Fundamentals",
          steps: [{ title: "Звук как волна", type: "theory" }],
        },
      ],
      [
        {
          number: 1,
          title: "Math",
          lessons: [{ number: 20, title: "Fourier Transform" }],
        },
      ],
    );

    expect(text).toContain("Урок 1. Audio Fundamentals");
    expect(text).toContain("  - Звук как волна");
    expect(text).toContain("Фаза 1. Math");
    expect(text).toContain("20. Fourier Transform");
  });

  it("без пройденных фаз печатает только свою", () => {
    const text = formatCourseContext([], []);
    expect(text).toMatch(/нет/);
  });
});

describe("formatPhaseOutlines", () => {
  it("без соседей говорит об этом словами, а не пустотой", () => {
    expect(formatPhaseOutlines([])).toMatch(/нет/);
  });

  it("номер урока попадает в текст: по нему видно, что раньше, а что позже", () => {
    const text = formatPhaseOutlines([
      {
        slug: "01-math__01-alpha",
        number: 1,
        title: "Alpha",
        steps: [
          { title: "Вектор", type: "theory" },
          { title: "Длина", type: "theory" },
        ],
      },
    ]);
    expect(text).toContain("Урок 1. Alpha");
    expect(text).toContain("  - Вектор");
    expect(text).toContain("  - Длина");
  });

  // Урок, в котором тему ПИШУТ руками, владеет ею вернее того, где её
  // упомянули: планировщик должен видеть, чем тема закреплена.
  it("помечает шаг, который закрепляет тему упражнением", () => {
    const text = formatPhaseOutlines([
      {
        slug: "01-math__01-alpha",
        number: 1,
        title: "Alpha",
        steps: [{ title: "Пишем dot", type: "code", fn: "dot" }],
      },
    ]);
    expect(text).toContain("Пишем dot [пишут dot]");
  });
});
