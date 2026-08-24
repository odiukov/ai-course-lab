import type { DatabaseSync } from "node:sqlite";
import { execute, queryAll } from "./db";

export interface MilestoneProgress {
  milestoneId: string;
  contractState: "unopened" | "failed" | "passed";
  verifiedAt: string | null;
  evidence: string;
  openedAt: string | null;
}

export interface RubricProgress {
  criterion: string;
  score: number | null;
  note: string;
}

export function readProjectProgress(db: DatabaseSync, projectSlug: string): {
  milestones: MilestoneProgress[];
  rubric: RubricProgress[];
} {
  const milestones = queryAll<{
    milestone_id: string;
    contract_state: MilestoneProgress["contractState"];
    verified_at: string | null;
    evidence: string | null;
    opened_at: string | null;
  }>(
    db,
    `SELECT milestone_id, contract_state, verified_at, evidence, opened_at
       FROM milestone_state WHERE project_slug = ? ORDER BY milestone_id`,
    projectSlug,
  ).map((row) => ({
    milestoneId: row.milestone_id,
    contractState: row.contract_state,
    verifiedAt: row.verified_at,
    evidence: row.evidence ?? "",
    openedAt: row.opened_at,
  }));
  const rubric = queryAll<{ criterion: string; score: number | null; note: string | null }>(
    db,
    `SELECT criterion, score, note FROM project_rubric WHERE project_slug = ? ORDER BY criterion`,
    projectSlug,
  ).map((row) => ({ criterion: row.criterion, score: row.score, note: row.note ?? "" }));
  return { milestones, rubric };
}

export function openMilestone(db: DatabaseSync, projectSlug: string, milestoneId: string): void {
  execute(
    db,
    `INSERT INTO milestone_state (project_slug, milestone_id, contract_state, opened_at)
     VALUES (?, ?, 'unopened', ?)
     ON CONFLICT(project_slug, milestone_id) DO UPDATE SET
       opened_at = COALESCE(milestone_state.opened_at, excluded.opened_at)`,
    projectSlug,
    milestoneId,
    new Date().toISOString(),
  );
}

export function saveMilestoneEvidence(
  db: DatabaseSync,
  projectSlug: string,
  milestoneId: string,
  evidence: string,
  verified: boolean,
): void {
  execute(
    db,
    `INSERT INTO milestone_state
       (project_slug, milestone_id, contract_state, evidence, verified_at, opened_at)
     VALUES (?, ?, 'unopened', ?, ?, ?)
     ON CONFLICT(project_slug, milestone_id) DO UPDATE SET
       evidence = excluded.evidence,
       verified_at = excluded.verified_at,
       opened_at = COALESCE(milestone_state.opened_at, excluded.opened_at)`,
    projectSlug,
    milestoneId,
    evidence,
    verified ? new Date().toISOString() : null,
    new Date().toISOString(),
  );
}

export function saveRubricScore(
  db: DatabaseSync,
  projectSlug: string,
  criterion: string,
  score: number | null,
  note: string,
): void {
  execute(
    db,
    `INSERT INTO project_rubric (project_slug, criterion, score, note)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_slug, criterion) DO UPDATE SET score = excluded.score, note = excluded.note`,
    projectSlug,
    criterion,
    score,
    note,
  );
}
