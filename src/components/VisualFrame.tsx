export function VisualFrame({ path }: { path: string }) {
  return (
    <iframe
      src={`/api/visual?path=${encodeURIComponent(path)}`}
      sandbox="allow-scripts"
      className="my-6 h-[520px] w-full rounded-lg border border-slate-200"
      title={path}
    />
  );
}
