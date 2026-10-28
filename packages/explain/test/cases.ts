import type { Turn } from "../src/index.ts";

export type LiveCase = { label: string; language: "en" | "es"; turns: Turn[]; frameSeconds: number[] };

const TURNS: Turn[] = [
  { t: 4.5, text: "That is our firewood pile. I cover it with a tarp every night, but it sits right against the wall." },
  { t: 11, text: "The brush is what I cut last weekend. I have not hauled it away yet, it is still green." },
  { t: 16, text: "This fence is old cedar. It was here when we bought the place." },
];

const FRAMES = [5, 11, 16];

export const LIVE_CASES: Record<string, LiveCase> = {
  frames: { label: "frames only", language: "en", turns: [], frameSeconds: FRAMES },
  turns: { label: "spoken turns only", language: "en", turns: TURNS, frameSeconds: [] },
  both: { label: "frames and spoken turns", language: "en", turns: TURNS, frameSeconds: FRAMES },
  misleading: {
    label: "frames, and a remark the frames contradict",
    language: "en",
    turns: [{ t: 11, text: "There is no brush near the house. That is only mulch for the garden." }],
    frameSeconds: FRAMES,
  },
  partial: {
    label: "frames that show only the wood pile",
    language: "en",
    turns: [],
    frameSeconds: [1, 3, 5],
  },
  chatter: {
    label: "frames, and talk that has nothing to do with fire",
    language: "en",
    turns: [
      { t: 3, text: "The kids are at school, so it is quiet today." },
      { t: 8, text: "We painted the shed last spring." },
    ],
    frameSeconds: FRAMES,
  },
  spanish: {
    label: "frames and Spanish turns, a Spanish walk",
    language: "es",
    turns: [
      { t: 4.5, text: "Esa es la leña para el invierno. La tapo con una lona por la noche, pero está pegada a la pared." },
      { t: 11, text: "Corté esas ramas el fin de semana y todavía no las he llevado." },
    ],
    frameSeconds: FRAMES,
  },
};

export const caseNamed = (name: string | undefined): LiveCase => {
  const found = name === undefined ? undefined : LIVE_CASES[name];
  if (found === undefined) throw new Error(`EMBERWALK_EXPLAIN_CASE must be one of ${Object.keys(LIVE_CASES).join(", ")}`);
  return found;
};
