"use client";

import { useState } from "react";
import { fetchJson } from "@/lib/api/fetch-json";
import { practiceErrorStatus, type PracticeErrorKind } from "@/lib/practice/errors";

interface ScriptResult {
  passed: boolean;
  exitCode: number | null;
  command: string;
  stdout: string;
  stderr: string;
}

export function ScriptRunPanel({
  slug,
  stepId,
  file,
  onProgressChanged,
}: {
  slug: string;
  stepId: string;
  file: string;
  onProgressChanged: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const response = await fetchJson<{
        result: ScriptResult;
        state: "passed" | "failed";
      }>(`/api/lesson/${slug}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stepId }),
      });
      if (!response.ok) {
        const kind = (response.data as { kind?: PracticeErrorKind } | null)?.kind;
        setError(practiceErrorStatus(kind, response.error));
        return;
      }
      setResult(response.data.result);
      onProgressChanged();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3 rounded border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
        >
          {running ? `Запускаю ${file}…` : `Запустить ${file}`}
        </button>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Зачёт — завершение всей системы с кодом 0
        </span>
      </div>

      {result && (
        <div
          className={`rounded px-3 py-2 text-sm ${
            result.passed
              ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              : "bg-rose-50 text-rose-900 dark:bg-rose-950 dark:text-rose-200"
          }`}
        >
          <p className="font-medium">
            {result.passed ? "Система сошлась" : `Скрипт завершился с кодом ${result.exitCode ?? "?"}`}
          </p>
          <p className="mt-1 text-xs"><code>{result.command}</code></p>
          {(result.stdout || result.stderr) && (
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-white/60 p-2 text-xs dark:bg-black/30">
              <code>{[result.stdout, result.stderr].filter(Boolean).join("\n")}</code>
            </pre>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </p>
      )}
    </div>
  );
}
