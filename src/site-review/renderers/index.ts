import { choice } from "./choice";
import { cloze } from "./cloze";
import { numeric } from "./numeric";
import { open } from "./open";
import { order } from "./order";
import type { CardRenderer } from "./types";
import type { SiteCard } from "../../lib/site/cards-payload";

export type { AnswerResult, CardRenderer } from "./types";

export const RENDERERS: Record<SiteCard["kind"], CardRenderer> = {
  choice,
  numeric,
  cloze,
  order,
  open,
};
