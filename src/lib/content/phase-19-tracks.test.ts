import path from "node:path";
import { describe, expect, it } from "vitest";
import { readPhase19Tracks } from "./phase-19-tracks";

describe("readPhase19Tracks", () => {
  it("покрывает каждую лабораторию 20–87 ровно один раз", () => {
    const tracks = readPhase19Tracks(path.join(process.cwd(), "content"));
    const labs = tracks.flatMap((track) => track.labs);
    expect(labs).toHaveLength(68);
    expect(new Set(labs).size).toBe(68);
    expect(labs[0]).toMatch(/^20-/);
    expect(labs.at(-1)).toMatch(/^87-/);
  });

  it("описывает девять серий и связывает их с капстоунами", () => {
    const tracks = readPhase19Tracks(path.join(process.cwd(), "content"));
    expect(tracks).toHaveLength(9);
    expect(tracks.every((track) => track.projects.length > 0)).toBe(true);
  });
});
