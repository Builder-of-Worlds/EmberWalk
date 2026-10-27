import call from "../../../../fixtures/meta/tool-call.json";
import final from "../../../../fixtures/meta/tool-final.json";

type Item = { type: string; [k: string]: unknown };

const callItem = (call.output as Item[]).find((i) => i.type === "function_call")!;
const messageItem = (final.output as Item[]).find((i) => i.type === "message") as Item & { content: Item[] };

let n = 0;

export type ShapedUse = { name: string; args: unknown };

export const toolAnswer = (...uses: ShapedUse[]): unknown => ({
  ...call,
  output: uses.map((u) => {
    const k = String(++n).padStart(8, "0");
    return { ...callItem, id: `fc_shaped_${k}`, call_id: `call_shaped_${k}`, name: u.name, arguments: typeof u.args === "string" ? u.args : JSON.stringify(u.args) };
  }),
});

export const finalAnswer = (text: string): unknown => ({
  ...final,
  output: [{ ...messageItem, content: [{ ...messageItem.content[0], text }] }],
});
