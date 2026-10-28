import { finalAnswer, type ShapedUse, toolAnswer } from "./answers.ts";

export const followUpUse = (messageId: string, over: object = {}): ShapedUse => ({
  name: "schedule_follow_up",
  args: {
    messageId,
    note: "No reply in four days, so a short reminder.",
    subject: "Following up: quote request",
    body: "Hello, just checking whether you could quote this work at a synthetic sample house.",
    ...over,
  },
});

export const followUpTurn = (...uses: ShapedUse[]): unknown => toolAnswer(...uses);

export const followUpsDone = finalAnswer("Drafted a reminder for each waiting message.");
