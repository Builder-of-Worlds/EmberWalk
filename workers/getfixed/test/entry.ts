import type { Deps } from "../src/deps.ts";
import type { Env } from "../src/env.ts";
import { receive } from "../src/inbound.ts";
import { GetFixed as RealService } from "../src/service.ts";
import { FollowUpTimer as RealTimer } from "../src/timer.ts";
import { testDeps } from "./harness.ts";

export class GetFixed extends RealService {
  protected override deps(): Deps {
    return testDeps(this.env);
  }
}

export class FollowUpTimer extends RealTimer {
  protected override deps(): Deps {
    return testDeps(this.env);
  }
}

export default {
  async fetch(): Promise<Response> {
    return new Response("test entry");
  },
  async email(message, env): Promise<void> {
    await receive(testDeps(env), message);
  },
} satisfies ExportedHandler<Env>;
