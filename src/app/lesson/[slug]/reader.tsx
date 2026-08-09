"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { StepBody } from "@/components/StepBody";
import { VisualFrame } from "@/components/VisualFrame";

interface StepData {
  id: string;
  type: "theory" | "visual" | "check" | "code" | "recall" | "quiz";
  title: string;
  visual?: string;
  exercise_fn?: string;
  body: string;
}

interface LessonData {
  plan: { title: string; steps: { id: string; title: string }[] } | null;
  stale: boolean;
  steps: StepData[];
  source: { title: string };
}

type ErrorKind = "limit" | "agent" | "spawn" | "exit" | "parse" | "aborted";

function errorStatus(kind: string | undefined, message: string): string {
  switch (kind as ErrorKind | undefined) {
    case "limit":
      return "Упёрлись в лимит подписки — генерация приостановлена.";
    case "spawn":
      return "Агент не найден на сервере — читать урок можно, но дописать его пока нельзя.";
    default:
      return `Ошибка: ${message}`;
  }
}

export function Reader({ slug }: { slug: string }) {
  const [data, setData] = useState<LessonData | null>(null);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/lesson/${slug}`);
    setData(await response.json());
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount, no external state to subscribe to
    void load();
  }, [load]);

  const generate = useCallback(
    async (from: number) => {
      setStatus("Генерирую…");
      const response = await fetch(`/api/lesson/${slug}/generate?from=${from}`, { method: "POST" });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const event = /^event: (.+)$/m.exec(frame)?.[1];
          const payload = /^data: (.+)$/m.exec(frame)?.[1];
          if (!event || !payload) continue;
          const parsed = JSON.parse(payload) as { text?: string; message?: string; kind?: string };
          if (event === "progress" && parsed.text) setStatus(parsed.text.slice(-120));
          if (event === "error") setStatus(errorStatus(parsed.kind, parsed.message ?? ""));
        }
      }

      setStatus(null);
      await load();
    },
    [slug, load],
  );

  if (!data) return <p className="text-slate-400">Загружаю…</p>;

  const step = data.steps[index];

  if (!step) {
    return (
      <div className="space-y-4">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-600">← к списку</Link>
        <h1 className="text-2xl font-semibold">{data.source.title}</h1>
        <p className="text-slate-600">
          {data.plan ? "Следующие шаги ещё не написаны." : "Урок ещё не разобран на шаги."}
        </p>
        <button
          onClick={() => generate(index)}
          className="rounded bg-slate-900 px-4 py-2 text-white"
        >
          {data.plan ? "Написать дальше" : "Разобрать урок"}
        </button>
        {status && <p className="text-sm text-slate-400">{status}</p>}
      </div>
    );
  }

  return (
    <article className="space-y-6">
      <div className="flex items-baseline justify-between text-sm text-slate-400">
        <Link href="/" className="hover:text-slate-600">← к списку</Link>
        <span>
          {index + 1} / {data.plan?.steps.length ?? data.steps.length}
        </span>
      </div>

      {data.stale && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Исходный урок изменился с момента генерации.
        </p>
      )}

      <h1 className="text-2xl font-semibold">{step.title}</h1>
      <StepBody body={step.body} />
      {step.visual && <VisualFrame path={step.visual} />}
      {step.type === "code" && step.exercise_fn && (
        <p className="rounded bg-slate-100 px-3 py-2 text-sm">
          Здесь будет редактор для функции <code>{step.exercise_fn}</code> — план 3.
        </p>
      )}
      {step.type === "recall" && step.exercise_fn && (
        <p className="rounded bg-slate-100 px-3 py-2 text-sm">
          Ты уже писал эту функцию в одном из прошлых уроков — <code>{step.exercise_fn}</code>.
        </p>
      )}

      <div className="flex gap-3 pt-4">
        <button
          disabled={index === 0}
          onClick={() => setIndex((value) => value - 1)}
          className="rounded border px-4 py-2 disabled:opacity-30"
        >
          Назад
        </button>
        <button
          onClick={() => {
            const next = index + 1;
            setIndex(next);
            if (!data.steps[next + 2]) void generate(next);
          }}
          className="rounded bg-slate-900 px-4 py-2 text-white"
        >
          Дальше
        </button>
        {status && <span className="self-center text-sm text-slate-400">{status}</span>}
      </div>
    </article>
  );
}
