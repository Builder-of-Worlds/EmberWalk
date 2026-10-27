export const STEP = {
  claim: "claim walk",
  prepare: "prepare",
  enterSegment: "enter segment",
  upload: (kind: string) => `upload ${kind}`,
  segment: (kind: string) => `segment ${kind}`,
  privacy: (kind: string) => `privacy ${kind}`,
  store: "store",
  enterScore: "enter score",
  score: "score",
  blur: "blur",
  enterExplain: "enter explain",
  explain: "explain",
  complete: "complete walk",
  deleteUploads: "delete uploads",
  fail: "fail walk",
  deleteVideo: "delete walk video",
} as const;

export const stepsFor = (kinds: string[]): string[] => [
  STEP.claim,
  STEP.prepare,
  STEP.enterSegment,
  ...kinds.flatMap((kind) => [STEP.upload(kind), STEP.segment(kind), STEP.privacy(kind)]),
  STEP.store,
  STEP.enterScore,
  STEP.score,
  STEP.blur,
  STEP.enterExplain,
  STEP.explain,
  STEP.complete,
  STEP.deleteUploads,
  STEP.deleteVideo,
];

export const orderProblems = (names: string[], kinds: string[]): string[] => {
  const expected = stepsFor(kinds);
  const problems = [
    ...expected.filter((name) => !names.includes(name)).map((name) => `${name} is missing`),
    ...names.filter((name) => !expected.includes(name)).map((name) => `${name} is not a step of a finished walk`),
  ];
  if (names.includes(STEP.deleteVideo) && names.at(-1) !== STEP.deleteVideo) problems.push(`${STEP.deleteVideo} is not last`);
  const ran = expected.filter((name) => names.includes(name));
  for (const [i, later] of ran.entries()) {
    for (const earlier of ran.slice(0, i)) {
      if (names.indexOf(later) < names.indexOf(earlier)) problems.push(`${later} ran before ${earlier}`);
    }
  }
  return problems;
};
