import type { Step } from "../content/step-file";

export interface QuizQuestion {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
}

/**
 * Вопросы шага в форме, которую понимает клиентский скрипт страницы.
 *
 * В отличие от API приложения, верный ответ здесь не прячется: проверять его
 * некому — сервера у статики нет, и вся проверка живёт в браузере.
 */
export function quizQuestions(step: Step): QuizQuestion[] {
  return (step.check ?? []).map((item) => ({
    question: item.question,
    options: item.options,
    correct: item.correct,
    explanation: item.explanation ?? "",
  }));
}

/**
 * JSON для `<script type="application/json">`.
 *
 * `<` и `&` уезжают в escape-последовательности: разбор JSON их вернёт, а
 * разбор HTML до них не доберётся — иначе вопрос, в котором встретится
 * закрывающий тег скрипта, разорвал бы страницу пополам.
 */
export function encodeQuizPayload(questions: QuizQuestion[]): string {
  return JSON.stringify(questions).replace(/</g, "\\u003c").replace(/&/g, "\\u0026");
}
