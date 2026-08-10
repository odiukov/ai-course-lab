"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/api/fetch-json";

interface PublicQuestion {
  question: string;
  options: string[];
}

interface Verdict {
  correct: boolean;
  correctIndex: number;
  explanation: string;
  answerIndex: number;
}

export function QuestionSet({
  slug,
  stepId,
  questions,
  onExplain,
  onProgressChanged,
}: {
  slug: string;
  stepId: string;
  questions: PublicQuestion[];
  onExplain: (question: string) => void;
  onProgressChanged: () => void;
}) {
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);

  // Всегда шаг, который сейчас показан — не тот, для которого был начат
  // конкретный запрос. restore()/answer() сверяются с этим перед тем, как
  // применить свой результат: если учащийся уже ушёл на другой check-шаг
  // (или на третий, пока второй ещё восстанавливался), ответ запроса,
  // начатого для прежнего шага, отбрасывается целиком — тот же приём, что и
  // в ExercisePanel. Запись в ref сделана эффектом, а не прямо в теле
  // рендера: коммит эффекта всегда успевает раньше, чем придёт любой сетевой
  // ответ, а обновление ref во время рендера — то, чего сам React просит
  // избегать.
  const currentStepRef = useRef({ slug, stepId });
  useEffect(() => {
    currentStepRef.current = { slug, stepId };
  }, [slug, stepId]);

  // Прошлые попытки восстанавливаются с сервера: перезагрузка страницы не
  // должна делать вид, что человек эти вопросы не видел. Ответ восстанавливается
  // без объяснения — его отдаёт только проверка.
  const restore = useCallback(async () => {
    const startedFor = { slug, stepId };
    const isCurrent = () =>
      currentStepRef.current.slug === startedFor.slug && currentStepRef.current.stepId === startedFor.stepId;

    const result = await fetchJson<{
      attempts: { questionIndex: number; answerIndex: number; correct: boolean }[];
    }>(`/api/lesson/${slug}/quiz?stepId=${encodeURIComponent(stepId)}`);
    if (!isCurrent()) return;
    if (!result.ok) {
      setError(`Не удалось загрузить прошлые попытки: ${result.error}`);
      return;
    }
    const { attempts } = result.data;

    setChosen(Object.fromEntries(attempts.map((item) => [item.questionIndex, item.answerIndex])));
    setVerdicts(
      Object.fromEntries(
        attempts.map((item) => [
          item.questionIndex,
          {
            correct: item.correct,
            correctIndex: item.correct ? item.answerIndex : -1,
            explanation: "",
            answerIndex: item.answerIndex,
          },
        ]),
      ),
    );
  }, [slug, stepId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- восстановление прошлых попыток шага
    setVerdicts({});
    setChosen({});
    setError(null);
    void restore();
  }, [restore]);

  const answer = useCallback(
    async (questionIndex: number, answerIndex: number) => {
      const startedFor = { slug, stepId };
      const isCurrent = () =>
        currentStepRef.current.slug === startedFor.slug && currentStepRef.current.stepId === startedFor.stepId;

      setError(null);
      setChosen((current) => ({ ...current, [questionIndex]: answerIndex }));

      const result = await fetchJson<{
        correct?: boolean;
        correctIndex?: number;
        explanation?: string;
      }>(`/api/lesson/${slug}/quiz`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stepId, questionIndex, answerIndex }),
      });
      if (!isCurrent()) return;

      if (!result.ok || result.data.correct === undefined) {
        setError(result.ok ? "Сервер не сказал, верно ли это" : result.error);
        return;
      }

      const json = result.data;
      setVerdicts((current) => ({
        ...current,
        [questionIndex]: {
          correct: json.correct === true,
          correctIndex: json.correctIndex ?? -1,
          explanation: json.explanation ?? "",
          answerIndex,
        },
      }));
      onProgressChanged();
    },
    [onProgressChanged, slug, stepId],
  );

  return (
    <div className="space-y-5 rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-900">
      {questions.map((item, questionIndex) => {
        const verdict = verdicts[questionIndex];
        return (
          <div key={questionIndex} className="space-y-2">
            <p className="font-medium">
              {questionIndex + 1}. {item.question}
            </p>
            <ul className="space-y-1">
              {item.options.map((option, answerIndex) => {
                const picked = chosen[questionIndex] === answerIndex;
                const isCorrect = verdict && verdict.correctIndex === answerIndex;
                return (
                  <li key={answerIndex}>
                    <button
                      onClick={() => void answer(questionIndex, answerIndex)}
                      aria-pressed={picked}
                      className={`w-full rounded border px-3 py-2 text-left text-sm ${
                        isCorrect
                          ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
                          : picked && verdict && !verdict.correct
                            ? "border-rose-500 bg-rose-50 dark:bg-rose-950"
                            : "border-slate-200 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                      }`}
                    >
                      {option}
                    </button>
                  </li>
                );
              })}
            </ul>

            {verdict && (
              <div className="space-y-1 text-sm">
                <p className={verdict.correct ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}>
                  {verdict.correct ? "Верно." : "Неверно."}
                </p>
                {verdict.explanation && <p>{verdict.explanation}</p>}
                {!verdict.correct && (
                  <button
                    onClick={() =>
                      onExplain(
                        // После восстановления с сервера верный индекс неизвестен
                        // (GET /quiz не присылает ключ ответа) — тогда вопрос в чат
                        // формулируется без названия верного варианта, а не с
                        // «undefined».
                        verdict.correctIndex >= 0
                          ? `Не понял вопрос: «${item.question}». Я выбрал «${item.options[verdict.answerIndex]}», а верный ответ — «${item.options[verdict.correctIndex]}». Объясни, почему.`
                          : `Не понял вопрос: «${item.question}». Я выбрал «${item.options[verdict.answerIndex]}» — и ответил неверно. Объясни, почему мой ответ неверен.`,
                      )
                    }
                    className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600"
                  >
                    Объясни
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {error && (
        <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}
