import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getMessage } from "@emberwalk/db";
import { followUpsFor } from "./actions.ts";
import { type Deps, depsFrom } from "./deps.ts";
import type { Env, TimerParams } from "./env.ts";

export type TimerResult = { messageId: string; outcome: "replied" | "gone" | "drafted" | "nothing_waiting" | "refused"; detail: string };

export const WAIT_STEP = "wait for a reply";
export const DRAFT_STEP = "draft the reminder";

export class FollowUpTimer extends WorkflowEntrypoint<Env, TimerParams> {
  protected deps(): Deps {
    return depsFrom(this.env);
  }

  override async run(event: WorkflowEvent<TimerParams>, step: WorkflowStep): Promise<TimerResult> {
    const { messageId } = event.payload;
    await step.sleep(WAIT_STEP, this.env.FOLLOW_UP_AFTER as Parameters<WorkflowStep["sleep"]>[1]);
    return step.do(DRAFT_STEP, async (): Promise<TimerResult> => {
      const d = this.deps();
      const message = await getMessage(d.db, messageId);
      if (message === null) return { messageId, outcome: "gone", detail: "the message no longer exists" };
      if (message.status === "replied") return { messageId, outcome: "replied", detail: "the crew replied" };
      const done = await followUpsFor(d, message.jobId);
      if ("code" in done && done.code === "unavailable") throw new Error(done.message);
      if ("code" in done) return { messageId, outcome: "refused", detail: done.message };
      return { messageId, outcome: done.value.followUps > 0 ? "drafted" : "nothing_waiting", detail: `${done.value.followUps} reminders drafted` };
    });
  }
}
