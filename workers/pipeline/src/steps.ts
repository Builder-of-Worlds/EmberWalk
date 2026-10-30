export const STEP = {
  claim: "claim walk",
  prepare: "prepare",
  enterSegment: "enter segment",
  upload: (kind: string) => `upload ${kind}`,
  segment: (kind: string) => `segment ${kind}`,
  privacy: (kind: string) => `privacy ${kind}`,
  store: "store",
  transcribe: "transcribe",
  enterScore: "enter score",
  score: "score",
  voiceNotes: "voice notes",
  blur: "blur",
  coverage: "coverage",
  enterExplain: "enter explain",
  explain: "explain",
  secondCheck: "second check",
  preview: "preview",
  complete: "complete walk",
  deleteUploads: "delete uploads",
  fail: "fail walk",
  deleteVideo: "delete walk video",
  count: (after: string) => `count ${after}`,
} as const;

export const lookingSteps = (kinds: string[]): string[] => [
  STEP.enterSegment,
  ...kinds.flatMap((kind) => [STEP.upload(kind), STEP.segment(kind), STEP.privacy(kind)]),
  STEP.store,
  STEP.transcribe,
  STEP.enterScore,
  STEP.score,
  STEP.voiceNotes,
  STEP.blur,
  STEP.coverage,
];

export const WRITING_STEPS: readonly string[] = [STEP.enterExplain, STEP.explain, STEP.secondCheck, STEP.preview];

const withCounts = (names: readonly string[]): string[] => names.flatMap((name) => [name, STEP.count(name)]);

export const stepsFor = (kinds: string[]): string[] => [
  STEP.claim,
  STEP.prepare,
  ...withCounts(lookingSteps(kinds)),
  ...withCounts(WRITING_STEPS),
  STEP.complete,
  STEP.deleteUploads,
  STEP.deleteVideo,
];

export const orderProblems = (names: string[], kinds: string[]): string[] => {
  const expected = stepsFor(kinds);
  const counted = [...lookingSteps(kinds), ...WRITING_STEPS];
  const counts = new Set(counted.map(STEP.count));
  const problems = [
    ...expected.filter((name) => !names.includes(name)).map((name) => `${name} is missing`),
    ...names.filter((name) => !expected.includes(name)).map((name) => `${name} is not a step of a finished walk`),
  ];
  if (names.includes(STEP.deleteVideo) && names.at(-1) !== STEP.deleteVideo) problems.push(`${STEP.deleteVideo} is not last`);
  for (const name of counted) {
    const at = names.indexOf(STEP.count(name));
    if (at !== -1 && at < names.indexOf(name)) problems.push(`${STEP.count(name)} ran before ${name}`);
  }
  const ran = expected.filter((name) => names.includes(name) && !counts.has(name));
  for (const [i, later] of ran.entries()) {
    for (const earlier of ran.slice(0, i)) {
      if (names.indexOf(later) < names.indexOf(earlier)) problems.push(`${later} ran before ${earlier}`);
    }
  }
  return problems;
};
