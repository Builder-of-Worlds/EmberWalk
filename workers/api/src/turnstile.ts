const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = "ok" | "failed" | "unavailable";

const TIME_LIMIT_MS = 5000;

export const verifyTurnstile = async (token: string, secret: string, hostname: string, send: typeof fetch): Promise<TurnstileResult> => {
  try {
    const response = await send(VERIFY_URL, { method: "POST", body: new URLSearchParams({ secret, response: token }), signal: AbortSignal.timeout(TIME_LIMIT_MS) });
    if (!response.ok) return "unavailable";
    const result = (await response.json()) as { success?: unknown; hostname?: unknown };
    return result.success === true && result.hostname === hostname ? "ok" : "failed";
  } catch {
    return "unavailable";
  }
};
