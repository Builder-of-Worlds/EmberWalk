import { z } from "zod";

export const StepTime = z.object({
  walkId: z.string().min(1),
  step: z.string().min(1).max(64),
  startedAt: z.iso.datetime(),
  ms: z.number().int().nonnegative(),
});
export type StepTime = z.infer<typeof StepTime>;

export const recordStepTime = async (db: D1Database, input: StepTime): Promise<void> => {
  const t = StepTime.parse(input);
  await db
    .prepare("INSERT INTO step_timings (walk_id, step, started_at, day, ms) VALUES (?, ?, ?, ?, ?)")
    .bind(t.walkId, t.step, t.startedAt, t.startedAt.slice(0, 10), t.ms)
    .run();
};
