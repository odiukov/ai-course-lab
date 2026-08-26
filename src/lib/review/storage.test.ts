import { describe, expect, it } from "vitest";
import { readLessonStates, writeCardState, type StoredState } from "./storage";

function fakeStorage(seed: Record<string, string> = {}) {
  const data = { ...seed };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

function stored(over: Partial<StoredState> = {}): StoredState {
  return {
    intervalDays: 6,
    ease: 2.5,
    reps: 2,
    lapses: 0,
    dueOn: "2026-09-02",
    fingerprint: "abcd1234",
    updatedAt: "2026-08-26T10:00:00.000Z",
    ...over,
  };
}

describe("readLessonStates", () => {
  it("читает записанное", () => {
    const storage = fakeStorage();
    writeCardState(storage, "01-alpha", "s-1", stored());
    expect(readLessonStates(storage, "01-alpha")["s-1"]).toEqual(stored());
  });

  it("на отсутствующем уроке возвращает пустой объект", () => {
    expect(readLessonStates(fakeStorage(), "01-alpha")).toEqual({});
  });

  it("на битом JSON возвращает пустой объект, а не бросает", () => {
    const storage = fakeStorage({ "course-review:01-alpha": "{не json" });
    expect(readLessonStates(storage, "01-alpha")).toEqual({});
  });

  it("переживает хранилище, которое бросает на чтении", () => {
    const throwing = {
      getItem: () => {
        throw new Error("приватное окно Safari");
      },
      setItem: () => {},
    };
    expect(readLessonStates(throwing, "01-alpha")).toEqual({});
  });

  it("на массиве вместо объекта возвращает пустой объект", () => {
    const storage = fakeStorage({ "course-review:01-alpha": "[]" });
    expect(readLessonStates(storage, "01-alpha")).toEqual({});
  });
});

describe("writeCardState", () => {
  it("не затирает состояние соседних карточек урока", () => {
    const storage = fakeStorage();
    writeCardState(storage, "01-alpha", "s-1", stored());
    writeCardState(storage, "01-alpha", "s-2", stored({ intervalDays: 1 }));

    const states = readLessonStates(storage, "01-alpha");
    expect(Object.keys(states).sort()).toEqual(["s-1", "s-2"]);
    expect(states["s-1"].intervalDays).toBe(6);
  });

  it("молча переживает отказ записи", () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeCardState(throwing, "01-alpha", "s-1", stored())).not.toThrow();
  });
});
