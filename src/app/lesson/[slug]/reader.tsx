"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  // Keyed by plan step id. The API cannot send an array: an unwritten step in
  // the middle of the plan would compact the array and put every later step
  // at the wrong position.
  steps: Record<string, StepData>;
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

// Mirrors the guard the API applies to `from`: a non-negative integer only,
// anything else (missing, negative, fractional, non-numeric) falls back to 0.
function parseStepParam(value: string | null): number {
  const parsed = Number(value);
  return value !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function Reader({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<LessonData | null>(null);
  const [index, setIndex] = useState(() => parseStepParam(searchParams.get("step")));
  const [status, setStatus] = useState<string | null>(null);

  // Moves to `next`, clamped to the plan's bounds, and mirrors the result in
  // the URL. `replace` (not `push`) so the back button leaves the lesson
  // instead of walking back through every step.
  const goTo = useCallback(
    (next: number, total: number) => {
      const clamped = total > 0 ? Math.min(Math.max(next, 0), total - 1) : 0;
      setIndex(clamped);
      router.replace(`/lesson/${slug}?step=${clamped}`, { scroll: false });
    },
    [router, slug],
  );

  const load = useCallback(async () => {
    const response = await fetch(`/api/lesson/${slug}`);
    const json = (await response.json()) as LessonData;
    setData(json);
    const total = json.plan?.steps.length ?? 0;
    setIndex((current) => {
      const clamped = total > 0 ? Math.min(current, total - 1) : 0;
      if (clamped !== current) {
        router.replace(`/lesson/${slug}?step=${clamped}`, { scroll: false });
      }
      return clamped;
    });
  }, [slug, router]);

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

  // `index` is a PLAN position throughout: it is what ?step= carries, what the
  // "N / total" counter shows and what the generate endpoint receives as
  // `from`. The step itself is resolved through the plan's id, so a hole in
  // the generated steps stays a hole instead of pulling a later step forward.
  const planSteps = data.plan?.steps ?? [];
  const total = planSteps.length;
  const currentId = planSteps[index]?.id;
  const step = currentId ? data.steps[currentId] : undefined;

  if (!step) {
    return (
      <div className="space-y-4">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-600">← к списку</Link>
        <h1 className="text-2xl font-semibold">{data.source.title}</h1>
        <p className="text-slate-600">
          {data.plan
            ? `Шаг ${index + 1} из ${total} ещё не написан.`
            : "Урок ещё не разобран на шаги."}
        </p>
        <button
          disabled={status !== null}
          onClick={() => generate(index)}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-30"
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
          {index + 1} / {total}
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
          onClick={() => goTo(index - 1, total)}
          className="rounded border px-4 py-2 disabled:opacity-30"
        >
          Назад
        </button>
        <button
          disabled={status !== null}
          onClick={() => {
            const next = index + 1;
            goTo(next, total);
            // Keep three steps ahead written. Only asks the agent for work if
            // something in that window is actually missing, so the last steps
            // of a finished lesson don't fire a pointless request.
            const ahead = planSteps.slice(next, next + 3);
            if (ahead.some((meta) => !data.steps[meta.id])) void generate(next);
          }}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-30"
        >
          Дальше
        </button>
        {status && <span className="self-center text-sm text-slate-400">{status}</span>}
      </div>
    </article>
  );
}
