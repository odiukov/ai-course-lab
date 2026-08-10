// npm run dev поднимает два процесса: Next.js и мост pyright. Отдельной
// зависимости для этого не нужно — достаточно двух спавнов и общего выхода.
import { spawn } from "node:child_process";

const children = [
  spawn("npx", ["next", "dev"], { stdio: "inherit" }),
  spawn("npx", ["tsx", "scripts/lsp-bridge.mts"], { stdio: "inherit" }),
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
