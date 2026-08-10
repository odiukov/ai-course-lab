"use client";

import { useEffect, useState } from "react";

interface ToolStatus {
  ok: boolean;
  detail: string;
}

interface Health {
  python: ToolStatus;
  pytest: ToolStatus;
  ruff: ToolStatus;
  lsp: ToolStatus;
}

// Тексты — из таблицы ошибок спеки: что именно сломано и что при этом всё ещё
// работает. Про ruff молчим: он необязателен, и его отсутствие видно в замере.
const MESSAGES: Record<keyof Health, string> = {
  python: "Python не найден — читать урок можно, прогонять тесты нет. Проверь PYTHON в .env.local.",
  pytest: "pytest не установлен в этом Python — тесты не запустятся. Поставь: python3 -m pip install pytest.",
  lsp: "Мост pyright не отвечает — редактор работает как обычный, без типов и автокомплита. Проверь, что npm run dev поднял оба процесса.",
  ruff: "",
};

export function PracticeStatus() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    // Однократная проверка инструментов при монтировании; сеттер вызывается
    // из .then/.catch, а не как оператор в теле эффекта, поэтому правило
    // react-hooks/set-state-in-effect тут и не срабатывает.
    void fetch("/api/health/practice")
      .then((response) => (response.ok ? (response.json() as Promise<Health>) : null))
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  if (!health) return null;
  const broken = (["python", "pytest", "lsp"] as const).filter((key) => !health[key].ok);
  if (broken.length === 0) return null;

  return (
    <div className="space-y-1 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      {broken.map((key) => (
        <p key={key}>
          {MESSAGES[key]} <span className="text-xs opacity-70">({health[key].detail})</span>
        </p>
      ))}
    </div>
  );
}
