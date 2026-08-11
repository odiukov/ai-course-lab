"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/api/fetch-json";
import type { AgentName } from "@/lib/progress/settings";

const AGENTS: AgentName[] = ["claude", "codex"];

/**
 * Выбор агента один на всё приложение: чат, генерация шагов и разбор кода
 * ходят в одну запись базы. Поэтому переключатель и не держит значение у
 * себя — он читает его при появлении, а после записи перечитывает.
 * Иначе два экземпляра на разных экранах разошлись бы после первого же
 * переключения.
 */
export function AgentPicker() {
  const [agent, setAgent] = useState<AgentName | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchJson<{ agent: AgentName }>("/api/settings/agent");
      if (cancelled) return;
      if (result.ok) setAgent(result.data.agent);
      else setError(result.error);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function pick(next: AgentName) {
    if (busy || next === agent) return;
    setBusy(true);
    setError(null);

    const result = await fetchJson<{ agent: AgentName }>("/api/settings/agent", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: next }),
    });

    setBusy(false);
    if (result.ok) setAgent(result.data.agent);
    else setError(result.error);
  }

  // До первого ответа сервера кнопки не рисуются: показать «claude» выбранным
  // раньше, чем известно, что выбран codex, значит соврать про то, кто
  // ответит на следующий вопрос.
  if (!agent && !error) return null;

  return (
    <span className="flex items-baseline gap-2 text-xs">
      <span className="text-slate-400">агент</span>
      {AGENTS.map((name) => (
        <button
          key={name}
          type="button"
          disabled={busy}
          onClick={() => void pick(name)}
          className={
            name === agent
              ? "rounded bg-slate-200 px-2 py-0.5 text-slate-900 dark:bg-slate-700 dark:text-slate-100"
              : "rounded px-2 py-0.5 text-slate-500 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-100"
          }
        >
          {name}
        </button>
      ))}
      {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
    </span>
  );
}
