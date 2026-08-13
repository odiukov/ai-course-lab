import type { Metadata } from "next";
// Стили KaTeX подключены здесь, а не в StepBody: компонент, который тянет за
// собой CSS, нельзя отрендерить вне Next — а сборка статического сайта делает
// ровно это.
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Курс",
  description: "Локальная платформа для прохождения курса AI Engineering",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="mx-auto max-w-6xl px-6 py-10 text-slate-900 antialiased dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
