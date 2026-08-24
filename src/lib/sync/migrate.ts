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

/**
 * Имя файла одиночного упражнения.
 *
 * Ровно то же имя подставляет страница практики, когда файл в уроке один, —
 * иначе один и тот же файл уезжал бы в облако под двумя разными именами.
 */
export const SINGLE_FILE_NAME = "exercise.py";

/**
 * Отметка времени у шага, про который её негде взять.
 *
 * Массив `course-progress:<урок>` времени не хранит и никогда не хранил, и
 * подставить сюда время загрузки страницы нельзя: оно всегда свежее всего, что
 * уже лежит в облаке, поэтому при равных рангах локальное «прочитан» вечно
 * побеждало бы облачный `failed` со второго устройства. Заведомо проигрышная
 * отметка отдаёт такие ничьи облаку — то есть единственной стороне, у которой
 * настоящее время правки есть.
 */
export const LEGACY_UPDATED_AT = "1970-01-01T00:00:00.000Z";

/** Разобранный ключ упражнения. */
export interface ExerciseKey {
  slug: string;
  fileName: string;
  /** Ключ без имени файла: `course-exercise:<slug>`. */
  single: boolean;
}

/**
 * Разбор ключа упражнения — одним местом.
 *
 * Правило «есть двоеточие — многофайловое, нет — одиночное» нужно и здесь, и
 * в бандле входа, когда он рассылает странице события о приехавших файлах.
 * Написанное дважды, оно разъедется.
 */
export function splitExerciseKey(key: string): ExerciseKey | null {
  if (!key.startsWith(EXERCISE_KEY_PREFIX)) return null;
  const rest = key.slice(EXERCISE_KEY_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator === -1) return { slug: rest, fileName: SINGLE_FILE_NAME, single: true };
  return { slug: rest.slice(0, separator), fileName: rest.slice(separator + 1), single: false };
}

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

/**
 * Разбор одной записи `course-step-state:<урок>`.
 *
 * Нынешняя форма записи — `{ "state": …, "updatedAt": … }`. Голая строка
 * состояния — форма первых дней ключа: опубликована она никогда не была, но в
 * браузере разработчика остаться могла, поэтому читается тоже. Времени правки
 * у неё нет, и такая запись получает заведомо проигрышную отметку.
 */
function readState(value: unknown): { state: StepState; updatedAt: string } | null {
  if (typeof value === "string") {
    if (!STATES.includes(value as StepState)) return null;
    return { state: value as StepState, updatedAt: LEGACY_UPDATED_AT };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { state?: unknown; updatedAt?: unknown };
  if (typeof record.state !== "string" || !STATES.includes(record.state as StepState)) return null;
  return {
    state: record.state as StepState,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : LEGACY_UPDATED_AT,
  };
}

export function readLocalProgress(snapshot: StorageSnapshot): LocalProgress {
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
        updatedAt: LEGACY_UPDATED_AT,
      });
    }
  }

  for (const [key, raw] of Object.entries(snapshot)) {
    if (!key.startsWith(STEP_STATE_KEY_PREFIX)) continue;
    const lessonSlug = key.slice(STEP_STATE_KEY_PREFIX.length);
    const states = parse<Record<string, unknown>>(raw, {});
    if (Array.isArray(states) || typeof states !== "object") continue;
    for (const [stepId, value] of Object.entries(states)) {
      const parsed = readState(value);
      if (!parsed) continue;
      byStep.set(`${lessonSlug}:${stepId}`, { lessonSlug, stepId, ...parsed });
    }
  }

  // Многофайловое упражнение первой опубликованной версии держало main.py под
  // ключом без имени файла, и страница практики читает такой ключ только тогда,
  // когда именованного нет. В облако он уехал бы под подставным именем
  // одиночного файла, а на другом устройстве лёг бы обратно в ключ без имени и
  // подменил бы собой заготовку урока. Пока у того же упражнения есть
  // именованные ключи, ключ без имени — пережиток, и трогать его незачем.
  const named = new Set<string>();
  for (const key of Object.keys(snapshot)) {
    if (isServiceKey(key)) continue;
    const parsed = splitExerciseKey(key);
    if (parsed && !parsed.single) named.add(parsed.slug);
  }

  const files: FileRow[] = [];
  for (const [key, content] of Object.entries(snapshot)) {
    if (isServiceKey(key)) continue;
    const parsed = splitExerciseKey(key);
    if (!parsed) continue;
    if (parsed.single && named.has(parsed.slug)) continue;
    const updatedAt = snapshot[key + UPDATED_AT_SUFFIX];
    const row: FileRow = {
      slug: parsed.slug,
      fileName: parsed.fileName,
      content,
      single: parsed.single,
    };
    files.push(updatedAt ? { ...row, updatedAt } : row);
  }

  return {
    steps: [...byStep.values()].sort((a, b) =>
      `${a.lessonSlug}${a.stepId}`.localeCompare(`${b.lessonSlug}${b.stepId}`),
    ),
    files: files.sort((a, b) => `${a.slug}${a.fileName}`.localeCompare(`${b.slug}${b.fileName}`)),
  };
}

function fileKey(row: FileRow, single: boolean): string {
  return single
    ? `${EXERCISE_KEY_PREFIX}${row.slug}`
    : `${EXERCISE_KEY_PREFIX}${row.slug}:${row.fileName}`;
}

export function planMigration(local: LocalProgress, cloud: LocalProgress): MigrationPlan {
  const { merged, upload } = mergeSteps(local.steps, cloud.steps);

  const writes: Record<string, string> = {};
  const readByLesson = new Map<string, string[]>();
  const stateByLesson = new Map<string, Record<string, { state: StepState; updatedAt: string }>>();
  for (const row of merged) {
    const ids = readByLesson.get(row.lessonSlug) ?? [];
    ids.push(row.stepId);
    readByLesson.set(row.lessonSlug, ids);
    if (row.state !== "read") {
      const states = stateByLesson.get(row.lessonSlug) ?? {};
      states[row.stepId] = { state: row.state, updatedAt: row.updatedAt };
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
    //
    // Форма ключа берётся у локальной строки: признак у неё явный. У облачной
    // строки его нет вовсе — в облаке лежат только slug и имя файла, — и для
    // упражнения, которого на этом устройстве ещё не было, остаётся
    // единственная примета: подставное имя одиночного файла.
    const single = localRow ? localRow.single === true : decision.row.fileName === SINGLE_FILE_NAME;
    const target = fileKey(decision.row, single);
    writes[target] = decision.row.content;
    if (decision.row.updatedAt) {
      writes[target + UPDATED_AT_SUFFIX] = decision.row.updatedAt;
    }
    if (decision.backup !== undefined) {
      writes[target + LOCAL_BACKUP_SUFFIX] = decision.backup;
      backups += 1;
    }
  }

  return { steps: upload, files, writes, backups };
}
