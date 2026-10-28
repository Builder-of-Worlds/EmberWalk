import { z } from "zod";
import { sparkJsonCall, type Call, type ContentKind } from "@emberwalk/meta";
import { CaJurisdiction, JURISDICTIONS, Observation, RULES, toRule, type RankedFinding, type RuleRow } from "@emberwalk/rules";
import { Id, Language, PlantState, RuleId, Spacing } from "@emberwalk/shared";

type Json = Parameters<typeof sparkJsonCall>[0]["input"];

export const MAX_FRAMES = 10;
export const MAX_FRAME_CHARACTERS = 1_500_000;
export const MAX_FINDINGS = 40;
export const MAX_TURNS = 200;
export const MAX_PROBLEMS = MAX_FINDINGS * 4;
export const MAX_PROBLEM_CHARACTERS = 500;
export const MAX_OUTPUT_TOKENS = 6000;
export const TOKENS_PER_CHARACTER = 0.3;
export const TOKENS_PER_FRAME = 1600;
export const REASONING_EFFORT = "low";
export const ANSWER_NAME = "emberwalk_explain";

export const INSTRUCTIONS = [
  "You check a wildfire defensible space walk around one house.",
  "The first message is the rule table for this jurisdiction. The second gives the ranked findings, what the homeowner said and the proof frames.",
  "Answer every finding once, by its findingId, as JSON matching the schema.",
  "verdict: keep, or veto only when a frame shows the place of the finding and what is there is not what the finding says. A frame that does not show the finding's object proves nothing, because the frames are a sample of the walk. What the homeowner says never vetoes a finding.",
  "reason: one plain sentence saying what the frames show or what the homeowner said that matters.",
  "The homeowner's spoken words are context. When they say what they already do or why something is there, word the instruction so it answers them, in plain words, without changing the rule.",
  "plantState: dead, alive or unsure for plants only, else null. spacing: ok, too_close or not_checked for trees and shrubs only, else null.",
  "bandCheck: same, closer or farther than the band given. Never change the band yourself.",
  "instruction: one calm, plain sentence of 25 words or fewer, in the walk's language, telling the homeowner what to do about this finding and one concrete way to do it: a material, a tool, or where to put things (for a fence near the house: metal, brick or another material that will not burn).",
  "Keep every distance the rule's plain text names, in feet. Use the homeowner's everyday words, never words from the law such as woody, combustible, fuels, aerial or vegetation, and never fire resistant as the only advice.",
  "No urgency or fear words such as now, right away, immediately, soon, urgent, at all times or danger: the app shows urgency by colour.",
  "The homeowner reads one finding after another: never open two sentences the same way or repeat a stock phrase, and name a distance only where it is the point. The rule table says what is true; never copy its wording.",
  "Write only about what the walk found. Never say that something was not seen or that no work is needed; a vetoed finding's instruction is never shown.",
  "ruleIds: only ids from the rule table that fit the finding's concept and band.",
].join("\n");

export const Turn = z.strictObject({ t: z.number().nonnegative(), text: z.string().trim().min(1).max(2000) });
export type Turn = z.infer<typeof Turn>;

export const FindingAnswer = z.strictObject({
  findingId: Id,
  verdict: z.enum(["keep", "veto"]),
  reason: z.string().trim().min(1).max(300),
  plantState: PlantState.nullable(),
  spacing: Spacing.nullable(),
  bandCheck: z.enum(["same", "closer", "farther"]),
  instruction: z.string().trim().min(1).max(400),
  ruleIds: z.array(RuleId).min(1).max(20),
  language: Language,
});
export type FindingAnswer = z.infer<typeof FindingAnswer>;

export const ExplainAnswer = z.strictObject({ findings: z.array(FindingAnswer).max(MAX_FINDINGS) });
export type ExplainAnswer = z.infer<typeof ExplainAnswer>;

export type ExplainFinding = RankedFinding & { findingId: string; observation: Observation; proofFrame?: string };

export type ExplainInput = {
  walkId: string;
  jurisdiction: CaJurisdiction;
  language: z.infer<typeof Language>;
  content: ContentKind;
  findings: ExplainFinding[];
  turns: Turn[];
  frames: string[];
  problems?: string[];
};

const Frame = z.union([
  z.url({ protocol: /^https$/ }),
  z.string().regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/).max(MAX_FRAME_CHARACTERS),
]);

const Input = z.strictObject({
  walkId: Id,
  jurisdiction: CaJurisdiction,
  language: Language,
  content: z.enum(["synthetic", "real"]),
  findings: z
    .array(
      z
        .looseObject({ findingId: Id, observationId: z.string(), observation: Observation, proofFrame: Frame.optional() })
        .refine((f) => f.observation.id === f.observationId, "a finding's observation must be the observation it came from"),
    )
    .min(1, "a walk with no findings has nothing to explain")
    .max(MAX_FINDINGS)
    .refine((list) => new Set(list.map((f) => f.findingId)).size === list.length, "every finding needs its own findingId"),
  turns: z.array(Turn).max(MAX_TURNS),
  frames: z.array(Frame).max(MAX_FRAMES, `at most ${MAX_FRAMES} proof frames`),
  problems: z.array(z.string().trim().min(1).max(MAX_PROBLEM_CHARACTERS)).max(MAX_PROBLEMS).optional(),
});

export const tableRows = (jurisdiction: CaJurisdiction): RuleRow[] => {
  const statutes: readonly string[] = JURISDICTIONS[CaJurisdiction.parse(jurisdiction)];
  return RULES.filter((r) => r.statute === null || statutes.includes(r.statute));
};

export const ruleTable = (jurisdiction: CaJurisdiction): string => `RULE TABLE ${jurisdiction}\n${JSON.stringify(tableRows(jurisdiction).map(toRule))}`;

const asked = (f: ExplainFinding) => ({
  findingId: f.findingId,
  rank: f.rank,
  concept: f.concept,
  band: f.band,
  label: f.label,
  ruleIds: f.ruleIds,
  instruction: f.instruction,
});

export function explainRequest(input: ExplainInput): Call<ExplainAnswer> {
  const checked = Input.parse(input);
  const table = ruleTable(checked.jurisdiction);
  const walk = JSON.stringify({
    language: checked.language,
    content: checked.content,
    findings: input.findings.map(asked),
    turns: checked.turns,
    ...(checked.problems === undefined ? {} : { problems: checked.problems }),
  });
  const text = `${INSTRUCTIONS}\n${table}\n${walk}`;
  return sparkJsonCall(
    {
      instructions: INSTRUCTIONS,
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: table }] },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: walk }, ...checked.frames.map((url) => ({ type: "input_image", image_url: url }))],
        },
      ],
      content: checked.content,
      inputTokenEstimate: Math.ceil(text.length * TOKENS_PER_CHARACTER) + checked.frames.length * TOKENS_PER_FRAME,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      step: "explain",
      walkId: checked.walkId,
      extra: {
        reasoning: { effort: REASONING_EFFORT },
        text: { format: { type: "json_schema", name: ANSWER_NAME, schema: z.toJSONSchema(ExplainAnswer) as Json, strict: false } },
      },
    },
    ExplainAnswer,
  );
}
