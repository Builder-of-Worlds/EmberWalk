import { hashToken, randomToken } from "./sign-in-token.ts";

const CODE_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

export const isInviteCode = (text: string): boolean => CODE_PATTERN.test(text);

export const hashInviteCode = async (code: string): Promise<string> => {
  if (!isInviteCode(code)) throw new Error("not an invite code");
  return hashToken(code);
};

export const newInviteCode = async (): Promise<{ code: string; hash: string }> => {
  const code = randomToken(24);
  return { code, hash: await hashInviteCode(code) };
};
