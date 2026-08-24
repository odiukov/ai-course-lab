import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const slug = /^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const trackSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  purpose: z.string().min(1),
  labs: z.array(z.string().regex(slug)).min(1),
  projects: z.array(z.string().regex(slug)),
});

const phase19TracksSchema = z.object({
  version: z.literal(1),
  tracks: z.array(trackSchema).length(9),
});

export type Phase19Track = z.infer<typeof trackSchema>;

export function readPhase19Tracks(contentDir: string): Phase19Track[] {
  const file = path.join(contentDir, "phase-19", "tracks.json");
  return phase19TracksSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))).tracks;
}
