/**
 * Разбор локального хранилища и план первого слияния с облаком.
 *
 * На вход приходит снимок localStorage обычным объектом — так модуль остаётся
 * чистым и проверяется без браузера. Решение о том, что отправить, что
 * записать обратно и что отложить в копию, принимается здесь целиком.
 */
import {
  EXERCISE_KEY_PREFIX,
  LOCAL_BACKUP_SUFFIX,
  PROGRESS_KEY_PREFIX,
  RECOVERY_SUFFIX,
  STEP_STATE_KEY_PREFIX,
  UPDATED_AT_SUFFIX,
} from "../site/storage-keys";
import { type FileRow, mergeFile, mergeSteps, type StepRow, type StepState } from "./merge";

export type StorageSnapshot = Record<string, string>;

export interface LocalProgress {
  steps: StepRow[];
  files: FileRow[];
}

export interface MigrationPlan {
  /** Строки шагов на отправку в облако. */
  steps: StepRow[];
  /** Файлы упражнений на отправку в облако. */
  files: FileRow[];
  /** Что записать обратно в localStorage после слияния. */
  writes: Record<string, string>;
  /** Сколько локальных текстов уступило облачным и уехало в копию. */
  backups: number;
}

const STATES: StepState[] = ["read", "failed", "passed"];

function parse<T>(raw: string | undefined, fallback: T): T {
  if (raw === undefined) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** Служебные суффиксы: это не файлы упражнения, а вспомогательные копии. */
function isServiceKey(key: string): boolean {
  return (
    key.endsWith(RECOVERY_SUFFIX) ||
    key.endsWith(LOCAL_BACKUP_SUFFIX) ||
    key.endsWith(UPDATED_AT_SUFFIX)
  );
}

export function readLocalProgress(snapshot: StorageSnapshot, now: string): LocalProgress {
  const byStep = new Map<string, StepRow>();

  for (const [key, raw] of Object.entries(snapshot)) {
    if (!key.startsWith(PROGRESS_KEY_PREFIX)) continue;
    const lessonSlug = key.slice(PROGRESS_KEY_PREFIX.length);
    const ids = parse<unknown>(raw, []);
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      if (typeof id !== "string") continue;
      byStep.set(`${lessonSlug}:${id}`, {
        lessonSlug,
        stepId: id,
        state: "read",
        updatedAt: now,
      });
    }
  }

  for (const [key, raw] of Object.entries(snapshot)) {
    if (!key.startsWith(STEP_STATE_KEY_PREFIX)) continue;
    const lessonSlug = key.slice(STEP_STATE_KEY_PREFIX.length);
    const states = parse<Record<string, unknown>>(raw, {});
    if (Array.isArray(states) || typeof states !== "object") continue;
    for (const [stepId, state] of Object.entries(states)) {
      if (typeof state !== "string" || !STATES.includes(state as StepState)) continue;
      byStep.set(`${lessonSlug}:${stepId}`, {
        lessonSlug,
        stepId,
        state: state as StepState,
        updatedAt: now,
      });
    }
  }

  const files: FileRow[] = [];
  for (const [key, content] of Object.entries(snapshot)) {
    if (!key.startsWith(EXERCISE_KEY_PREFIX) || isServiceKey(key)) continue;
    const rest = key.slice(EXERCISE_KEY_PREFIX.length);
    const separator = rest.indexOf(":");
    // Одиночное упражнение хранится без имени файла; имя exercise.py — то же
    // самое, что подставляет страница практики, когда файл в уроке один.
    const slug = separator === -1 ? rest : rest.slice(0, separator);
    const fileName = separator === -1 ? "exercise.py" : rest.slice(separator + 1);
    const updatedAt = snapshot[key + UPDATED_AT_SUFFIX];
    files.push(updatedAt ? { slug, fileName, content, updatedAt } : { slug, fileName, content });
  }

  return {
    steps: [...byStep.values()].sort((a, b) =>
      `${a.lessonSlug}${a.stepId}`.localeCompare(`${b.lessonSlug}${b.stepId}`),
    ),
    files: files.sort((a, b) => `${a.slug}${a.fileName}`.localeCompare(`${b.slug}${b.fileName}`)),
  };
}

function fileKey(row: FileRow, multi: boolean): string {
  return multi
    ? `${EXERCISE_KEY_PREFIX}${row.slug}:${row.fileName}`
    : `${EXERCISE_KEY_PREFIX}${row.slug}`;
}

export function planMigration(local: LocalProgress, cloud: LocalProgress): MigrationPlan {
  const { merged, upload } = mergeSteps(local.steps, cloud.steps);

  const writes: Record<string, string> = {};
  const readByLesson = new Map<string, string[]>();
  const stateByLesson = new Map<string, Record<string, StepState>>();
  for (const row of merged) {
    const ids = readByLesson.get(row.lessonSlug) ?? [];
    ids.push(row.stepId);
    readByLesson.set(row.lessonSlug, ids);
    if (row.state !== "read") {
      const states = stateByLesson.get(row.lessonSlug) ?? {};
      states[row.stepId] = row.state;
      stateByLesson.set(row.lessonSlug, states);
    }
  }
  for (const [lessonSlug, ids] of readByLesson) {
    writes[PROGRESS_KEY_PREFIX + lessonSlug] = JSON.stringify(ids);
  }
  for (const [lessonSlug, states] of stateByLesson) {
    writes[STEP_STATE_KEY_PREFIX + lessonSlug] = JSON.stringify(states);
  }

  const localFiles = new Map(local.files.map((row) => [`${row.slug}:${row.fileName}`, row]));
  const cloudFiles = new Map(cloud.files.map((row) => [`${row.slug}:${row.fileName}`, row]));
  const keys = [...new Set([...localFiles.keys(), ...cloudFiles.keys()])].sort();

  const files: FileRow[] = [];
  let backups = 0;
  for (const key of keys) {
    const localRow = localFiles.get(key) ?? null;
    const cloudRow = cloudFiles.get(key) ?? null;
    const decision = mergeFile(localRow, cloudRow);
    if (!decision) continue;

    if (decision.action === "upload") {
      files.push(decision.row);
      continue;
    }
    if (decision.action === "none") continue;

    // Облачный текст побеждает: он должен оказаться и в localStorage, иначе
    // страница продолжит показывать локальный.
    const multi = decision.row.fileName !== "exercise.py";
    writes[fileKey(decision.row, multi)] = decision.row.content;
    if (decision.row.updatedAt) {
      writes[fileKey(decision.row, multi) + UPDATED_AT_SUFFIX] = decision.row.updatedAt;
    }
    if (decision.backup !== undefined) {
      writes[fileKey(decision.row, multi) + LOCAL_BACKUP_SUFFIX] = decision.backup;
      backups += 1;
    }
  }

  return { steps: upload, files, writes, backups };
}
