import { claimWalk, completeWalk, type Failure, failWalk, findingsForWalk, moveWalkStep, tagsForWalk } from "@emberwalk/db";
import type { Clip, PipelineStep } from "@emberwalk/shared";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { blurredStills } from "./blur.ts";
import { type Deps, depsFrom } from "./deps.ts";
import type { Env, PipelineParams } from "./env.ts";
import { explainWalk } from "./explain-step.ts";
import { type Outcome, pass } from "./outcome.ts";
import { clipStart, prepareWalk } from "./prepare.ts";
import { findPrivacy } from "./privacy.ts";
import { scoreWalk } from "./score.ts";
import { dropUpload, segmentClip, uploadClip } from "./segment.ts";
import { STEP } from "./steps.ts";
import { dropWalkVideo } from "./storage.ts";
import { storeWalk } from "./store.ts";

const RETRY = { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "15 minutes" } as const;

export type PipelineResult = { status: "done" } | { status: "failed"; failure: Failure } | { status: "skipped" };

type Progress = { step: PipelineStep; uploads: string[] };

const stuck = (step: PipelineStep): Failure => ({
  code: `${step}_failed`,
  message: "Something went wrong while checking this walk. Please try again.",
});

const blurWalk = async (deps: Deps, walkId: string, clips: Clip[]): Promise<Outcome<{ stills: number }>> => {
  const [findings, tags] = await Promise.all([findingsForWalk(deps.db, walkId), tagsForWalk(deps.db, walkId)]);
  let stills = 0;
  for (const clip of clips) {
    const proofs = findings.filter((f) => f.proofFrame.clipId === clip.id).map((f) => [f.proofFrame.still, f.proofFrame.frame] as const);
    const wanted = [...new Map(proofs)].map(([output, frame]) => ({ frame, output }));
    const made = await blurredStills(deps, walkId, clip, clipStart(tags, clip.kind), wanted);
    if (!made.ok) return made;
    stills += made.value.stills;
  }
  return pass({ stills });
};

export class WalkPipeline extends WorkflowEntrypoint<Env, PipelineParams> {
  protected deps(): Deps {
    return depsFrom(this.env);
  }

  override async run(event: WorkflowEvent<PipelineParams>, step: WorkflowStep): Promise<PipelineResult> {
    const { walkId } = event.payload;
    const deps = this.deps();
    const claimed = await step.do(STEP.claim, () => claimWalk(deps.db, walkId));
    if (!claimed) return { status: "skipped" };

    const progress: Progress = { step: "prepare", uploads: [] };
    let failure: Failure | null;
    let thrown: unknown = null;
    try {
      failure = await this.work(deps, step, walkId, progress);
    } catch (error) {
      thrown = error;
      failure = stuck(progress.step);
    }
    if (progress.uploads.length > 0) {
      await step.do(STEP.deleteUploads, async () => {
        await Promise.all(progress.uploads.map((fileId) => dropUpload(deps, fileId)));
      });
    }
    if (failure !== null) {
      const reason = failure;
      await step.do(STEP.fail, () => failWalk(deps.db, walkId, progress.step, reason));
    }
    // Every step that reads the video goes before this one; it must stay last.
    await step.do(STEP.deleteVideo, RETRY, () => dropWalkVideo(deps.bucket, walkId));
    if (failure === null) return { status: "done" };
    if (thrown !== null) throw thrown;
    return { status: "failed", failure };
  }

  private async work(deps: Deps, step: WorkflowStep, walkId: string, progress: Progress): Promise<Failure | null> {
    const prepared = await step.do(STEP.prepare, RETRY, () => prepareWalk(deps, walkId));
    if (!prepared.ok) return prepared.failure;

    progress.step = "segment";
    await step.do(STEP.enterSegment, () => moveWalkStep(deps.db, walkId, "segment"));
    const clipIds: string[] = [];
    for (const clip of prepared.value) {
      const uploaded = await step.do(STEP.upload(clip.kind), RETRY, () => uploadClip(deps, walkId, clip));
      if (!uploaded.ok) return uploaded.failure;
      progress.uploads.push(uploaded.value);
      const segmented = await step.do(STEP.segment(clip.kind), RETRY, () => segmentClip(deps, walkId, clip, uploaded.value));
      if (!segmented.ok) return segmented.failure;
      const checked = await step.do(STEP.privacy(clip.kind), RETRY, () => findPrivacy(deps, walkId, clip, uploaded.value));
      if (!checked.ok) return checked.failure;
      clipIds.push(segmented.value.clipId);
    }
    await step.do(STEP.store, RETRY, () => storeWalk(deps, walkId, clipIds));

    progress.step = "score";
    await step.do(STEP.enterScore, () => moveWalkStep(deps.db, walkId, "score"));
    const scored = await step.do(STEP.score, RETRY, async () => {
      const outcome = await scoreWalk(deps, walkId);
      return outcome.ok ? pass({ findings: outcome.value.findings.length }) : outcome;
    });
    if (!scored.ok) return scored.failure;
    const blurred = await step.do(STEP.blur, RETRY, () => blurWalk(deps, walkId, prepared.value));
    if (!blurred.ok) return blurred.failure;

    if (scored.value.findings > 0) {
      progress.step = "explain";
      await step.do(STEP.enterExplain, () => moveWalkStep(deps.db, walkId, "explain"));
      await step.do(STEP.explain, RETRY, () => explainWalk(deps, walkId));
    }
    await step.do(STEP.complete, () => completeWalk(deps.db, walkId));
    return null;
  }
}
