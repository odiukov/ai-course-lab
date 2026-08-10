import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StepMeta } from "../content/step-file";
import { execute, openProgressDb } from "./db";
import {
  markStepOpened,
  markStepRead,
  readLessonProgress,
  readLessonReadCounts,
  resumeIndex,
} from "./steps";

const SLUG = "01-math-foundations__02-beta";

const STEPS: StepMeta[] = [
  { id: "001-t", type: "theory", title: "Зачем" },
  { id: "002-t", type: "theory", title: "Вектор" },
  { id: "003-t", type: "theory", title: "Матрица" },
];

function freshDb() {
  const dataDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "steps-db-")), "data");
  return openProgressDb(dataDir);
}

describe("markStepOpened", () => {
  it("на пустой базе у урока нет ни одного шага", () => {
    const progress = readLessonProgress(freshDb(), SLUG);
    expect(progress.steps).toEqual([]);
    expect(progress.readStepIds).toEqual([]);
    expect(progress.resumeStepId).toBeNull();
  });

  it("записывает открытие как состояние unopened с датой", () => {
    const db = freshDb();
    markStepOpened(db, SLUG, "001-t", "2026-08-10T09:00:00.000Z");

    const [first] = readLessonProgress(db, SLUG).steps;
    expect(first.state).toBe("unopened");
    expect(first.openedAt).toBe("2026-08-10T09:00:00.000Z");
    expect(first.readAt).toBeNull();
  });

  it("повторное открытие обновляет дату, но не сбрасывает прочитанность", () => {
    const db = freshDb();
    markStepRead(db, SLUG, "001-t", "2026-08-10T09:00:00.000Z");
    markStepOpened(db, SLUG, "001-t", "2026-08-10T10:00:00.000Z");

    const [first] = readLessonProgress(db, SLUG).steps;
    expect(first.state).toBe("read");
    expect(first.openedAt).toBe("2026-08-10T10:00:00.000Z");
    expect(first.readAt).toBe("2026-08-10T09:00:00.000Z");
  });

  it("повторное открытие одного и того же шага не создаёт вторую строку", () => {
    const db = freshDb();
    markStepOpened(db, SLUG, "001-t", "2026-08-10T09:00:00.000Z");
    markStepOpened(db, SLUG, "001-t", "2026-08-10T09:05:00.000Z");
    markStepOpened(db, SLUG, "001-t", "2026-08-10T09:10:00.000Z");

    expect(readLessonProgress(db, SLUG).steps).toHaveLength(1);
  });
});

describe("markStepRead", () => {
  it("переводит шаг в read и добавляет его в readStepIds", () => {
    const db = freshDb();
    markStepOpened(db, SLUG, "001-t", "2026-08-10T09:00:00.000Z");
    markStepRead(db, SLUG, "001-t", "2026-08-10T09:01:00.000Z");

    expect(readLessonProgress(db, SLUG).readStepIds).toEqual(["001-t"]);
  });

  it("повторная отметка read не создаёт вторую строку и не теряет исходную дату", () => {
    const db = freshDb();
    markStepOpened(db, SLUG, "001-t", "2026-08-10T09:00:00.000Z");
    markStepRead(db, SLUG, "001-t", "2026-08-10T09:01:00.000Z");
    markStepRead(db, SLUG, "001-t", "2026-08-10T09:30:00.000Z");

    const progress = readLessonProgress(db, SLUG);
    expect(progress.steps).toHaveLength(1);
    const [first] = progress.steps;
    expect(first.state).toBe("read");
    expect(first.readAt).toBe("2026-08-10T09:01:00.000Z");
  });

  // Осознанное поведение, не забытый случай: если markStepRead приходит на
  // шаг, для которого markStepOpened никогда не вызывали (например, шаг
  // отмечается прочитанным сразу по завершении показа, без отдельного
  // события открытия), INSERT подставляет opened_at тем же значением, что
  // и read_at — шаг всё равно был открыт, просто без отдельного вызова.
  it("на шаге, который не открывали явно, opened_at подставляется равным read_at", () => {
    const db = freshDb();
    markStepRead(db, SLUG, "005-t", "2026-08-10T09:00:00.000Z");

    const found = readLessonProgress(db, SLUG).steps.find((step) => step.stepId === "005-t");
    expect(found?.state).toBe("read");
    expect(found?.openedAt).toBe("2026-08-10T09:00:00.000Z");
    expect(found?.readAt).toBe("2026-08-10T09:00:00.000Z");
  });

  it("не понижает пройденный шаг обратно до read", () => {
    const db = freshDb();
    execute(
      db,
      "INSERT INTO step_state (lesson_slug, step_id, state, opened_at, read_at) VALUES (?, ?, 'passed', ?, ?)",
      SLUG,
      "002-t",
      "2026-08-10T09:00:00.000Z",
      "2026-08-10T09:05:00.000Z",
    );
    markStepRead(db, SLUG, "002-t", "2026-08-10T10:00:00.000Z");

    const found = readLessonProgress(db, SLUG).steps.find((step) => step.stepId === "002-t");
    expect(found?.state).toBe("passed");
    expect(found?.readAt).toBe("2026-08-10T09:05:00.000Z");
  });
});

