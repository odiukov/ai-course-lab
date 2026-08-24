"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StepBody } from "@/components/StepBody";
import { ExercisePanel } from "@/components/ExercisePanel";
import { ChatPanel } from "@/components/ChatPanel";
import { Clarifications, type ClarificationView } from "@/components/Clarifications";
import type { Project } from "@/lib/content/project";
import type { MilestoneProgress, RubricProgress } from "@/lib/progress/projects";

interface Progress {
  milestones: MilestoneProgress[];
  rubric: RubricProgress[];
}

interface MilestoneDraft {
  evidence: string;
  verified: boolean;
  contractTarget: string;
}

export function ProjectReader({
  project,
  bodies,
  contracts,
  initialClarifications,
  initialProgress,
  lspUrl,
}: {
  project: Project;
  bodies: Record<string, string>;
  contracts: Record<string, boolean>;
  initialClarifications: Record<string, ClarificationView[]>;
  initialProgress: Progress;
  lspUrl: string | null;
}) {
  const search = useSearchParams();
  const router = useRouter();
  const requested = search.get("milestone");
  const first = project.milestones[0].id;
  const activeId = project.milestones.some((item) => item.id === requested) ? requested! : first;
  const active = project.milestones.find((item) => item.id === activeId)!;
  const [progress, setProgress] = useState(initialProgress);
  const [clarifications, setClarifications] = useState(initialClarifications);
  const state = progress.milestones.find((item) => item.milestoneId === activeId);
  const [drafts, setDrafts] = useState<Record<string, MilestoneDraft>>({});
  const draft = drafts[activeId] ?? {
    evidence: state?.evidence ?? "",
    verified: Boolean(state?.verifiedAt),
    contractTarget: active.contractTargets[0] ?? "",
  };
  const { evidence, verified, contractTarget } = draft;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const updateDraft = (patch: Partial<MilestoneDraft>) => {
    setDrafts((current) => ({
      ...current,
      [activeId]: { ...draft, ...patch },
    }));
  };

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch(`/api/project/${project.slug}/progress`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as Progress & { error?: string };
    if (!response.ok) throw new Error(json.error ?? "Не удалось сохранить прогресс");
    setProgress(json);
  };

  useEffect(() => {
    void fetch(`/api/project/${project.slug}/progress`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "open", milestoneId: activeId }),
    });
  }, [activeId, project.slug]);

  const refreshProgress = async () => {
    const response = await fetch(`/api/project/${project.slug}/progress`);
    if (response.ok) setProgress(await response.json() as Progress);
  };

  const refreshClarifications = async () => {
    const response = await fetch(`/api/project/${project.slug}/clarifications`);
    if (response.ok) setClarifications(await response.json() as Record<string, ClarificationView[]>);
  };

  const contractMilestones = project.milestones.filter((item) => item.contractTargets.length > 0);
  const counts = {
    contracts: contractMilestones.filter((milestone) =>
      progress.milestones.some((item) => item.milestoneId === milestone.id && item.contractState === "passed"),
    ).length,
    contractTotal: contractMilestones.length,
    verified: progress.milestones.filter((item) => item.verifiedAt).length,
  };

  const saveEvidence = async () => {
    setSaving(true);
    setError("");
    try {
      await post({ action: "evidence", milestoneId: activeId, evidence, verified });
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl space-y-8">
      <header className="space-y-3">
        <p className="text-sm font-medium text-violet-600 dark:text-violet-400">Капстоун · {project.time}</p>
        <h1 className="text-3xl font-semibold">{project.title}</h1>
        <p className="max-w-3xl text-slate-600 dark:text-slate-300">{project.summary}</p>
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          {project.tracks.map((track) => <span key={track} className="rounded-full border px-2 py-1">{track}</span>)}
        </div>
        <p className="text-sm text-slate-500">
          Швы: {counts.contracts} из {counts.contractTotal} · реальный прогон: {counts.verified} из {project.milestones.length}
        </p>
      </header>

      <details className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
        <summary className="cursor-pointer font-medium">Бриф и архитектура</summary>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <section><h2 className="mb-2 text-lg font-medium">Проблема</h2><StepBody body={project.brief.problem} /></section>
          <section><h2 className="mb-2 text-lg font-medium">Концепция</h2><StepBody body={project.brief.concept} /></section>
          <section><h2 className="mb-2 text-lg font-medium">Архитектура</h2><StepBody body={project.brief.architecture} /></section>
          <section><h2 className="mb-2 text-lg font-medium">Стек</h2><ul className="list-disc space-y-1 pl-5">{project.brief.stack.map((item) => <li key={item}>{item}</li>)}</ul></section>
        </div>
      </details>

      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <nav className="space-y-1" aria-label="Этапы проекта">
          {project.milestones.map((item, index) => {
            const itemState = progress.milestones.find((entry) => entry.milestoneId === item.id);
            return (
              <button
                key={item.id}
                onClick={() => router.replace(`/project/${project.slug}?milestone=${item.id}`, { scroll: false })}
                className={`w-full rounded px-3 py-2 text-left text-sm ${item.id === activeId ? "bg-violet-100 dark:bg-violet-950" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
              >
                <span className="mr-2 tabular-nums text-slate-400">{index + 1}</span>{item.title}
                <span className="ml-2 text-xs text-emerald-600">{itemState?.verifiedAt ? "проверен" : ""}</span>
              </button>
            );
          })}
        </nav>

        <article className="space-y-6">
          <div><h2 className="text-2xl font-semibold">{active.title}</h2><p className="mt-2 text-slate-600 dark:text-slate-300">{active.task}</p></div>
          <StepBody body={bodies[active.id] ?? ""} />
          <section className="rounded-lg bg-slate-50 p-4 dark:bg-slate-900">
            <h3 className="font-medium">Готово, когда</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">{active.doneWhen.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
          <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
            <h3 className="font-medium">Локальный контракт</h3>
            {active.contractTargets.length > 0 && contracts[active.id] ? (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {active.contractTargets.map((target) => (
                    <button key={target} onClick={() => updateDraft({ contractTarget: target })} className={`rounded border px-2 py-1 text-xs ${target === contractTarget ? "border-violet-500 bg-violet-50 dark:bg-violet-950" : "border-slate-300 dark:border-slate-700"}`}>{target}</button>
                  ))}
                </div>
                {contractTarget && (
                  <ExercisePanel
                    slug={project.slug}
                    stepId={active.id}
                    fn={contractTarget}
                    file="main.py"
                    lspUrl={lspUrl}
                    apiBase={`/api/project/${project.slug}/milestone/${active.id}`}
                    allowReview={false}
                    onProgressChanged={() => void refreshProgress()}
                  />
                )}
              </div>
            ) : active.contractTargets.length > 0 ? (
              <p className="mt-2 text-sm text-slate-500">Контракт этого этапа ещё готовится.</p>
            ) : <p className="mt-2 text-sm text-slate-500">У этого внешнего этапа нет отдельного локального шва.</p>}
          </section>
          <section className="space-y-3 rounded-lg border border-amber-200 p-4 dark:border-amber-900">
            <h3 className="font-medium">Доказательство реального прогона</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">{active.evidence}</p>
            <textarea value={evidence} onChange={(event) => updateDraft({ evidence: event.target.value })} rows={4} placeholder="Ссылка на PR, команда и вывод, путь к trace bundle или измеренные метрики" className="w-full rounded border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={verified} onChange={(event) => updateDraft({ verified: event.target.checked })} /> Реальный прогон выполнен</label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button onClick={() => void saveEvidence()} disabled={saving} className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">{saving ? "Сохраняю…" : "Сохранить доказательство"}</button>
          </section>
          <Clarifications items={clarifications[active.id] ?? []} />
          <div className="min-h-[32rem]">
            <ChatPanel
              slug={project.slug}
              stepId={active.id}
              apiBase={`/api/project/${project.slug}`}
              subject="milestone"
              onKept={() => void refreshClarifications()}
            />
          </div>
        </article>
      </div>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold">Рубрика проекта</h2>
        {project.rubric.map((row) => {
          const saved = progress.rubric.find((item) => item.criterion === row.id);
          return <RubricRow key={row.id} slug={project.slug} row={row} initial={saved} onSaved={setProgress} />;
        })}
      </section>
    </main>
  );
}

function RubricRow({ slug, row, initial, onSaved }: {
  slug: string;
  row: Project["rubric"][number];
  initial?: RubricProgress;
  onSaved: (progress: Progress) => void;
}) {
  const [score, setScore] = useState(initial?.score?.toString() ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const save = async () => {
    const response = await fetch(`/api/project/${slug}/progress`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "rubric", criterion: row.id, score: score === "" ? null : Number(score), note }),
    });
    if (response.ok) onSaved(await response.json() as Progress);
  };
  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700 md:grid-cols-[1fr_6rem_1fr_auto] md:items-center">
      <div><h3 className="font-medium">{row.criterion} · {row.weight}</h3><p className="text-sm text-slate-500">{row.measurement}</p></div>
      <input type="number" min={0} max={row.weight} value={score} onChange={(event) => setScore(event.target.value)} placeholder={`0–${row.weight}`} className="rounded border p-2 dark:border-slate-700 dark:bg-slate-950" />
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Заметка" className="rounded border p-2 dark:border-slate-700 dark:bg-slate-950" />
      <button onClick={() => void save()} className="rounded border px-3 py-2 text-sm">Сохранить</button>
    </div>
  );
}
