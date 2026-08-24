import { describe, expect, it } from "vitest";
import { planMigration, readLocalProgress } from "./migrate";

const now = "2026-08-24T12:00:00.000Z";

describe("readLocalProgress", () => {
  it("превращает массив прочитанных в строки состояния", () => {
    const local = readLocalProgress(
      { "course-progress:lesson-a": JSON.stringify(["001-a", "002-b"]) },
      now,
    );
    expect(local.steps).toEqual([
      { lessonSlug: "lesson-a", stepId: "001-a", state: "read", updatedAt: now },
      { lessonSlug: "lesson-a", stepId: "002-b", state: "read", updatedAt: now },
    ]);
  });

  it("поднимает состояние практики над простым прочтением", () => {
    const local = readLocalProgress(
      {
        "course-progress:lesson-a": JSON.stringify(["001-a", "002-b"]),
        "course-step-state:lesson-a": JSON.stringify({ "002-b": "passed" }),
      },
      now,
    );
    expect(local.steps.find((row) => row.stepId === "002-b")?.state).toBe("passed");
    expect(local.steps.find((row) => row.stepId === "001-a")?.state).toBe("read");
  });

  it("разбирает ключи упражнений, включая многофайловые", () => {
    const local = readLocalProgress(
      {
        "course-exercise:ex-a": "one file",
        "course-exercise:ex-b:main.py": "multi file",
        "course-exercise:ex-b:main.py:updatedAt": "2026-08-20T00:00:00.000Z",
      },
      now,
    );
    expect(local.files).toEqual([
      { slug: "ex-a", fileName: "exercise.py", content: "one file" },
      {
        slug: "ex-b",
        fileName: "main.py",
        content: "multi file",
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
    ]);
  });

  it("пропускает служебные суффиксы", () => {
    const local = readLocalProgress(
      {
        "course-exercise:ex-a": "code",
        "course-exercise:ex-a:recovery": "broken",
        "course-exercise:ex-a:local-backup": "older",
      },
      now,
    );
    expect(local.files).toHaveLength(1);
    expect(local.files[0].content).toBe("code");
  });

  it("переживает мусор в хранилище", () => {
    const local = readLocalProgress(
      { "course-progress:lesson-a": "{не json", "course-step-state:lesson-a": "[]" },
      now,
    );
    expect(local.steps).toEqual([]);
    expect(local.files).toEqual([]);
  });
});

describe("planMigration", () => {
  const local = {
    steps: [
      { lessonSlug: "lesson-a", stepId: "001-a", state: "read" as const, updatedAt: now },
      { lessonSlug: "lesson-a", stepId: "002-b", state: "passed" as const, updatedAt: now },
    ],
    files: [{ slug: "ex-a", fileName: "exercise.py", content: "local code" }],
  };

  it("заливает всё, когда облако пустое", () => {
    const plan = planMigration(local, { steps: [], files: [] });
    expect(plan.steps).toHaveLength(2);
    expect(plan.files).toHaveLength(1);
    expect(plan.backups).toBe(0);
  });

  it("складывает результат слияния обратно в ключи localStorage", () => {
    const plan = planMigration(local, {
      steps: [
        { lessonSlug: "lesson-a", stepId: "003-c", state: "read", updatedAt: now },
      ],
      files: [],
    });
    expect(JSON.parse(plan.writes["course-progress:lesson-a"])).toEqual([
      "001-a",
      "002-b",
      "003-c",
    ]);
    expect(JSON.parse(plan.writes["course-step-state:lesson-a"])).toEqual({ "002-b": "passed" });
  });

  it("при разошедшемся коде без отметки времени кладёт копию и берёт облачный", () => {
    const plan = planMigration(local, {
      steps: [],
      files: [
        {
          slug: "ex-a",
          fileName: "exercise.py",
          content: "cloud code",
          updatedAt: "2026-08-20T00:00:00.000Z",
        },
      ],
    });
    expect(plan.files).toHaveLength(0);
    expect(plan.backups).toBe(1);
    expect(plan.writes["course-exercise:ex-a"]).toBe("cloud code");
    expect(plan.writes["course-exercise:ex-a:local-backup"]).toBe("local code");
  });

  it("на повторном прогоне не находит, что отправлять", () => {
    const cloud = { steps: local.steps, files: local.files };
    const plan = planMigration(local, cloud);
    expect(plan.steps).toEqual([]);
    expect(plan.files).toEqual([]);
    expect(plan.backups).toBe(0);
  });
});
