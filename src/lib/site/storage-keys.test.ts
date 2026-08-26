// Значения этих строк — контракт с уже опубликованным сайтом: они лежат в
// localStorage браузеров читателей. Тест сторожит именно значения, а не
// существование констант: переименование ключа стирает чужой прогресс.
import { describe, expect, it } from "vitest";
import {
  EXERCISE_KEY_PREFIX,
  LOCAL_BACKUP_SUFFIX,
  PROGRESS_KEY_PREFIX,
  RECOVERY_SUFFIX,
  REVIEW_KEY_PREFIX,
  STEP_STATE_KEY_PREFIX,
  SYNCED_KEY_PREFIX,
  UPDATED_AT_SUFFIX,
} from "./storage-keys";

describe("ключи localStorage", () => {
  it("совпадают с теми, что уже лежат в браузерах читателей", () => {
    expect(PROGRESS_KEY_PREFIX).toBe("course-progress:");
    expect(EXERCISE_KEY_PREFIX).toBe("course-exercise:");
    expect(RECOVERY_SUFFIX).toBe(":recovery");
  });

  it("описывает новые ключи синхронизации", () => {
    expect(STEP_STATE_KEY_PREFIX).toBe("course-step-state:");
    expect(SYNCED_KEY_PREFIX).toBe("course-synced:");
    expect(UPDATED_AT_SUFFIX).toBe(":updatedAt");
    expect(LOCAL_BACKUP_SUFFIX).toBe(":local-backup");
  });

  it("ключ графика повторений закреплён", () => {
    expect(REVIEW_KEY_PREFIX).toBe("course-review:");
  });
});
