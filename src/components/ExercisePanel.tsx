"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BenchTable } from "@/components/BenchTable";
import { CodeEditor } from "@/components/CodeEditor";
import { errorStatus } from "@/lib/agent/error-message";
import { parseSseFrames } from "@/lib/api/sse-client";
import type { BenchReport } from "@/lib/practice/bench";
import { practiceErrorStatus, type PracticeErrorKind } from "@/lib/practice/errors";

const SAVE_DELAY_MS = 1000;
const WATCH_INTERVAL_MS = 2000;

interface ExerciseFunction {
  fn: string;
  startLine: number;
  endLine: number;
  implemented: boolean;
}

interface ExerciseData {
  file: string;
  relPath: string;
  code: string;
  mtimeMs: number;
  functions: ExerciseFunction[];
}

interface TestFailure {
  name: string;
  decisive: string;
}

interface TestResult {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  filtered: boolean;
  warning: string | null;
  failures: TestFailure[];
}

export function ExercisePanel({
  slug,
  stepId,
  fn,
  lspUrl,
  onProgressChanged,
}: {
  slug: string;
  stepId: string;
  fn: string;
  lspUrl: string | null;
  onProgressChanged: () => void;
}) {
  const [data, setData] = useState<ExerciseData | null>(null);
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [bench, setBench] = useState<BenchReport | null>(null);
  const [review, setReview] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedCodeRef = useRef("");
  const mtimeRef = useRef(0);

  const load = useCallback(async () => {
    const response = await fetch(`/api/lesson/${slug}/exercise`);
    if (!response.ok) {
      setError(((await response.json()) as { error?: string }).error ?? "Упражнение не найдено");
      return;
    }
    const json = (await response.json()) as ExerciseData;
    setData(json);
    setCode(json.code);
    savedCodeRef.current = json.code;
    mtimeRef.current = json.mtimeMs;
    setSaved(true);
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- первая загрузка файла упражнения
    void load();
  }, [load]);

  // Автосохранение с задержкой в секунду: файл на диске — единственная правда,
  // и держать несохранённый черновик в браузере нельзя, иначе прогон тестов
  // проверит не тот код, который человек видит.
  useEffect(() => {
    if (!data || code === savedCodeRef.current) return;
    setSaved(false);
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/lesson/${slug}/exercise`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        setError(((await response.json()) as { error?: string }).error ?? "Не удалось сохранить файл");
        return;
      }
      const json = (await response.json()) as { mtimeMs: number; functions: ExerciseFunction[] };
      savedCodeRef.current = code;
      mtimeRef.current = json.mtimeMs;
      setSaved(true);
      setData((current) => (current ? { ...current, functions: json.functions } : current));
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [code, data, slug]);

  // Правка из IDE подтягивается сама. Только когда в браузере нет
  // несохранённых изменений: иначе внешний файл перезаписал бы то, что человек
  // набирает прямо сейчас.
  useEffect(() => {
    const timer = setInterval(async () => {
      if (code !== savedCodeRef.current) return;
      const response = await fetch(`/api/lesson/${slug}/exercise?meta=1`);
      if (!response.ok) return;
      const { mtimeMs } = (await response.json()) as { mtimeMs: number | null };
      if (mtimeMs && mtimeMs > mtimeRef.current) void load();
    }, WATCH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [code, load, slug]);

  const runTests = useCallback(async () => {
    setRunning(true);
    setError(null);
    setBench(null);
    setReview("");
    const response = await fetch(`/api/lesson/${slug}/tests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stepId }),
    });
    setRunning(false);

    const json = (await response.json()) as {
      result?: TestResult;
      error?: string;
      kind?: PracticeErrorKind;
    };
    if (!response.ok || !json.result) {
      setError(practiceErrorStatus(json.kind, json.error ?? "неизвестно"));
      return;
    }
    setResult(json.result);
    onProgressChanged();
  }, [onProgressChanged, slug, stepId]);

  const runReview = useCallback(async () => {
    setReviewing(true);
    setError(null);
    setReview("");
    const response = await fetch(`/api/lesson/${slug}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stepId }),
    });

    if (!response.ok || !response.body) {
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Разбор недоступен");
      setReviewing(false);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let collected = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = parseSseFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        if (frame.event === "bench") setBench(frame.data as BenchReport);
        if (frame.event === "token") {
          collected += (frame.data as { text: string }).text;
          setReview(collected);
        }
        if (frame.event === "error") {
          const payload = frame.data as { kind?: string; message?: string };
          setError(
            payload.kind === "spawn" || payload.kind === "python" || payload.kind === "timeout"
              ? practiceErrorStatus(payload.kind as PracticeErrorKind, payload.message ?? "")
              : errorStatus(payload.kind, payload.message ?? ""),
          );
        }
      }
    }

    setReviewing(false);
    onProgressChanged();
  }, [onProgressChanged, slug, stepId]);

  if (!data) {
    return <p className="text-sm text-slate-400">{error ?? "Открываю упражнение…"}</p>;
  }

  const focus = data.functions.find((item) => item.fn === fn);
  const green = result !== null && result.failed === 0 && result.errors === 0 && result.total > 0;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between text-xs text-slate-400">
        <span>
          <code>{data.relPath}</code> · функция <code>{fn}</code>
        </span>
        <span>{saved ? "сохранено" : "сохраняю…"}</span>
      </div>

      <CodeEditor
        file={data.file}
        code={code}
        focus={focus ? { startLine: focus.startLine, endLine: focus.endLine } : undefined}
        lspUrl={lspUrl}
        onChange={setCode}
        onLspError={(message) =>
          setError(`Pyright не поднялся: ${message}. Редактор работает как обычный.`)
        }
      />

      <div className="flex items-center gap-3">
        <button
          onClick={() => void runTests()}
          disabled={running}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
        >
          {running ? "Гоняю тесты…" : `Прогнать тесты ${fn}`}
        </button>
        {green && (
          <button
            onClick={() => void runReview()}
            disabled={reviewing}
            className="rounded border border-emerald-600 px-4 py-2 text-sm text-emerald-700 disabled:opacity-40 dark:text-emerald-400"
          >
            {reviewing ? "Разбираю…" : "Замер и разбор кода"}
          </button>
        )}
      </div>

      {result && (
        <div
          className={`rounded px-3 py-2 text-sm ${
            green
              ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              : "bg-rose-50 text-rose-900 dark:bg-rose-950 dark:text-rose-200"
          }`}
        >
          <p>
            {result.passed} из {result.total} зелёные
            {result.filtered ? "" : " (прогнан весь файл)"}
          </p>
          {result.warning && <p className="mt-1 text-xs">{result.warning}</p>}
          {result.failures.length > 0 && (
            <p className="mt-1">
              Первый упавший: <code>{result.failures[0].name}</code>
              <br />
              <code className="text-xs">{result.failures[0].decisive}</code>
            </p>
          )}
        </div>
      )}

      {bench && <BenchTable report={bench} fn={fn} />}
      {review && (
        <div className="rounded bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900">
          <p className="mb-1 text-xs uppercase text-slate-400">разбор</p>
          <p className="whitespace-pre-wrap">{review}</p>
          <p className="mt-2 text-xs text-slate-400">
            Разбор сохранён в чате этого шага — он останется в истории урока.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </p>
      )}
    </section>
  );
}
