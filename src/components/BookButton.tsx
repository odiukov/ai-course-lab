"use client";

import { useState } from "react";

export function BookButton({ phase }: { phase?: number }) {
  const [state, setState] = useState<"idle" | "building">("idle");
  const [error, setError] = useState<string | null>(null);

  async function build() {
    setState("building");
    setError(null);
    try {
      const response = await fetch("/api/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(phase === undefined ? {} : { phase }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Не удалось собрать PDF");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ??
        (phase === undefined ? "ai-engineering-complete.pdf" : `phase-${phase}.pdf`);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось собрать PDF");
    } finally {
      setState("idle");
    }
  }

  if (error) {
    return (
      <span className="ml-auto flex items-baseline gap-2 text-xs text-red-600 dark:text-red-400">
        <span className="max-w-56 truncate" title={error}>{error}</span>
        <button type="button" className="underline underline-offset-2" onClick={build}>ещё раз</button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={build}
      disabled={state === "building"}
      className="ml-auto rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:border-slate-400 hover:text-slate-900 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
    >
      {state === "building"
        ? phase === undefined ? "Собираю весь курс…" : "Собираю PDF…"
        : phase === undefined ? "Собрать весь курс" : "Собрать книгу"}
    </button>
  );
}
