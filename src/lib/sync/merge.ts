/**
 * Правила слияния локального прогресса с облачным.
 *
 * Ни сети, ни localStorage: на вход приходят простые объекты, на выход —
 * решение. Всё, что требует размышления, живёт здесь и проверяется обычными
 * тестами, а бандл со Supabase остаётся последовательностью вызовов.
 *
 * Общий принцип у всех правил один: никогда не терять уже достигнутое.
 */

export type StepState = "read" | "failed" | "passed";

export interface StepRow {
  lessonSlug: string;
  stepId: string;
  state: StepState;
  updatedAt: string;
}

export interface FileRow {
  slug: string;
  fileName: string;
  content: string;
  /** Отметки времени нет у файлов, сохранённых до появления синхронизации. */
  updatedAt?: string;
  /**
   * Файл лежит в localStorage под ключом без имени: `course-exercise:<slug>`.
   *
   * Признак хранится явно, а не выводится из имени файла: одиночному
   * упражнению страница подставляет имя `exercise.py`, и вывод по имени
   * склеил бы его с настоящим файлом `exercise.py` многофайлового урока.
   */
  single?: boolean;
}

export type FileDecision = {
  action: "upload" | "keep-cloud" | "none";
  row: FileRow;
  /** Локальный текст, проигравший облачному: его откладывают в копию. */
  backup?: string;
};

/**
 * Ранг состояния.
 *
 * `read` и `failed` равны намеренно: красный прогон на втором устройстве не
 * должен сбрасывать шаг, уже сданный на первом, но и прочтение не отменяет
 * красного прогона — они про разное и стоят на одной ступени.
 */
export function rankOf(state: StepState): number {
  return state === "passed" ? 2 : 1;
}

export function mergeStep(local: StepRow | null, cloud: StepRow | null): StepRow | null {
  if (!local) return cloud;
  if (!cloud) return local;
  if (rankOf(local.state) !== rankOf(cloud.state)) {
    return rankOf(local.state) > rankOf(cloud.state) ? local : cloud;
  }
  return local.updatedAt >= cloud.updatedAt ? local : cloud;
}

function keyOf(row: StepRow): string {
  return `${row.lessonSlug}:${row.stepId}`;
}

/**
 * Слияние всех шагов сразу.
 *
 * `upload` — только то, что в облаке отсутствует или отличается от
 * победителя состоянием. Разница в одной отметке времени поводом для отправки
 * не считается намеренно: у прочитанных шагов локального времени правки нет
 * вовсе, оно подставляется, и сверка по нему заставляла бы браузер
 * переотправлять всю историю чтения на каждом переходе между страницами.
 */
export function mergeSteps(
  local: StepRow[],
  cloud: StepRow[],
): { merged: StepRow[]; upload: StepRow[] } {
  const cloudByKey = new Map(cloud.map((row) => [keyOf(row), row]));
  const localByKey = new Map(local.map((row) => [keyOf(row), row]));
  const keys = [...new Set([...localByKey.keys(), ...cloudByKey.keys()])].sort();

  const merged: StepRow[] = [];
  const upload: StepRow[] = [];
  for (const key of keys) {
    const winner = mergeStep(localByKey.get(key) ?? null, cloudByKey.get(key) ?? null);
    if (!winner) continue;
    merged.push(winner);
    const known = cloudByKey.get(key);
    if (!known || known.state !== winner.state) upload.push(winner);
  }
  return { merged, upload };
}

/**
 * Решение по одному файлу упражнения.
 *
 * Единственное место, где честного правила нет: у текста, сохранённого до
 * появления синхронизации, отметки времени не существует, и вычислить, какой
 * из двух разошедшихся текстов новее, нечем. Тогда побеждает облако, а
 * локальный текст откладывается в копию — молча терять написанный код нельзя,
 * а угадывать без отметки времени тем более.
 *
 * Копия откладывается всякий раз, когда облако побеждает разошедшийся
 * локальный текст, а не только при отсутствии отметки времени. Отметка есть у
 * всех, кто хоть раз печатал в редакторе, — она пишется на каждое нажатие
 * клавиши, в том числе до всякого входа в аккаунт. Без копии первый же вход
 * такого человека затирал бы написанное им в localStorage безвозвратно, а
 * стоит копия одного ключа.
 */
export function mergeFile(local: FileRow | null, cloud: FileRow | null): FileDecision | null {
  if (!local && !cloud) return null;
  if (!cloud) return { action: "upload", row: local as FileRow };
  if (!local) return { action: "keep-cloud", row: cloud };
  if (local.content === cloud.content) return { action: "none", row: cloud };
  if (local.updatedAt && local.updatedAt > (cloud.updatedAt ?? "")) {
    return { action: "upload", row: local };
  }
  return { action: "keep-cloud", row: cloud, backup: local.content };
}
