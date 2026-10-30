import { type Band, SecondCheck } from "@emberwalk/shared";
import type { Call, ContentKind, MetaClient } from "./client.ts";
import { MetaRefused } from "./errors.ts";
import { type ChatToolTurn, sparkOpenToolCall, withRetries } from "./baseten.ts";
import { defineTool } from "./tools.ts";

export const CHECK_INPUT_TOKENS = 3000;
export const CHECK_OUTPUT_TOKENS = 2048;

export const CHECK_INSTRUCTIONS = [
  "You are the second reviewer in a wildfire defensible space check of one house. Another model wrote the instruction the homeowner will read.",
  "You get one finding: what was found, how far it is from the house, whether it is Required Now or Recommended, the rule text it cites, the instruction, and the photo the finding was made from. Parts of the photo may be blurred for privacy.",
  "Call check_instruction exactly once.",
  "verdict agrees when the instruction is safe, fits the cited rule's distances and requirement, and fits what the photo shows.",
  "verdict flags when the instruction is unsafe, contradicts the rule, asks for more or less than the rule supports, or names something the photo does not show.",
  "reason: one plain sentence of 30 words or fewer saying why, in the language of the instruction.",
].join("\n");

export const checkInstruction = defineTool(
  "check_instruction",
  "Record whether the instruction for this finding is right, with one plain reason.",
  SecondCheck,
);

export type CheckFinding = {
  concept: string;
  band: Band;
  distanceFeet: { low: number; high: number };
  label: "required_now" | "recommended";
  instruction: string;
  rules: { citation: string; words: string }[];
  photo: string;
};

export type CheckOptions = {
  content: ContentKind;
  walkId: string | null;
  realWalks: boolean;
  sleep: (ms: number) => Promise<void>;
};

const oneVerdict = (call: Call<ChatToolTurn>): Call<SecondCheck> => ({
  ...call,
  read: (raw) => {
    const turn = call.read(raw);
    if (turn.uses.length !== 1) throw new MetaRefused("invalid_tool_arguments", `check_instruction was called ${turn.uses.length} times`);
    return turn.uses[0]!.args as SecondCheck;
  },
});

export const secondCheckRequest = (f: CheckFinding, o: Pick<CheckOptions, "content" | "walkId">): Call<SecondCheck> =>
  oneVerdict(sparkOpenToolCall(
    {
      content: o.content,
      walkId: o.walkId,
      inputTokenEstimate: CHECK_INPUT_TOKENS,
      maxTokens: CHECK_OUTPUT_TOKENS,
      messages: [
        { role: "system", content: CHECK_INSTRUCTIONS },
        {
          role: "user",
          content: [
            { type: "text", text: JSON.stringify({ found: f.concept, band: f.band, distanceFeet: f.distanceFeet, label: f.label, rules: f.rules, instruction: f.instruction }) },
            { type: "image_url", image_url: { url: f.photo } },
          ],
        },
      ],
    },
    [checkInstruction],
  ));

export async function secondCheck(client: MetaClient, f: CheckFinding, o: CheckOptions): Promise<SecondCheck> {
  if (o.content === "real" && !o.realWalks) throw new MetaRefused("real_walk_off_second_check", "real walks stay off the second check until it is switched on for them");
  return withRetries(async () => (await client.call(secondCheckRequest(f, o))).value, { sleep: o.sleep });
}
