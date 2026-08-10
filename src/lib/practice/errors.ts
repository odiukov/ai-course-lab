export type PracticeErrorKind = "spawn" | "timeout" | "python" | "output";

export class PracticeError extends Error {
  kind: PracticeErrorKind;

  constructor(message: string, kind: PracticeErrorKind) {
    super(message);
    this.name = "PracticeError";
    this.kind = kind;
  }
}

/** Текст для баннера. Отдельно от message, как errorStatus у агента. */
export function practiceErrorStatus(kind: PracticeErrorKind | undefined, message: string): string {
  switch (kind) {
    case "spawn":
      return "Интерпретатор Python не найден — редактор работает, а тесты и замер нет. Проверь PYTHON в .env.local.";
    case "python":
      return `Python не смог прогнать тесты: ${message}`;
    case "timeout":
      return "Прогон не уложился в таймаут и был прерван — похоже на бесконечный цикл в коде.";
    default:
      return `Ошибка практики: ${message}`;
  }
}
