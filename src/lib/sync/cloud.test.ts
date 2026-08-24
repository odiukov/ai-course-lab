import { describe, expect, it } from "vitest";
import { type CloudReader, fileSyncEvents, pullCloud, snapshot, type StorageLike } from "./cloud";

/** Подставной клиент: по таблице отдаёт заранее уложенный ответ. */
function reader(
  answers: Record<string, { data?: Record<string, unknown>[]; error?: { message: string } }>,
): CloudReader {
  return {
    from(table) {
      return {
        select() {
          const answer = answers[table] ?? {};
          return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
        },
      };
    },
  };
}

/** Подставное хранилище: обычный объект с порядком ключей. */
function storage(values: Record<string, string>): StorageLike {
  const keys = Object.keys(values);
  return {
    get length() {
      return keys.length;
    },
    key: (index) => keys[index] ?? null,
    getItem: (key) => values[key] ?? null,
  };
}

describe("snapshot", () => {
  it("берёт только ключи с нужными приставками", () => {
    const result = snapshot(
      storage({
        "course-progress:lesson-a": "[]",
        "course-exercise:ex-a": "code",
        "sb-auth-token": "секрет",
      }),
      ["course-progress:", "course-exercise:"],
    );
    expect(result).toEqual({ "course-progress:lesson-a": "[]", "course-exercise:ex-a": "code" });
  });

  it("тихо отдаёт пустой снимок, когда хранилище бросает", () => {
    // Конфигурация с запрещённым хранилищем бросает и на length, и на key.
    // Человек в такой должен увидеть нынешнее поведение сайта, а не ошибку
    // слияния.
    const throwing: StorageLike = {
      get length(): number {
        throw new Error("storage disabled");
      },
      key: () => null,
      getItem: () => null,
    };
    expect(snapshot(throwing, ["course-progress:"])).toEqual({});
  });
});

describe("pullCloud", () => {
  it("переводит строки таблиц в строки слияния", async () => {
    const cloud = await pullCloud(
      reader({
        step_progress: {
          data: [
            {
              lesson_slug: "lesson-a",
              step_id: "001-a",
              state: "passed",
              updated_at: "2026-08-20T00:00:00.000Z",
            },
          ],
        },
        exercise_files: {
          data: [
            {
              slug: "ex-a",
              file_name: "exercise.py",
              content: "code",
              updated_at: "2026-08-21T00:00:00.000Z",
            },
          ],
        },
      }),
    );
    expect(cloud.steps).toEqual([
      {
        lessonSlug: "lesson-a",
        stepId: "001-a",
        state: "passed",
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
    ]);
    expect(cloud.files).toEqual([
      {
        slug: "ex-a",
        fileName: "exercise.py",
        content: "code",
        updatedAt: "2026-08-21T00:00:00.000Z",
      },
    ]);
  });

  it("бросает, когда отказала любая из двух выборок", async () => {
    // Отказ чтения нельзя принимать за пустое облако: вызывающий выставил бы
    // флаг «этот браузер уже влит», и набранное здесь не уехало бы никогда.
    await expect(
      pullCloud(reader({ step_progress: { error: { message: "нет доступа" } } })),
    ).rejects.toThrow("нет доступа");
    await expect(
      pullCloud(
        reader({
          step_progress: { data: [] },
          exercise_files: { error: { message: "файлы недоступны" } },
        }),
      ),
    ).rejects.toThrow("файлы недоступны");
  });

  it("на пустых таблицах отдаёт пустые списки", async () => {
    const cloud = await pullCloud(reader({}));
    expect(cloud).toEqual({ steps: [], files: [] });
  });
});

describe("fileSyncEvents", () => {
  it("разбирает ключи по тому же правилу, что и разбор хранилища", () => {
    expect(
      fileSyncEvents({
        "course-exercise:ex-a": "one file",
        "course-exercise:ex-b:main.py": "multi file",
      }),
    ).toEqual([
      { slug: "ex-a", fileName: "exercise.py", backup: false, content: "one file" },
      { slug: "ex-b", fileName: "main.py", backup: false, content: "multi file" },
    ]);
  });

  it("про отложенную копию сообщает без текста", () => {
    expect(fileSyncEvents({ "course-exercise:ex-a:local-backup": "older" })).toEqual([
      { slug: "ex-a", fileName: "exercise.py", backup: true, content: undefined },
    ]);
  });

  it("молчит про записи, которые не файлы упражнений", () => {
    expect(
      fileSyncEvents({
        "course-progress:lesson-a": "[]",
        "course-step-state:lesson-a": "{}",
        "course-exercise:ex-a:updatedAt": "2026-08-20T00:00:00.000Z",
      }),
    ).toEqual([]);
  });
});
