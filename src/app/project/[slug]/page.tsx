import { Suspense } from "react";
import { notFound } from "next/navigation";
import { loadConfig } from "@/lib/config";
import {
  readMilestoneBody,
  readProject,
  readProjectClarifications,
} from "@/lib/content/project";
import { readProjectContract } from "@/lib/exercise/project-contract";
import { openProgressDb } from "@/lib/progress/db";
import { readProjectProgress } from "@/lib/progress/projects";
import { ProjectReader } from "./reader";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = loadConfig();
  const project = readProject(config.contentDir, slug);
  if (!project) notFound();
  const bodies = Object.fromEntries(
    project.milestones.map((item) => [item.id, readMilestoneBody(config.contentDir, slug, item.id)]),
  );
  const progress = readProjectProgress(openProgressDb(config.dataDir), slug);
  const contracts = Object.fromEntries(
    project.milestones.map((item) => [item.id, readProjectContract(config.sourceDir, slug, item.id) !== null]),
  );
  const clarifications = Object.fromEntries(
    project.milestones.map((item) => [item.id, readProjectClarifications(config.contentDir, slug, item.id)]),
  );

  return (
    <Suspense fallback={<p className="text-slate-400">Загружаю проект…</p>}>
      <ProjectReader
        project={project}
        bodies={bodies}
        contracts={contracts}
        initialClarifications={clarifications}
        initialProgress={progress}
        lspUrl={`ws://127.0.0.1:${config.lspPort}`}
      />
    </Suspense>
  );
}
