/**
 * Какой файл упражнения показывать.
 *
 * Приоритет у файла шага, а не у выбора человека: шаг переключает практику на
 * свою функцию, и оставить открытым соседний файл значило бы показать
 * редактор, в котором функции шага нет. Но пока шаг молчит (теория, соседний
 * таб открыт вручную), выбор человека сохраняется.
 */
export function pickActiveFile(
  names: string[],
  stepFile: string | undefined,
  current: string | null,
): string {
  if (stepFile && names.includes(stepFile)) return stepFile;
  if (current && names.includes(current)) return current;
  return names[0];
}
