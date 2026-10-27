import { getWalk } from "@emberwalk/db";
import { Id } from "@emberwalk/shared";
import type { Env } from "./env.ts";

const started = { started: true } as const;
const notStarted = (reason: "unknown_walk" | "not_queued" | "already_started") => ({ started: false, reason }) as const;

export type StartResult = typeof started | ReturnType<typeof notStarted>;

export const startWalk = async (env: Pick<Env, "DB" | "PIPELINE">, walkId: string): Promise<StartResult> => {
  const id = Id.parse(walkId);
  const walk = await getWalk(env.DB, id);
  if (walk === null) return notStarted("unknown_walk");
  if (walk.state.name !== "queued") return notStarted("not_queued");
  try {
    await env.PIPELINE.create({ id, params: { walkId: id } });
  } catch (error) {
    const existing = await env.PIPELINE.get(id).catch(() => null);
    if (existing === null) throw error;
    return notStarted("already_started");
  }
  return started;
};
