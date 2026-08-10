import type { BenchReport } from "@/lib/practice/bench";

const VERDICT: Record<string, string> = {
  ok: "в пределах шума",
  slow: "медленнее эталона",
  "very-slow": "заметно медленнее эталона",
  unknown: "измерить не удалось",
};

export function BenchTable({ report, fn }: { report: BenchReport; fn: string }) {
  const row = report.functions.find((item) => item.fn === fn);
  if (!row || !row.mine) {
    return <p className="text-sm text-slate-400">Замер не удался — числа показать нечего.</p>;
  }

  const cells: [string, string | number, string | number][] = [
    ["строк", row.mine.lines, row.ref.lines],
    ["циклов", row.mine.loops, row.ref.loops],
    ["вложенность", row.mine.depth, row.ref.depth],
    ["ветвлений", row.mine.branches, row.ref.branches],
    ["мкс", row.mine.us ?? "—", row.ref.us ?? "—"],
  ];

  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-400">
          <tr>
            <th className="py-1">метрика</th>
            <th className="py-1">ты</th>
            <th className="py-1">эталон</th>
          </tr>
        </thead>
        <tbody>
          {cells.map(([name, mine, reference]) => (
            <tr key={name} className="border-t border-slate-100 dark:border-slate-800">
              <td className="py-1 text-slate-500 dark:text-slate-400">{name}</td>
              <td className="py-1">{mine}</td>
              <td className="py-1">{reference}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {VERDICT[row.status]}
        {row.ratio !== null && row.status !== "ok" ? ` (×${row.ratio.toFixed(2)})` : ""}
      </p>
      {report.ruff.available ? (
        report.ruff.findings.length > 0 && (
          <ul className="list-disc pl-5 text-sm">
            {report.ruff.findings.map((finding, index) => (
              <li key={index}>
                <code>{finding.code}</code> (строка {finding.line}): {finding.message}
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="text-xs text-slate-400">ruff не установлен — линтер пропущен.</p>
      )}
    </div>
  );
}
