import { describe, expect, it } from "vitest";
import {
  LEGACY_UPDATED_AT,
  planMigration,
  readLocalProgress,
  splitExerciseKey,
} from "./migrate";

const early = "2026-08-20T00:00:00.000Z";
const late = "2026-08-23T00:00:00.000Z";

describe("splitExerciseKey", () => {
  it("отличает ключ без имени файла от ключа с именем", () => {
    expect(splitExerciseKey("course-exercise:ex-a")).toEqual({
      slug: "ex-a",
      fileName: "exercise.py",
      single: true,
    });
    expect(splitExerciseKey("course-exercise:ex-b:main.py")).toEqual({
      slug: "ex-b",
      fileName: "main.py",
      single: false,
    });
  });

  it("не разбирает чужие ключи", () => {
    expect(splitExerciseKey("course-progress:lesson-a")).toBeNull();
  });
});

describe("readLocalProgress", () => {
  it("превращает массив прочитанных в строки состояния", () => {
    const local = readLocalProgress({
      "course-progress:lesson-a": JSON.stringify(["001-a", "002-b"]),
    });
    expect(local.steps).toEqual([
      { lessonSlug: "lesson-a", stepId: "001-a", state: "read", updatedAt: LEGACY_UPDATED_AT },
      { lessonSlug: "lesson-a", stepId: "002-b", state: "read", updatedAt: LEGACY_UPDATED_AT },
    ]);
  });

  it("берёт время изменения состояния из записи, а не из времени разбора", () => {
    const local = readLocalProgress({
      "course-step-state:lesson-a": JSON.stringify({
        "002-b": { state: "passed", updatedAt: early },
      }),
    });
    expect(local.steps).toEqual([
      { lessonSlug: "lesson-a", stepId: "002-b", state: "passed", updatedAt: early },
    ]);
  });

  it("читает и голую строку состояния — форму первых дней ключа", () => {
    const local = readLocalProgress({
      "course-step-state:lesson-a": JSON.stringify({ "002-b": "failed" }),
    });
    // Времени у такой записи нет, и подставлять его нечем: ничья с облаком
    // должна достаться той стороне, у которой время настоящее.
    expect(local.steps).toEqual([
      { lessonSlug: "lesson-a", stepId: "002-b", state: "failed", updatedAt: LEGACY_UPDATED_AT },
    ]);
  });

  it("поднимает состояние практики над простым прочтением", () => {
    const local = readLocalProgress({
      "course-progress:lesson-a": JSON.stringify(["001-a", "002-b"]),
      "course-step-state:lesson-a": JSON.stringify({
        "002-b": { state: "passed", updatedAt: early },
      }),
    });
    expect(local.steps.find((row) => row.stepId === "002-b")?.state).toBe("passed");
    expect(local.steps.find((row) => row.stepId === "001-a")?.state).toBe("read");
  });

  it("разбирает ключи упражнений, включая многофайловые", () => {
    const local = readLocalProgress({
      "course-exercise:ex-a": "one file",
      "course-exercise:ex-b:main.py": "multi file",
      "course-exercise:ex-b:main.py:updatedAt": early,
    });
    expect(local.files).toEqual([
      { slug: "ex-a", fileName: "exercise.py", content: "one file", single: true },
      {
        slug: "ex-b",
        fileName: "main.py",
        content: "multi file",
        single: false,
        updatedAt: early,
      },
    ]);
  });

  it("не принимает ключ без имени файла за файл, когда у упражнения есть именованные", () => {
    // Первая опубликованная многофайловая версия держала main.py под ключом
    // без имени. Уехав в облако под подставным `exercise.py`, он вернулся бы на
    // другое устройство в ключ без имени и подменил бы собой заготовку урока.
    const local = readLocalProgress({
      "course-exercise:ex-b": "legacy main",
      "course-exercise:ex-b:main.py": "multi file",
    });
    expect(local.files).toEqual([
      { slug: "ex-b", fileName: "main.py", content: "multi file", single: false },
    ]);
  });

  it("пропускает служебные суффиксы", () => {
    const local = readLocalProgress({
      "course-exercise:ex-a": "code",
      "course-exercise:ex-a:recovery": "broken",
      "course-exercise:ex-a:local-backup": "older",
    });
    expect(local.files).toHaveLength(1);
    expect(local.files[0].content).toBe("code");
  });

  it("переживает мусор в хранилище", () => {
    const local = readLocalProgress({
      "course-progress:lesson-a": "{не json",
      "course-step-state:lesson-a": "[]",
    });
    expect(local.steps).toEqual([]);
    expect(local.files).toEqual([]);
  });
});

