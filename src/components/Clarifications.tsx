"use client";

import { StepBody } from "@/components/StepBody";

export interface ClarificationView {
  askedAt: string;
  question: string;
  answer: string;
}

function humanDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("ru-RU");
}

// Текст шага не меняется никогда: уточнения копятся под ним отдельным слоем,
// свёрнутые, с заголовком-вопросом. Чистятся руками — удалением блока из файла.
export function Clarifications({ items }: { items: ClarificationView[] }) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
      <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400">
        Уточнения ({items.length})
      </h2>
      {items.map((item, position) => (
        <details
          key={`${item.askedAt}-${position}`}
          className="rounded border border-slate-200 px-3 py-2 dark:border-slate-700"
        >
          <summary className="cursor-pointer text-sm">
            {item.question}
            <span className="ml-2 text-xs text-slate-400">{humanDate(item.askedAt)}</span>
          </summary>
          <div className="pt-2 text-sm">
            <StepBody body={item.answer} />
          </div>
        </details>
      ))}
    </section>
  );
}
