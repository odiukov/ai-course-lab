"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/api/fetch-json";

interface Previous {
  fn: string;
  exerciseSlug: string;
  lessonSlug: string | null;
  code: string;
}

export function RecallCard({
  slug,
  fn,
  file,
  onInserted,
}: {
  slug: string;
  fn: string;
  /** Файл упражнения, в который встаёт прошлый код (`step.exercise_file`). */
  file?: string;
  onInserted: () => void;
}) {
  const [previous, setPrevious] = useState<Previous | null>(null);
  // Две отдельные строки: «уже на месте» — это спокойная реплика, а не красная
  // ошибка, и путать их нельзя.
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inserted, setInserted] = useState(false);
  const [inserting, setInserting] = useState(false);

  // Всегда функция, которая показана сейчас — не та, для которой был начат
  // конкретный запрос. Карточка переживает переход между recall-шагами, и без
  // этой сверки медленный ответ по прошлой функции мог оказаться на экране,
  // пока кнопка отправляет уже другую. Тот же приём, что в ExercisePanel и
  // QuestionSet.
  const currentRef = useRef({ slug, fn });
  useEffect(() => {
    currentRef.current = { slug, fn };
  }, [slug, fn]);

  const load = useCallback(async () => {
    const startedFor = { slug, fn };
    const isCurrent = () =>
      currentRef.current.slug === startedFor.slug && currentRef.current.fn === startedFor.fn;

    const result = await fetchJson<Previous>(
      `/api/lesson/${slug}/recall?fn=${encodeURIComponent(fn)}`,
    );
    if (!isCurrent()) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPrevious(result.data);
  }, [fn, slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- поиск прошлой реализации функции
    setPrevious(null);
    setInserted(false);
    setInserting(false);
    setNote(null);
    setError(null);
    void load();
  }, [load]);

  const insert = useCallback(async () => {
    const startedFor = { slug, fn };
    const isCurrent = () =>
      currentRef.current.slug === startedFor.slug && currentRef.current.fn === startedFor.fn;

    setInserting(true);
    setNote(null);
    setError(null);
    try {
      // file шлётся так же, как в тестах и сбросе: без него вставка попала бы
      // в файл, который резолвится по умолчанию, а не в тот, где фактически
      // живёт fn у этого шага (важно при одноимённых функциях в разных файлах).
      const result = await fetchJson<{ changed: boolean }>(`/api/lesson/${slug}/recall`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fn, file }),
      });
      if (!isCurrent()) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setInserted(true);
      // «Ничего не изменилось» — это тоже успех: код уже стоит на месте, и
      // сообщать об ошибке здесь было бы неправдой.
      if (!result.data.changed) {
        setNote("Этот код уже стоит в упражнении — менять нечего.");
      }
      onInserted();
    } finally {
      if (isCurrent()) setInserting(false);
    }
  }, [fn, file, onInserted, slug]);

  if (!previous) {
    return (
      <p className="rounded bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
        {error ?? "Ищу твой прошлый код…"}
      </p>
    );
  }

  return (
    <section className="space-y-2 rounded-lg border border-emerald-200 px-4 py-3 dark:border-emerald-900">
      <p className="text-sm">
        Ты уже писал <code>{previous.fn}</code> — в уроке{" "}
        <code>{previous.lessonSlug ?? previous.exerciseSlug}</code>. Заново писать не нужно.
      </p>
      <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
        <code>{previous.code}</code>
      </pre>
      <button
        onClick={() => void insert()}
        disabled={inserted || inserting}
        className="rounded border border-emerald-600 px-3 py-1 text-sm text-emerald-700 disabled:opacity-40 dark:text-emerald-400"
      >
        {inserted ? "вставлено в упражнение" : inserting ? "вставляю…" : "Взять как есть"}
      </button>
      {note && <p className="text-sm text-slate-600 dark:text-slate-300">{note}</p>}
      {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
    </section>
  );
}
