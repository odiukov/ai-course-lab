import type { Step } from "../content/step-file";
import type { LessonSource } from "../source/lesson-source";

export interface GradableQuestion {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
}

export interface PublicQuestion {
  question: string;
  options: string[];
}

export function finalQuizQuestions(source: LessonSource): GradableQuestion[] {
  const post = source.quiz.filter((item) => item.stage !== "pre");
  const chosen = post.length > 0 ? post : source.quiz;
  return chosen.map((item) => ({
    question: item.question,
    options: item.options,
    correct: item.correct,
    explanation: item.explanation,
  }));
}

function ownQuestions(step: Step): GradableQuestion[] {
  return (step.check ?? []).map((item) => ({
    question: item.question,
    options: item.options,
    correct: item.correct,
    explanation: item.explanation,
  }));
}

export function stepQuestions(step: Step, source: LessonSource): GradableQuestion[] {
  if (step.type === "check") return ownQuestions(step);
  // Свои вопросы итогового шага важнее quiz.json: они по-русски и написаны по
  // тому уроку, который человек прошёл. Порядок должен совпадать с ридером —
  // разойдись он, сервер проверял бы ответ не по тому вопросу, на который
  // человек отвечает.
  if (step.type === "quiz") {
    const own = ownQuestions(step);
    return own.length > 0 ? own : finalQuizQuestions(source);
  }
  return [];
}

export function toPublicQuestions(questions: GradableQuestion[]): PublicQuestion[] {
  return questions.map((item) => ({ question: item.question, options: item.options }));
}

export type PublicStep = Omit<Step, "check"> & { check?: PublicQuestion[] };

/**
 * Шаг в том виде, в каком его можно отдать браузеру: без правильных ответов и
 * объяснений check-шага. Проверяет сервер, и ключ ответа в теле ответа API
 * делал бы эту проверку декорацией.
 *
 * Пока генерация не умела писать вопросы, у check-шагов не было ключа —
 * утекать было нечему, и урок отдавался целиком.
 */
export function toPublicStep(step: Step): PublicStep {
  const { check, ...rest } = step;
  return check ? { ...rest, check: toPublicQuestions(check) } : rest;
}

export function gradeAnswer(
  questions: GradableQuestion[],
  questionIndex: number,
  answerIndex: number,
): { correct: boolean; correctIndex: number; explanation: string } {
  const question = questions[questionIndex];
  if (!question) throw new Error(`Нет вопроса с номером ${questionIndex}`);
  if (answerIndex < 0 || answerIndex >= question.options.length) {
    throw new Error(`Нет варианта с номером ${answerIndex}`);
  }
  return {
    correct: answerIndex === question.correct,
    correctIndex: question.correct,
    explanation: question.explanation,
  };
}

// Шаг пройден, когда по КАЖДОМУ вопросу последний ответ верный: пересдача с
// правильного ответа со второй попытки — нормальный путь обучения, а вот
// неотвеченный вопрос пройденным шагом быть не может.
export function allAnsweredCorrectly(
  questions: GradableQuestion[],
  latest: Map<number, { correct: boolean }>,
): boolean {
  if (questions.length === 0) return false;
  return questions.every((_, index) => latest.get(index)?.correct === true);
}
