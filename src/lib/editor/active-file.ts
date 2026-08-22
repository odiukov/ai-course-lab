/** Файл упражнения и функции, которые в нём объявлены. */
export interface FileFunctions {
  name: string;
  functions: string[];
}

/**
 * Какой файл упражнения показывать.
 *
 * Порядок предпочтений:
 *
 * 1. Файл, который явно назвал шаг (`stepFile`) — если шаг сказал, где его
 *    функция, гадать не о чём.
 * 2. Файл, который ЕДИНСТВЕННЫЙ объявляет функцию шага (`stepFn`) — владение.
 *    `exercise_file` у каталожной формы обязателен только при коллизии
 *    одинаковых имён функций в разных файлах (см. `lesson-plan.ts`), так что
 *    у большинства шагов он не назван вовсе — но у их функции всё равно есть
 *    ровно один файл, и редактор обязан показать именно его. Владение стоит
 *    ВЫШЕ ручного выбора сознательно: на code-шаге открытый ради интереса
 *    соседний файл не должен маскировать то, что человеку сейчас надо
 *    писать. Ту же задачу на сервере решает `resolveExerciseFile`
 *    (`src/lib/exercise/tree.ts`) — здесь то же правило, на стороне клиента.
 * 3. Выбор человека (`current`) — работает, когда функции шага нет в игре
 *    (теория, рендер без `exercise_fn`) или её владельца не определить (имя
 *    не найдено ни в одном файле, либо найдено в нескольких сразу и шаг не
 *    уточнил, в каком). В этих случаях правило владения молчит, и последнее
 *    осознанное решение человека остаётся главным: соседний таб, открытый
 *    посмотреть, не перескакивает сам на каждый ререндер.
 * 4. Первый файл — когда все остальные правила промолчали.
 */
export function pickActiveFile(
  files: FileFunctions[],
  stepFile: string | undefined,
  stepFn: string | undefined,
  current: string | null,
): string {
  const names = files.map((item) => item.name);
  if (stepFile && names.includes(stepFile)) return stepFile;

  if (stepFn) {
    const owners = files.filter((item) => item.functions.includes(stepFn));
    if (owners.length === 1) return owners[0].name;
  }

  if (current && names.includes(current)) return current;
  return names[0];
}

/**
 * Вердикт относится к снимку всего каталога, а не только открытого таба:
 * тест из main.py вправе импортировать hooks.py, поэтому правка соседа после
 * зелёного прогона делает результат таким же устаревшим.
 */
export function isExerciseVerdictStale(
  fileNames: string[],
  activeFile: string,
  activeCode: string,
  savedCode: ReadonlyMap<string, string>,
  testedFiles: Readonly<Record<string, string>>,
): boolean {
  return fileNames.some((name) => {
    const current = name === activeFile ? activeCode : savedCode.get(name) ?? "";
    return testedFiles[name] !== current;
  });
}
