"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChatPanel } from "@/components/ChatPanel";
import { Clarifications } from "@/components/Clarifications";
import { ExercisePanel } from "@/components/ExercisePanel";
import { StepBody } from "@/components/StepBody";
import { VisualFrame } from "@/components/VisualFrame";
import { errorStatus } from "@/lib/agent/error-message";
import { parseSseFrames } from "@/lib/api/sse-client";

interface CheckQuestion {
  question: string;
  options: string[];
}

interface StepData {
  id: string;
  type: "theory" | "visual" | "check" | "code" | "recall" | "quiz";
  title: string;
  visual?: string;
  exercise_fn?: string;
  check?: CheckQuestion[];
  body: string;
}

interface ClarificationData {
  askedAt: string;
  question: string;
  answer: string;
}

interface LessonData {
  plan: { title: string; steps: { id: string; title: string }[] } | null;
  stale: boolean;
  // Keyed by plan step id. The API cannot send an array: an unwritten step in
  // the middle of the plan would compact the array and put every later step
  // at the wrong position.
  steps: Record<string, StepData>;
  clarifications: Record<string, ClarificationData[]>;
  progress: { readStepIds: string[]; resumeStepId: string | null };
  source: { title: string };
}

// Renders the questions a `check` step already carries in its frontmatter as
// plain text: question and options, no correct answer, no interactivity. The
// answering UI belongs to a later slice; showing what exists beats showing a
// placeholder that pretends nothing was written.
function CheckQuestions({ questions }: { questions: CheckQuestion[] }) {
  return (
    <ol className="list-decimal space-y-4 rounded bg-slate-100 px-4 py-3 pl-8 text-sm dark:bg-slate-800">
      {questions.map((item, index) => (
        <li key={index} className="space-y-1">
          <p className="font-medium">{item.question}</p>
          <ul className="list-disc pl-5">
            {item.options.map((option, optionIndex) => (
              <li key={optionIndex}>{option}</li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
    >
      {message}
    </p>
  );
}

// Mirrors the guard the API applies to `from`: a non-negative integer only.
// Anything else (missing, negative, fractional, non-numeric) falls back to
// `fallback` — the position the database recovered on the server.
function parseStepParam(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return value !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function Reader({
  slug,
  initialIndex,
  lspUrl,
}: {
  slug: string;
  initialIndex: number;
  lspUrl: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<LessonData | null>(null);
  const [index, setIndex] = useState(() => parseStepParam(searchParams.get("step"), initialIndex));
  // Two separate states on purpose. `status` is transient progress and is
  // cleared when the SSE loop ends; `error` outlives the loop, otherwise the
  // frame that reports "CLI not found" or "usage limit" is wiped one tick
  // after it arrives and the learner never sees why nothing was written.
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const postProgress = useCallback(
    (stepId: string, event: "opened" | "read") => {
      void fetch(`/api/lesson/${slug}/progress`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stepId, event }),
      });
    },
    [slug],
  );

  // Отдельно от postProgress, потому что «открыт» пишется из эффекта на показ
  // шага и не должен ничего перерисовывать, а «прочитан» двигает счётчик и
  // полоску. Локальное состояние обновляется сразу, не дожидаясь ответа: это
  // отражение уже сделанного шага, и ждать ради него сетевой круг незачем.
  const markRead = useCallback(
    (stepId: string) => {
      setData((current) =>
        current && !current.progress.readStepIds.includes(stepId)
          ? {
              ...current,
              progress: {
                ...current.progress,
                readStepIds: [...current.progress.readStepIds, stepId],
              },
            }
          : current,
      );
      postProgress(stepId, "read");
    },
    [postProgress],
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

  // Адрес без ?step пришёл от «открой урок с того места, где я был»: позицию
  // подставил сервер, и её надо дописать в адрес, иначе перезагрузка снова
  // пойдёт спрашивать базу, а ссылкой на конкретный шаг поделиться нельзя.
  const rawStep = searchParams.get("step");
  useEffect(() => {
    if (rawStep === null) router.replace(`/lesson/${slug}?step=${index}`, { scroll: false });
  }, [index, rawStep, router, slug]);

  // `opened` пишется на показ шага и нужен только для «где я остановился»:
  // состояние `read` из него не следует, его ставит уход вперёд.
  const openedStepId = data?.plan?.steps[index]?.id;
  useEffect(() => {
    if (openedStepId) postProgress(openedStepId, "opened");
  }, [openedStepId, postProgress]);

  const generate = useCallback(
    async (from: number) => {
      setError(null);
      setStatus("Генерирую…");
      const response = await fetch(`/api/lesson/${slug}/generate?from=${from}`, { method: "POST" });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = parseSseFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          const payload = frame.data as { text?: string; message?: string; kind?: string };
          if (frame.event === "progress" && payload.text) setStatus(payload.text.slice(-120));
          if (frame.event === "error") setError(errorStatus(payload.kind, payload.message ?? ""));
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
  const readCount = data.progress.readStepIds.length;
  const isLast = total > 0 && index + 1 >= total;

  if (!step) {
    // Чата здесь нет: спрашивать не про что, пока шаг не написан. Колонка
    // остаётся узкой, иначе текст растянется на всю ширину, отведённую уроку.
    return (
      <div className="max-w-3xl space-y-4">
        <Link
          href="/"
          className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          ← к списку
        </Link>
        <h1 className="text-2xl font-semibold">{data.source.title}</h1>
        <p className="text-slate-600 dark:text-slate-300">
          {data.plan
            ? `Шаг ${index + 1} из ${total} ещё не написан.`
            : "Урок ещё не разобран на шаги."}
        </p>
        <button
          disabled={status !== null}
          onClick={() => generate(index)}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-30 dark:bg-slate-100 dark:text-slate-900"
        >
          {data.plan ? "Написать дальше" : "Разобрать урок"}
        </button>
        {status && <p className="text-sm text-slate-400">{status}</p>}
        {error && <ErrorBanner message={error} />}
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <article className="space-y-6">
        <div className="flex items-baseline justify-between text-sm text-slate-400">
          <Link href="/" className="hover:text-slate-600 dark:hover:text-slate-200">← к списку</Link>
          <span>
            {index + 1} / {total} · прочитано {readCount}
          </span>
        </div>

        <div className="h-1 w-full rounded bg-slate-100 dark:bg-slate-800">
          <div
            className="h-1 rounded bg-emerald-500 transition-all"
            style={{ width: `${total === 0 ? 0 : Math.round((readCount / total) * 100)}%` }}
          />
        </div>

        {data.stale && (
          <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Исходный урок изменился с момента генерации.
          </p>
        )}

        <h1 className="text-2xl font-semibold">{step.title}</h1>
        <StepBody body={step.body} />
        {step.visual && <VisualFrame path={step.visual} />}
        {step.type === "code" && step.exercise_fn && (
          <ExercisePanel
            slug={slug}
            stepId={step.id}
            fn={step.exercise_fn}
            lspUrl={lspUrl}
            onProgressChanged={() => void load()}
          />
        )}
        {step.type === "recall" && step.exercise_fn && (
          <p className="rounded bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
            Ты уже писал эту функцию в одном из прошлых уроков — <code>{step.exercise_fn}</code>.
          </p>
        )}
        {step.type === "check" &&
          (step.check && step.check.length > 0 ? (
            <CheckQuestions questions={step.check} />
          ) : (
            <p className="rounded bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
              Вопросы к этому шагу ещё не готовы — они появятся в следующем срезе. Пока проверь себя
              сам и иди дальше.
            </p>
          ))}
        {step.type === "quiz" && (
          <p className="rounded bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
            Итоговый квиз урока ещё не готов — он появится в следующем срезе.
          </p>
        )}

        <Clarifications items={data.clarifications[step.id] ?? []} />

        <div className="flex gap-3 pt-4">
          <button
            disabled={index === 0}
            onClick={() => goTo(index - 1, total)}
            className="rounded border px-4 py-2 disabled:opacity-30 dark:border-slate-700"
          >
            Назад
          </button>
          {isLast ? (
            // У последнего шага «Дальше» некуда, но прочитанным его отметить
            // надо — иначе урок навсегда остаётся с одним недочитанным шагом.
            <button
              disabled={status !== null}
              onClick={() => {
                markRead(step.id);
                router.push("/");
              }}
              className="rounded bg-emerald-600 px-4 py-2 text-white disabled:opacity-30"
            >
              Закончить урок
            </button>
          ) : (
            <button
              disabled={status !== null}
              onClick={() => {
                // «Прочитан» — это механически «ушёл с него вперёд», без
                // таймеров и глубины прокрутки.
                markRead(step.id);
                const next = index + 1;
                goTo(next, total);
                // Keep three steps ahead written. Only asks the agent for work if
                // something in that window is actually missing, so the last steps
                // of a finished lesson don't fire a pointless request.
                const ahead = planSteps.slice(next, next + 3);
                if (ahead.some((meta) => !data.steps[meta.id])) void generate(next);
              }}
              className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-30 dark:bg-slate-100 dark:text-slate-900"
            >
              Дальше
            </button>
          )}
          {status && <span className="self-center text-sm text-slate-400">{status}</span>}
        </div>

        {error && <ErrorBanner message={error} />}
      </article>

      <aside className="lg:sticky lg:top-10 lg:h-[calc(100vh-5rem)]">
        <ChatPanel slug={slug} stepId={step.id} onKept={() => void load()} />
      </aside>
    </div>
  );
}
