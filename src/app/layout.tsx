import type { Metadata } from "next";
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
