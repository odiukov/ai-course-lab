import fs from "node:fs";
import path from "node:path";
import {
  deriveLabExercise,
  type LabExerciseSpec,
} from "../src/lib/generate/derive-lab-exercise";
import { verifyDerivedLabExercise } from "../src/lib/generate/verify-lab-exercise";

const [lessonArg, exerciseArg] = process.argv.slice(2);
if (!lessonArg || !exerciseArg) {
  console.error("Использование: tsx scripts/derive-lab-exercise.mts <каталог-урока> <каталог-упражнения>");
  process.exit(2);
}

const lessonDir = path.resolve(lessonArg);
const exerciseDir = path.resolve(exerciseArg);
const specPath = path.join(lessonDir, "lab.json");
if (!fs.existsSync(specPath)) {
  console.error(`Нет спецификации лаборатории ${specPath}`);
  process.exit(2);
}

const spec = JSON.parse(fs.readFileSync(specPath, "utf8")) as LabExerciseSpec;
deriveLabExercise(path.join(lessonDir, "code"), exerciseDir, spec);
await verifyDerivedLabExercise(exerciseDir, spec, process.env.PYTHON ?? "python3");
console.log(`Упражнение собрано: ${exerciseDir}`);
