export function VisualFrame({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      src={src}
      sandbox="allow-scripts"
      className="my-6 h-[520px] w-full rounded-lg border border-slate-200 dark:border-slate-700"
      title={title}
    />
  );
}
