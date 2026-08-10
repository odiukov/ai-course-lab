// У сгенерированного файла enum'ов Monaco нет .d.ts рядом, а тест таблицы
// видов автодополнения сверяется именно с ним: импортировать "monaco-editor"
// целиком в node-окружении теста нельзя — тот модуль тянет DOM и воркеры.
// Объявлено только то, что нужно (прямое отображение «имя → число»; обратные,
// числовые ключи enum'а здесь не описаны, они и не используются).
declare module "monaco-editor/editor/common/standalone/standaloneEnums.js" {
  export const CompletionItemKind: Record<string, number>;
}
