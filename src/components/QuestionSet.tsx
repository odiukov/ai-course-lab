"use client";

import { useCallback, useEffect, useState } from "react";

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

  // Прошлые попытки восстанавливаются с сервера: перезагрузка страницы не
  // должна делать вид, что человек эти вопросы не видел. Ответ восстанавливается
  // без объяснения — его отдаёт только проверка.
  const restore = useCallback(async () => {
    const response = await fetch(
      `/api/lesson/${slug}/quiz?stepId=${encodeURIComponent(stepId)}`,
    );
    if (!response.ok) return;
    const { attempts } = (await response.json()) as {
      attempts: { questionIndex: number; answerIndex: number; correct: boolean }[];
    };
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
    void restore();
  }, [restore]);

  const answer = useCallback(
    async (questionIndex: number, answerIndex: number) => {
      setError(null);
      setChosen((current) => ({ ...current, [questionIndex]: answerIndex }));

      const response = await fetch(`/api/lesson/${slug}/quiz`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stepId, questionIndex, answerIndex }),
      });
      const json = (await response.json()) as {
        correct?: boolean;
        correctIndex?: number;
        explanation?: string;
        error?: string;
      };
      if (!response.ok || json.correct === undefined) {
        setError(json.error ?? "Не удалось проверить ответ");
        return;
      }

      setVerdicts((current) => ({
        ...current,
        [questionIndex]: {
          correct: json.correct!,
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
                        `Не понял вопрос: «${item.question}». Я выбрал «${item.options[verdict.answerIndex]}», а верный ответ — «${item.options[verdict.correctIndex]}». Объясни, почему.`,
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
