import { defineTool, type Tool } from "@emberwalk/meta";
import { Id, OutgoingMessage, Trade, Zip } from "@emberwalk/shared";
import { z } from "zod";

export const FindCrewsArgs = z.strictObject({ trade: Trade, zip: Zip });
export type FindCrewsArgs = z.infer<typeof FindCrewsArgs>;

const { channel, subject, body } = OutgoingMessage.shape;

export const DraftRequestArgs = z
  .strictObject({ crewId: Id, findingIds: z.array(Id).min(1).max(50), channel, subject, body })
  .refine((a) => a.channel === "email" || a.subject === null, { message: "a text has no subject", path: ["subject"] });
export type DraftRequestArgs = z.infer<typeof DraftRequestArgs>;

export const findCrews = defineTool(
  "find_crews",
  "Find up to three licensed crews near the house for this job's trade. Call it once per job, before any draft.",
  FindCrewsArgs,
);

export const draftRequest = defineTool(
  "draft_request",
  "Write one quote request to one crew this job found, about this job's findings. It is stored as a draft for the homeowner to read; nothing is sent.",
  DraftRequestArgs,
);

export const AGENT_TOOLS = [findCrews, draftRequest] as Tool<unknown>[];
