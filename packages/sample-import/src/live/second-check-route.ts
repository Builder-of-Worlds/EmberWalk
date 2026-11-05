import { SPARK_OPEN_MODEL, type Transport } from "@emberwalk/meta";

const VERDICT = { verdict: "agrees", reason: "A fake answer, not a check." };

const fakeAnswer = (path: string): unknown =>
  path === "/models"
    ? { object: "list", data: [{ id: SPARK_OPEN_MODEL, object: "model" }] }
    : {
        model: SPARK_OPEN_MODEL,
        choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "fake", type: "function", function: { name: "check_instruction", arguments: JSON.stringify(VERDICT) } }] } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      };

const fakeTransport: Transport = async (req) => ({ status: 200, retryAfter: null, text: JSON.stringify(fakeAnswer(req.path)) });

type Route = { wanted: boolean; fake: boolean; apiKey: string; connect: (apiKey: string) => Transport };

export const secondCheckTransport = ({ wanted, fake, apiKey, connect }: Route): Transport | null => {
  if (!wanted) return null;
  if (fake) return fakeTransport;
  if (apiKey === "") throw new Error("--second-check on a live run needs BASETEN_API_KEY in the environment");
  return connect(apiKey);
};

type Checkable = { secondCheck?: { verdict: string } | null };

export const secondCheckTally = (findings: readonly Checkable[]): { checked: number; flagged: number; of: number } => ({
  checked: findings.filter((f) => f.secondCheck != null).length,
  flagged: findings.filter((f) => f.secondCheck?.verdict === "flags").length,
  of: findings.length,
});
