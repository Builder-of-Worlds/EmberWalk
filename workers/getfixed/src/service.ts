import { WorkerEntrypoint } from "cloudflare:workers";
import * as act from "./actions.ts";
import { type Deps, depsFrom } from "./deps.ts";
import type { Env } from "./env.ts";

export class GetFixed extends WorkerEntrypoint<Env> {
  protected deps(): Deps {
    return depsFrom(this.env);
  }

  start(walkId: string, zip: string) {
    return act.start(this.deps(), walkId, zip);
  }

  jobs(walkId: string) {
    return act.view(this.deps(), walkId);
  }

  draft(jobId: string) {
    return act.draft(this.deps(), jobId);
  }

  addEmail(jobId: string, crewId: string, email: string) {
    return act.addEmail(this.deps(), jobId, crewId, email);
  }

  approve(messageId: string, visitorId: string) {
    return act.approve(this.deps(), messageId, visitorId);
  }

  sentByPhone(messageId: string) {
    return act.sentByPhone(this.deps(), messageId);
  }

  logReply(messageId: string, text: string) {
    return act.logReply(this.deps(), messageId, text);
  }

  followUps(walkId: string) {
    return act.followUps(this.deps(), walkId);
  }

  inspection(walkId: string) {
    return act.inspection(this.deps(), walkId);
  }

  optOut(token: string) {
    return act.optOut(this.deps(), token);
  }
}
