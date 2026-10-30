import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Deps } from "../src/deps.ts";
import type { Env, PipelineParams } from "../src/env.ts";
import { type PipelineResult, WalkPipeline as RealPipeline } from "../src/workflow.ts";
import { harness, testDeps } from "./harness.ts";

export { PipelineEntry } from "../src/index.ts";
export { MediaStandIn } from "./media-stand-in.ts";

type Doer = { do: (name: string, ...rest: unknown[]) => Promise<unknown> };

const recording = (step: WorkflowStep): WorkflowStep =>
  ({
    do: (name: string, ...rest: unknown[]) => {
      if (!harness.steps.includes(name)) harness.steps.push(name);
      return (step as unknown as Doer).do(name, ...rest);
    },
  }) as unknown as WorkflowStep;

export class WalkPipeline extends RealPipeline {
  protected override deps(): Deps {
    return testDeps(this.env as Env, harness);
  }

  override run(event: WorkflowEvent<PipelineParams>, step: WorkflowStep): Promise<PipelineResult> {
    return super.run(event, recording(step));
  }
}

export default {
  async fetch(): Promise<Response> {
    return new Response("test entry");
  },
} satisfies ExportedHandler<Env>;
