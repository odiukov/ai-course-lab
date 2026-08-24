"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentPicker } from "@/components/AgentPicker";
import { StepBody } from "@/components/StepBody";
import { errorStatus } from "@/lib/agent/error-message";
import { parseSseFrames } from "@/lib/api/sse-client";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  kept: boolean;
}

export function ChatPanel({
  slug,
  stepId,
  draft,
  onKept,
  apiBase,
  subject = "step",
}: {
  slug: string;
  stepId: string;
  draft?: { text: string; at: number } | null;
  onKept: () => void;
  apiBase?: string;
  subject?: "step" | "milestone";
}) {
  const endpoint = apiBase ?? `/api/lesson/${slug}`;
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Всегда самое свежее значение поля — читается из эффекта подстановки без
  // того, чтобы держать `question` в его зависимостях (иначе подстановка
  // срабатывала бы на каждое нажатие клавиши).
  const questionRef = useRef(question);
  questionRef.current = question;
  // Текст последнего черновика, который сюда действительно подставили —
  // нужен, чтобы отличить «поле не тронули после подстановки» от «ученик
  // печатает что-то своё».
  const lastDraftTextRef = useRef<string | null>(null);

  // Кнопка «Объясни» из блока вопросов подставляет готовый текст в это же поле.
  // Ключ по `at`, а не по тексту: два одинаковых нажатия должны сработать оба.
  // Подстановка перетирает поле только если оно пустое или всё ещё содержит
  // предыдущий черновик слово в слово — если ученик уже печатает свой вопрос,
  // «Объясни» его не трогает.
  useEffect(() => {
    if (!draft) return;
    const current = questionRef.current;
    const emptyOrUntouched = current.trim() === "" || current === lastDraftTextRef.current;
    if (emptyOrUntouched) {
      setQuestion(draft.text);
      lastDraftTextRef.current = draft.text;
    }
  }, [draft]);

  const load = useCallback(async () => {
    const response = await fetch(`${endpoint}/chat?stepId=${encodeURIComponent(stepId)}`);
    const body = (await response.json()) as { session: { messages: Message[] } | null };
    setMessages(body.session?.messages ?? []);
  }, [endpoint, stepId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring the saved chat of the current step
    setStreaming("");
    setError(null);
    // Черновик из «Объясни» тоже принадлежит прежнему шагу — реальный сброс
    // самого пропа `draft` делает ридер, а здесь просто не тащим его текст в
    // историю нового шага, набранную под другим stepId.
    setQuestion("");
    lastDraftTextRef.current = null;
    void load();
  }, [load]);

  const ask = useCallback(async () => {
    const text = question.trim();
    if (!text || busy) return;

    setBusy(true);
    setError(null);
    setStreaming("");
    // Свой вопрос показывается сразу, до ответа сервера: id -1 живёт ровно до
    // перезагрузки истории в конце, где приезжает настоящий.
    setMessages((previous) => [...previous, { id: -1, role: "user", text, kept: false }]);
    setQuestion("");

    const response = await fetch(`${endpoint}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stepId, question: text }),
    });

    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Чат недоступен");
      setBusy(false);
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
        const payload = frame.data as { text?: string; message?: string; kind?: string };
        if (frame.event === "token" && payload.text) {
          collected += payload.text;
          setStreaming(collected);
        }
        if (frame.event === "error") {
          setError(errorStatus(payload.kind, payload.message ?? ""));
        }
      }
    }

    setStreaming("");
    setBusy(false);
    await load();
  }, [busy, endpoint, load, question, stepId]);

  const keep = useCallback(
    async (position: number) => {
      const answer = messages[position];
      // Заголовком блока становится вопрос, на который этот ответ отвечал, —
      // ближайшая реплика ученика выше по переписке.
      const asked = [...messages.slice(0, position)].reverse().find((item) => item.role === "user");
      if (!answer || !asked) return;

      await fetch(`${endpoint}/clarifications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stepId,
          question: asked.text,
          answer: answer.text,
          messageId: answer.id,
        }),
      });

      await load();
      onKept();
    },
    [endpoint, load, messages, onKept, stepId],
  );

  return (
    <section className="flex h-full flex-col gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400">
          {subject === "milestone" ? "Спросить про этот этап" : "Спросить про этот шаг"}
        </h2>
        <AgentPicker />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto">
        {messages.length === 0 && !streaming && (
          <p className="text-sm text-slate-400">
            Непонятное место спрашивается прямо здесь — ответ придёт в контексте {subject === "milestone" ? "этого этапа" : "этого шага"}.
          </p>
        )}

        {messages.map((message, position) =>
          message.role === "user" ? (
            <p
              key={`${message.id}-${position}`}
              className="rounded bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800"
            >
              {message.text}
            </p>
          ) : (
            <div key={`${message.id}-${position}`} className="space-y-2">
              <div className="text-sm">
                <StepBody body={message.text} />
              </div>
              {message.kept ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">
                  оставлено в теории
                </span>
              ) : (
                <button
                  onClick={() => void keep(position)}
                  className="rounded border border-emerald-600 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
                >
                  Оставить в теории
                </button>
              )}
            </div>
          ),
        )}

        {streaming && (
          <div className="text-sm">
            <StepBody body={streaming} />
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200"
          >
            {error}
          </p>
        )}
      </div>

      <textarea
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void ask();
        }}
        rows={3}
        placeholder="Что именно непонятно?"
        className="w-full rounded border border-slate-200 p-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
      <button
        onClick={() => void ask()}
        disabled={busy || question.trim().length === 0}
        className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
      >
        {busy ? "Думаю…" : "Спросить (⌘↵)"}
      </button>
    </section>
  );
}
