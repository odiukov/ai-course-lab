// npm run dev поднимает два процесса: Next.js и мост pyright. Отдельной
// зависимости для этого не нужно — достаточно двух спавнов и общего выхода.
import { spawn } from "node:child_process";
import path from "node:path";

// Бинарники запускаются напрямую, а не через npx. npx — это ещё один процесс
// посередине: child.kill() убивал обёртку, а настоящие next dev и tsx
// оставались жить и держать порты 3000 и 3001, так что следующий npm run dev
// падал с EADDRINUSE.
const bin = (name) => path.join(process.cwd(), "node_modules", ".bin", name);

const children = [
  spawn(bin("next"), ["dev"], { stdio: "inherit" }),
  spawn(bin("tsx"), ["scripts/lsp-bridge.mts"], { stdio: "inherit" }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
}

for (const child of children) {
  child.on("exit", (code) => stop(code ?? 0));
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