describe("planMigration", () => {
  const local = {
    steps: [
      {
        lessonSlug: "lesson-a",
        stepId: "001-a",
        state: "read" as const,
        updatedAt: LEGACY_UPDATED_AT,
      },
      { lessonSlug: "lesson-a", stepId: "002-b", state: "passed" as const, updatedAt: early },
    ],
    files: [{ slug: "ex-a", fileName: "exercise.py", content: "local code", single: true }],
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
        { lessonSlug: "lesson-a", stepId: "003-c", state: "read", updatedAt: LEGACY_UPDATED_AT },
      ],
      files: [],
    });
    expect(JSON.parse(plan.writes["course-progress:lesson-a"])).toEqual([
      "001-a",
      "002-b",
      "003-c",
    ]);
    expect(JSON.parse(plan.writes["course-step-state:lesson-a"])).toEqual({
      "002-b": { state: "passed", updatedAt: early },
    });
  });

  it("при разошедшемся коде без отметки времени кладёт копию и берёт облачный", () => {
    const plan = planMigration(local, {
      steps: [],
      files: [{ slug: "ex-a", fileName: "exercise.py", content: "cloud code", updatedAt: early }],
    });
    expect(plan.files).toHaveLength(0);
    expect(plan.backups).toBe(1);
    expect(plan.writes["course-exercise:ex-a"]).toBe("cloud code");
    expect(plan.writes["course-exercise:ex-a:local-backup"]).toBe("local code");
  });

  it("пишет облачный файл многофайлового упражнения в ключ с именем файла", () => {
    const plan = planMigration(
      {
        steps: [],
        files: [{ slug: "ex-b", fileName: "main.py", content: "local", single: false }],
      },
      {
        steps: [],
        files: [{ slug: "ex-b", fileName: "main.py", content: "cloud", updatedAt: late }],
      },
    );
    expect(plan.writes["course-exercise:ex-b:main.py"]).toBe("cloud");
    expect(plan.writes["course-exercise:ex-b"]).toBeUndefined();
  });

  it("на повторном прогоне не находит, что отправлять", () => {
    const cloud = { steps: local.steps, files: local.files };
    const plan = planMigration(local, cloud);
    expect(plan.steps).toEqual([]);
    expect(plan.files).toEqual([]);
    expect(plan.backups).toBe(0);
  });

  it("второй заход на другой день не отправляет ничего заново", () => {
    // Раньше каждая строка получала время открытия страницы, и оно всегда было
    // свежее облачного: браузер переотправлял всю историю чтения на каждом
    // переходе. Здесь заходы разнесены во времени намеренно — время открытия
    // страницы в строки больше не попадает вовсе, поэтому второй заход пуст.
    const storage: Record<string, string> = {
      "course-progress:lesson-a": JSON.stringify(["001-a", "002-b"]),
      "course-step-state:lesson-a": JSON.stringify({
        "002-b": { state: "passed", updatedAt: early },
      }),
      "course-exercise:ex-a": "local code",
      "course-exercise:ex-a:updatedAt": early,
    };

    const first = planMigration(readLocalProgress(storage), { steps: [], files: [] });
    expect(first.steps).toHaveLength(2);
    expect(first.files).toHaveLength(1);

    // Отправленное осело в облаке, записи слияния — в браузере.
    const cloud = { steps: first.steps, files: first.files };
    Object.assign(storage, first.writes);

    const second = planMigration(readLocalProgress(storage), cloud);
    expect(second.steps).toEqual([]);
    expect(second.files).toEqual([]);
    expect(second.backups).toBe(0);
  });

  it("не затирает облачный failed локальным «прочитан» с другого устройства", () => {
    // На втором устройстве шаг провален, здесь он просто прочитан. Ранги
    // равны, и раньше локальная строка со временем открытия страницы всегда
    // побеждала — красный прогон терялся при первом же открытии.
    const storage = { "course-progress:lesson-a": JSON.stringify(["001-a"]) };
    const cloud = {
      steps: [
        { lessonSlug: "lesson-a", stepId: "001-a", state: "failed" as const, updatedAt: late },
      ],
      files: [],
    };

    const plan = planMigration(readLocalProgress(storage), cloud);
    expect(plan.steps).toEqual([]);
    expect(JSON.parse(plan.writes["course-step-state:lesson-a"])).toEqual({
      "001-a": { state: "failed", updatedAt: late },
    });
  });
});
