"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { errorStatus } from "@/lib/agent/error-message";
import { fetchJson } from "@/lib/api/fetch-json";
import { parseSseFrames } from "@/lib/api/sse-client";

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
  /** У урока уже есть план — разбирать нечего, кнопка только импортирует. */
  hasPlan: boolean;
  /** Кэша апстрима ещё нет: первый клик клонирует курс целиком, это долго. */
  firstRun: boolean;
}

const RESULT_MS = 6000;

export default function ImportButton({ slug, imported, hasPlan, firstRun }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "importing" | "generating">("idle");
  const [status, setStatus] = useState("");
  const [done, setDone] = useState<ImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Итог гаснет сам: строка каталога — не место для постоянной сводки, а
  // ручного «закрыть» на ней быть не должно.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), RESULT_MS);
    return () => clearTimeout(timer);
  }, [done]);

  /**
   * Разбор урока на шаги сразу после импорта.
   *
   * Запрос долгий и живёт ровно столько, сколько открыта эта страница: роут
   * генерации получает `request.signal`, и уход с каталога убивает агента на
   * полуслове. Поэтому прогресс показывается прямо в строке — уводить
   * учащегося отсюда нельзя, и он должен видеть, что работа идёт.
   */
  async function generate(): Promise<boolean> {
    setPhase("generating");
    setStatus("Разбираю урок…");

    // `all=1`: из каталога урок разбирают целиком. Окно из трёх шагов, с
    // которым работает ридер, оставило бы здесь урок недописанным — дописывать
    // было бы некому, отсюда учащийся сразу уходит.
    const response = await fetch(`/api/lesson/${slug}/generate?from=0&all=1`, { method: "POST" });
    if (!response.ok || !response.body) {
      setError("Разбор недоступен");
      return false;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let failure: string | null = null;

    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = parseSseFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        const payload = frame.data as { text?: string; message?: string; kind?: string };
        if (frame.event === "progress" && payload.text) setStatus(payload.text.slice(0, 80));
        if (frame.event === "error") failure = errorStatus(payload.kind, payload.message ?? "");
      }
    }

    if (failure) {
      setError(failure);
      return false;
    }
    return true;
  }

  async function run() {
    setPhase("importing");
    setError(null);
    setDone(null);

    const result = await fetchJson<ImportResponse>("/api/catalog/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug }),
    });

    if (!result.ok) {
      setPhase("idle");
      setError(result.error);
      return;
    }

    // Разбор идёт по отсутствию плана, а не по режиму импорта: урок, который
    // импортировался раньше, а разобраться не успел, тоже должен доехать до
    // шагов — иначе его строка навсегда осталась бы с кнопкой «Обновить» и
    // без единого шага.
    const parsed = hasPlan || (await generate());

    setPhase("idle");
    if (parsed) setDone(result.data);
    router.refresh();
  }

  if (phase === "importing") {
    const label = firstRun ? "Клонирую курс…" : imported ? "Обновляю…" : "Импортирую…";
    return <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{label}</span>;
  }

  if (phase === "generating") {
    return (
      <span className="ml-auto max-w-sm truncate text-xs text-slate-500 dark:text-slate-400">
        {status}
      </span>
    );
  }

  if (error) {
    return (
      <span className="ml-auto flex items-baseline gap-2 text-xs">
        <span className="max-w-sm truncate text-red-600 dark:text-red-400">{error}</span>
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
      {imported && hasPlan ? "Обновить" : "Импортировать и разобрать"}
    </button>
  );
}
