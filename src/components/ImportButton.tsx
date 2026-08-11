"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/api/fetch-json";

interface ImportResponse {
  mode: "import" | "reimport";
  pull: { fetched: boolean; head: string | null; error?: string };
  copied: number;
  updated: number;
  kept: number;
}

interface Props {
  slug: string;
  imported: boolean;
  /** Кэша апстрима ещё нет: первый клик клонирует курс целиком, это долго. */
  firstRun: boolean;
}

const RESULT_MS = 6000;

export default function ImportButton({ slug, imported, firstRun }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<ImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Итог гаснет сам: строка каталога — не место для постоянной сводки, а
  // ручного «закрыть» на ней быть не должно.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), RESULT_MS);
    return () => clearTimeout(timer);
  }, [done]);

  async function run() {
    setRunning(true);
    setError(null);
    setDone(null);

    const result = await fetchJson<ImportResponse>("/api/catalog/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug }),
    });

    setRunning(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(result.data);
    router.refresh();
  }

  if (running) {
    const label = firstRun ? "Клонирую курс…" : imported ? "Обновляю…" : "Импортирую…";
    return <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{label}</span>;
  }

  if (error) {
    return (
      <span className="ml-auto flex items-baseline gap-2 text-xs">
        <span className="text-red-600 dark:text-red-400">{error}</span>
        <button type="button" onClick={run} className="underline underline-offset-2">
          ещё раз
        </button>
      </span>
    );
  }

  if (done) {
    return (
      <span className="ml-auto flex items-baseline gap-2 text-xs text-slate-500 dark:text-slate-400">
        {done.pull.error && (
          <span className="text-amber-600 dark:text-amber-400">апстрим не опрошен, взято из кэша</span>
        )}
        <span>+{done.copied} новых, {done.updated} обновлено</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={run}
      className="ml-auto rounded px-2 py-0.5 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
    >
      {imported ? "Обновить" : "Импортировать"}
    </button>
  );
}