describe("resumeStepId и resumeIndex", () => {
  it("возвращают последний открытый шаг (урок пройден не по порядку)", () => {
    const db = freshDb();
    markStepOpened(db, SLUG, "001-t", "2026-08-10T09:00:00.000Z");
    markStepOpened(db, SLUG, "003-t", "2026-08-10T09:30:00.000Z");
    markStepOpened(db, SLUG, "002-t", "2026-08-10T09:10:00.000Z");

    const progress = readLessonProgress(db, SLUG);
    expect(progress.resumeStepId).toBe("003-t");
    expect(resumeIndex(progress, STEPS)).toBe(2);
  });

  it("урок, который никогда не открывали, отдаёт нулевую позицию", () => {
    expect(resumeIndex(readLessonProgress(freshDb(), SLUG), STEPS)).toBe(0);
  });

  it("полностью прочитанный урок отдаёт позицию последнего шага плана", () => {
    const db = freshDb();
    markStepOpened(db, SLUG, "001-t", "2026-08-10T09:00:00.000Z");
    markStepRead(db, SLUG, "001-t", "2026-08-10T09:01:00.000Z");
    markStepOpened(db, SLUG, "002-t", "2026-08-10T09:01:00.000Z");
    markStepRead(db, SLUG, "002-t", "2026-08-10T09:02:00.000Z");
    markStepOpened(db, SLUG, "003-t", "2026-08-10T09:02:00.000Z");
    markStepRead(db, SLUG, "003-t", "2026-08-10T09:03:00.000Z");

    const progress = readLessonProgress(db, SLUG);
    expect(progress.readStepIds).toEqual(["001-t", "002-t", "003-t"]);
    expect(resumeIndex(progress, STEPS)).toBe(2);
  });

  it("отдают ноль, если сохранённого шага больше нет в плане и ничего не читали (план был перегенерирован)", () => {
    const db = freshDb();
    markStepOpened(db, SLUG, "099-выпилен", "2026-08-10T09:00:00.000Z");
    expect(resumeIndex(readLessonProgress(db, SLUG), STEPS)).toBe(0);
  });

  // Сохранённый resumeStepId ("012-c" ниже) — из старого плана и не входит
  // в новый. Обнулять прогресс в такой ситуации выбрасывает то немногое,
  // что известно: число уже прочитанных шагов. Оно и берётся как
  // приближение к позиции в новом плане — id шагов zero-padded и идут по
  // порядку, поэтому «прочитано 2 шага» разумно ложится на «шаг с индексом
  // 2 в новом плане», даже если конкретные id разные.
  it("план перегенерировали: если что-то прочитали, приземляет рядом с их количеством, а не в начале", () => {
    const db = freshDb();
    markStepRead(db, SLUG, "010-a", "2026-08-10T09:00:00.000Z");
    markStepRead(db, SLUG, "011-b", "2026-08-10T09:10:00.000Z");
    markStepOpened(db, SLUG, "012-c", "2026-08-10T09:20:00.000Z");

    const newSteps: StepMeta[] = [
      { id: "001-t", type: "theory", title: "Зачем" },
      { id: "002-t", type: "theory", title: "Вектор" },
      { id: "003-t", type: "theory", title: "Матрица" },
      { id: "004-t", type: "theory", title: "Норма" },
      { id: "005-t", type: "theory", title: "Скаляр" },
    ];

    const progress = readLessonProgress(db, SLUG);
    expect(progress.resumeStepId).toBe("012-c");
    expect(progress.readStepIds).toHaveLength(2);
    expect(resumeIndex(progress, newSteps)).toBe(2);
  });

  it("план перегенерировали и стал короче: приближение не выходит за последний индекс нового плана", () => {
    const db = freshDb();
    for (let i = 0; i < 12; i += 1) {
      const oldId = `${String(i + 1).padStart(3, "0")}-old`;
      markStepRead(db, SLUG, oldId, `2026-08-10T${String(9 + i).padStart(2, "0")}:00:00.000Z`);
    }

    const newSteps: StepMeta[] = [
      { id: "001-t", type: "theory", title: "Зачем" },
      { id: "002-t", type: "theory", title: "Вектор" },
      { id: "003-t", type: "theory", title: "Матрица" },
    ];

    const progress = readLessonProgress(db, SLUG);
    expect(progress.readStepIds).toHaveLength(12);
    expect(resumeIndex(progress, newSteps)).toBe(newSteps.length - 1);
  });
});

describe("readLessonReadCounts", () => {
  it("считает прочитанные шаги по урокам", () => {
    const db = freshDb();
    markStepRead(db, SLUG, "001-t", "2026-08-10T09:00:00.000Z");
    markStepRead(db, SLUG, "002-t", "2026-08-10T09:10:00.000Z");
    markStepOpened(db, SLUG, "003-t", "2026-08-10T09:20:00.000Z");
    markStepRead(db, "02-ml-fundamentals__01-gamma", "001-t", "2026-08-10T09:30:00.000Z");

    const counts = readLessonReadCounts(db);
    expect(counts.get(SLUG)).toBe(2);
    expect(counts.get("02-ml-fundamentals__01-gamma")).toBe(1);
  });
});
