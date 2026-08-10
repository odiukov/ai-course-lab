"use client";

import { useCallback, useEffect, useState } from "react";

interface Previous {
  fn: string;
  exerciseSlug: string;
  lessonSlug: string | null;
  code: string;
}

export function RecallCard({
  slug,
  fn,
  onInserted,
}: {
  slug: string;
  fn: string;
  onInserted: () => void;
}) {
  const [previous, setPrevious] = useState<Previous | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inserted, setInserted] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/lesson/${slug}/recall?fn=${encodeURIComponent(fn)}`);
    if (!response.ok) {
      setMessage(((await response.json()) as { error?: string }).error ?? "Прошлый код не найден");
      return;
    }
    setPrevious((await response.json()) as Previous);
  }, [fn, slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- поиск прошлой реализации функции
    setPrevious(null);
    setInserted(false);
    setMessage(null);
    void load();
  }, [load]);

  const insert = useCallback(async () => {
    const response = await fetch(`/api/lesson/${slug}/recall`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fn }),
    });
    if (!response.ok) {
      setMessage(((await response.json()) as { error?: string }).error ?? "Не удалось вставить код");
      return;
    }
    setInserted(true);
    onInserted();
  }, [fn, onInserted, slug]);

  if (!previous) {
    return (
      <p className="rounded bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
        {message ?? "Ищу твой прошлый код…"}
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
        disabled={inserted}
        className="rounded border border-emerald-600 px-3 py-1 text-sm text-emerald-700 disabled:opacity-40 dark:text-emerald-400"
      >
        {inserted ? "вставлено в упражнение" : "Взять как есть"}
      </button>
      {message && <p className="text-sm text-rose-700 dark:text-rose-400">{message}</p>}
    </section>
  );
}
