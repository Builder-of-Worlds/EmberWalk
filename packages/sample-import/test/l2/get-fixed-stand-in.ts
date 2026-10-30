import type { FixedAnswer, GetFixedService } from "../../../../workers/api/src/get-it-fixed-routes.ts";

const unavailable = async (): Promise<FixedAnswer> => ({ code: "unavailable", message: "test_stand_in" });

export const getFixedStandIn: GetFixedService = {
  start: unavailable,
  jobs: unavailable,
  draft: unavailable,
  addEmail: unavailable,
  approve: unavailable,
  sentByPhone: unavailable,
  logReply: unavailable,
  followUps: unavailable,
  inspection: unavailable,
  optOut: unavailable,
};
