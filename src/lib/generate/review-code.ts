import type { AgentEvent } from "../agent/events";
import { renderPrompt } from "../agent/prompts";
import type { BenchReport } from "../practice/bench";
import type { GenerateDeps } from "./plan-lesson";
import { stripEnclosingFence } from "./write-step";

export const MAX_CODE_CHARS = 4000;

export interface ReviewRequest {
  lessonTitle: string;
  stepTitle: string;
  fn: string;
  mineCode: string;
  solutionCode: string;
  tests: string;
  metrics: string;
  ruff: string;
}

function truncate(text: string, limit = MAX_CODE_CHARS): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

// Ровно то, что известно о прогоне из его записи в базе: сколько тестов
// прошло, сколько упало и что именно гонялось. Общего числа собранных тестов в
// записи нет, поэтому раньше вызывающий подставлял total = passed — и агент
// получал «17 из 17 зелёные» даже там, где половина тестов не отбиралась.
export function formatTests(result: {
  passed: number;
  failed: number;
  filtered: boolean;
  warning: string | null;
}): string {
  const scope = result.filtered
    ? "гонялся только набор этой функции"
    : "прогнан весь файл упражнения, а не только эта функция";
  return [`зелёных: ${result.passed}, упавших: ${result.failed}`, scope, result.warning]
    .filter((part) => Boolean(part))
    .join(". ");
}

export function formatMetrics(row: BenchReport["functions"][number] | undefined): string {
  if (!row || !row.mine) return "(замер не удался)";
  const lines = [
    `строк: ${row.mine.lines} / ${row.ref.lines}`,
    `циклов: ${row.mine.loops} / ${row.ref.loops}`,
    `вложенность: ${row.mine.depth} / ${row.ref.depth}`,
    `ветвлений: ${row.mine.branches} / ${row.ref.branches}`,
  ];
  if (row.mine.us !== null && row.ref.us !== null) {
    lines.push(`время: ${row.mine.us} / ${row.ref.us} мкс`);
  }
  // Вердикт словами, а не только числом: иначе агент трактует 1.04 как
  // проблему и выдумывает объяснение шуму измерения.
  if (row.ratio !== null) {
    lines.push(
      row.status === "ok"
        ? `разница в пределах шума (×${row.ratio.toFixed(2)})`
        : `медленнее эталона в ${row.ratio.toFixed(2)} раза`,
    );
  }
  return lines.map((line) => `- ${line}`).join("\n");
}

export function formatRuff(report: BenchReport["ruff"], fn: string): string {
  if (!report.available) return "ruff не установлен — линтер пропущен";
  if (report.findings.length === 0) return "чисто";
  return report.findings
    .map((item) => `- ${item.code} (строка ${item.line}): ${item.message}`)
    .join("\n")
    .concat(`\n(находки по всему файлу; разбираем только ${fn})`);
}

export function buildReviewPrompt(request: ReviewRequest): string {
  return renderPrompt("review-code", {
    lesson_title: request.lessonTitle,
    step_title: request.stepTitle,
    fn: request.fn,
    mine_code: truncate(request.mineCode),
    solution_code: truncate(request.solutionCode),
    tests: request.tests,
    metrics: request.metrics,
    ruff: request.ruff,
  });
}

export async function reviewCode(opts: {
  request: ReviewRequest;
  deps: GenerateDeps;
  onEvent?: (event: AgentEvent) => void;
}): Promise<string> {
  const onEvent = opts.onEvent ?? (() => {});
  const text = stripEnclosingFence(await opts.deps.run(buildReviewPrompt(opts.request), onEvent));
  if (text.length === 0) {
    throw new Error("Агент вернул пустой разбор — попробуй ещё раз");
  }
  return text;
}
